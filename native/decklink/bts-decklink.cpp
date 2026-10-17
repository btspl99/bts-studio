// bts-decklink — Blackmagic DeckLink playout with the card's hardware keyer, for BTS Studio.
//
//   bts-decklink --list
//       JSON on stdout: { "driver": true|false, "api": "...", "devices": [ { index, name, model,
//       internalKeying, externalKeying, modes: [ { id, name, width, height, fps, bgra } ] } ] }
//
//   bts-decklink --out <index|name> --mode 1080p25 [--key external|internal|none] [--level 0-255] [--audio]
//       Reads raw BGRA frames (straight alpha, width*height*4 bytes, the size of the mode) from stdin and
//       plays them out with scheduled playback locked to the card's clock: the newest frame received is shown
//       at every output frame (frames are repeated when input is slow and skipped when it is fast).
//       With --key external the card outputs fill and key on two connectors (e.g. SDI A / SDI B) for a
//       downstream vision mixer; with --key internal the card keys over its own input.
//       --premultiply: send a shaped (premultiplied) fill, which most hardware keyers expect.
//       --audio: interleaved stereo s16le 48 kHz on file descriptor 3 is embedded in the output.
//       Status / errors are JSON lines on stderr.
//
// Build: native/decklink/build-win.ps1 (MIDL + MSVC). The DeckLink API IDL files in sdk/ are
// Copyright (c) Blackmagic Design and redistributed under their permissive licence (see sdk/*.idl headers).

#include <windows.h>
#include <objbase.h>
#include <io.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <vector>
#include <mutex>
#include <atomic>
#include <thread>
#include <chrono>
#include "DeckLinkAPI_h.h"
#include "DeckLinkAPIVersion.h"

static std::mutex g_errMutex;
static void emit(const std::string& json) { std::lock_guard<std::mutex> l(g_errMutex); fprintf(stderr, "%s\n", json.c_str()); fflush(stderr); }
static std::string jstr(const std::string& s) {
  std::string o = "\"";
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += (char)c; }
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += (char)c;
  }
  return o + "\"";
}
static std::string bstrToUtf8(BSTR b) {
  if (!b) return "";
  int n = WideCharToMultiByte(CP_UTF8, 0, b, -1, nullptr, 0, nullptr, nullptr);
  std::string s(n > 0 ? n - 1 : 0, '\0');
  if (n > 1) WideCharToMultiByte(CP_UTF8, 0, b, -1, &s[0], n, nullptr, nullptr);
  SysFreeString(b);
  return s;
}
static void fail(const std::string& msg, int code = 2) { emit("{\"type\":\"error\",\"message\":" + jstr(msg) + "}"); exit(code); }

struct ModeName { const char* name; BMDDisplayMode mode; };
static const ModeName MODES[] = {
  {"1080p2398", bmdModeHD1080p2398}, {"1080p24", bmdModeHD1080p24}, {"1080p25", bmdModeHD1080p25}, {"1080p2997", bmdModeHD1080p2997},
  {"1080p30", bmdModeHD1080p30}, {"1080p50", bmdModeHD1080p50}, {"1080p5994", bmdModeHD1080p5994}, {"1080p60", bmdModeHD1080p6000},
  {"1080i50", bmdModeHD1080i50}, {"1080i5994", bmdModeHD1080i5994}, {"1080i60", bmdModeHD1080i6000},
  {"720p50", bmdModeHD720p50}, {"720p5994", bmdModeHD720p5994}, {"720p60", bmdModeHD720p60},
  {"2160p25", bmdMode4K2160p25}, {"2160p2997", bmdMode4K2160p2997}, {"2160p30", bmdMode4K2160p30},
  {"2160p50", bmdMode4K2160p50}, {"2160p5994", bmdMode4K2160p5994}, {"2160p60", bmdMode4K2160p60},
};
static const char* modeName(BMDDisplayMode m) { for (auto& x : MODES) if (x.mode == m) return x.name; return nullptr; }

static IDeckLinkIterator* makeIterator() {
  IDeckLinkIterator* it = nullptr;
  HRESULT hr = CoCreateInstance(CLSID_CDeckLinkIterator, nullptr, CLSCTX_ALL, IID_IDeckLinkIterator, (void**)&it);
  return SUCCEEDED(hr) ? it : nullptr;
}

/* ---------------- --list ---------------- */
static int listDevices() {
  IDeckLinkIterator* it = makeIterator();
  if (!it) { printf("{\"driver\":false,\"devices\":[]}\n"); return 0; }
  std::string api;
  IDeckLinkAPIInformation* info = nullptr;
  if (SUCCEEDED(it->QueryInterface(IID_IDeckLinkAPIInformation, (void**)&info))) {
    BSTR v = nullptr; if (SUCCEEDED(info->GetString(BMDDeckLinkAPIVersion, &v))) api = bstrToUtf8(v);
    info->Release();
  }
  std::string out = "{\"driver\":true,\"api\":" + jstr(api) + ",\"devices\":[";
  IDeckLink* dl = nullptr; int index = 0; bool firstDev = true;
  while (it->Next(&dl) == S_OK) {
    BSTR name = nullptr, model = nullptr;
    dl->GetDisplayName(&name); dl->GetModelName(&model);
    BOOL ik = FALSE, ek = FALSE;
    IDeckLinkProfileAttributes* attr = nullptr;
    if (SUCCEEDED(dl->QueryInterface(IID_IDeckLinkProfileAttributes, (void**)&attr))) {
      attr->GetFlag(BMDDeckLinkSupportsInternalKeying, &ik);
      attr->GetFlag(BMDDeckLinkSupportsExternalKeying, &ek);
      attr->Release();
    }
    std::string modes;
    IDeckLinkOutput* o = nullptr;
    bool hasOut = SUCCEEDED(dl->QueryInterface(IID_IDeckLinkOutput, (void**)&o));
    if (hasOut) {
      IDeckLinkDisplayModeIterator* mi = nullptr;
      if (SUCCEEDED(o->GetDisplayModeIterator(&mi))) {
        IDeckLinkDisplayMode* dm = nullptr; bool firstMode = true;
        while (mi->Next(&dm) == S_OK) {
          const char* id = modeName(dm->GetDisplayMode());
          if (id) {
            BMDTimeValue dur = 0; BMDTimeScale scale = 0; dm->GetFrameRate(&dur, &scale);
            BOOL ok = FALSE; BMDDisplayMode actual = (BMDDisplayMode)0;
            o->DoesSupportVideoMode(bmdVideoConnectionUnspecified, dm->GetDisplayMode(), bmdFormat8BitBGRA, bmdNoVideoOutputConversion, bmdSupportedVideoModeDefault, &actual, &ok);
            BSTR mn = nullptr; dm->GetName(&mn);
            char buf[160]; snprintf(buf, sizeof buf, "\"width\":%ld,\"height\":%ld,\"fps\":%.3f,\"bgra\":%s", dm->GetWidth(), dm->GetHeight(), dur ? (double)scale / dur : 0.0, ok ? "true" : "false");
            modes += std::string(firstMode ? "" : ",") + "{\"id\":" + jstr(id) + ",\"name\":" + jstr(bstrToUtf8(mn)) + "," + buf + "}";
            firstMode = false;
          }
          dm->Release();
        }
        mi->Release();
      }
      o->Release();
    }
    char head[96]; snprintf(head, sizeof head, "{\"index\":%d,", index);
    out += std::string(firstDev ? "" : ",") + head + "\"name\":" + jstr(bstrToUtf8(name)) + ",\"model\":" + jstr(bstrToUtf8(model)) +
      ",\"output\":" + (hasOut ? "true" : "false") + ",\"internalKeying\":" + (ik ? "true" : "false") + ",\"externalKeying\":" + (ek ? "true" : "false") + ",\"modes\":[" + modes + "]}";
    firstDev = false; index++;
    dl->Release();
  }
  it->Release();
  out += "]}";
  printf("%s\n", out.c_str());
  return 0;
}

/* ---------------- --out ---------------- */
struct Shared {
  std::mutex m;
  std::vector<unsigned char> latest;   // newest complete frame from stdin
  std::atomic<uint64_t> received{0};
  std::atomic<bool> eof{false};
};

class Player : public IDeckLinkVideoOutputCallback {
 public:
  IDeckLinkOutput* out = nullptr;
  Shared* shared = nullptr;
  std::vector<IDeckLinkMutableVideoFrame*> pool;
  BMDTimeValue frameDur = 0, nextTime = 0; BMDTimeScale timeScale = 0;
  long width = 0, height = 0;
  std::atomic<uint64_t> shown{0}, late{0}, dropped{0}, repeats{0};
  uint64_t lastSeq = 0;
  std::atomic<long> refs{1};

  void fill(IDeckLinkMutableVideoFrame* f) {
    void* bytes = nullptr; f->GetBytes(&bytes);
    std::lock_guard<std::mutex> l(shared->m);
    if (!shared->latest.empty()) memcpy(bytes, shared->latest.data(), shared->latest.size());
    uint64_t seq = shared->received.load();
    if (seq == lastSeq) repeats++;
    lastSeq = seq;
  }
  void scheduleNext(IDeckLinkMutableVideoFrame* f) {
    fill(f);
    out->ScheduleVideoFrame(f, nextTime, frameDur, timeScale);
    nextTime += frameDur;
  }
  HRESULT STDMETHODCALLTYPE ScheduledFrameCompleted(IDeckLinkVideoFrame* done, BMDOutputFrameCompletionResult r) override {
    if (r == bmdOutputFrameDisplayedLate) late++;
    else if (r == bmdOutputFrameDropped) dropped++;
    else if (r == bmdOutputFrameCompleted) shown++;
    if (r == bmdOutputFrameFlushed || shared->eof) return S_OK;
    // reuse the frame that just finished for the next slot (keeps a constant number of frames queued)
    for (auto* f : pool) if ((IDeckLinkVideoFrame*)f == done) { scheduleNext(f); break; }
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE ScheduledPlaybackHasStopped() override { return S_OK; }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, LPVOID* ppv) override {
    if (iid == IID_IUnknown || iid == IID_IDeckLinkVideoOutputCallback) { *ppv = this; AddRef(); return S_OK; }
    *ppv = nullptr; return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++refs; }
  ULONG STDMETHODCALLTYPE Release() override { return --refs; }
};

static bool readExact(int fd, unsigned char* p, size_t n) {
  size_t got = 0;
  while (got < n) {
    int chunk = (int)((n - got) > (1u << 30) ? (1u << 30) : (n - got));
    int r = _read(fd, p + got, chunk);
    if (r <= 0) return false;
    got += (size_t)r;
  }
  return true;
}

static int playOut(const std::string& devArg, const std::string& modeArg, const std::string& key, int level, bool audio, bool premul) {
  BMDDisplayMode mode = (BMDDisplayMode)0;
  for (auto& x : MODES) if (modeArg == x.name) mode = x.mode;
  if (!mode) fail("Unknown video mode " + modeArg);

  IDeckLinkIterator* it = makeIterator();
  if (!it) fail("Blackmagic Desktop Video is not installed (no DeckLink driver).", 3);
  IDeckLink* dl = nullptr; IDeckLink* pick = nullptr; int index = 0;
  bool byIndex = !devArg.empty() && devArg.find_first_not_of("0123456789") == std::string::npos;
  while (it->Next(&dl) == S_OK) {
    BSTR n = nullptr; dl->GetDisplayName(&n); std::string name = bstrToUtf8(n);
    if (!pick && ((byIndex && atoi(devArg.c_str()) == index) || (!byIndex && name.find(devArg) != std::string::npos))) pick = dl;
    else dl->Release();
    index++;
  }
  it->Release();
  if (!pick) fail("DeckLink device not found: " + devArg, 4);

  IDeckLinkOutput* out = nullptr;
  if (FAILED(pick->QueryInterface(IID_IDeckLinkOutput, (void**)&out))) fail("This DeckLink device has no output.");
  BOOL supported = FALSE; BMDDisplayMode actual = (BMDDisplayMode)0;
  out->DoesSupportVideoMode(bmdVideoConnectionUnspecified, mode, bmdFormat8BitBGRA, bmdNoVideoOutputConversion, bmdSupportedVideoModeDefault, &actual, &supported);
  if (!supported) fail("The card does not support " + modeArg + " in 8-bit BGRA.", 5);
  IDeckLinkDisplayMode* dm = nullptr;
  if (FAILED(out->GetDisplayMode(mode, &dm))) fail("Cannot read display mode " + modeArg);
  Player p; p.out = out;
  p.width = dm->GetWidth(); p.height = dm->GetHeight(); dm->GetFrameRate(&p.frameDur, &p.timeScale); dm->Release();
  HRESULT hr = out->EnableVideoOutput(mode, bmdVideoOutputFlagDefault);
  if (FAILED(hr)) fail("Cannot start video output — the device may be in use by another program.", 6);

  // keyer: external = fill + key on two connectors; internal = key over the card's input
  IDeckLinkKeyer* keyer = nullptr;
  std::string keyState = "none";
  if (key != "none") {
    if (FAILED(pick->QueryInterface(IID_IDeckLinkKeyer, (void**)&keyer)) || !keyer) emit("{\"type\":\"warn\",\"message\":\"This card has no keyer — sending fill only.\"}");
    else if (FAILED(keyer->Enable(key == "external" ? TRUE : FALSE))) { emit("{\"type\":\"warn\",\"message\":" + jstr("The card does not support " + key + " keying.") + "}"); keyer->Release(); keyer = nullptr; }
    else { keyer->SetLevel((unsigned char)(level < 0 ? 0 : level > 255 ? 255 : level)); keyState = key; }
  }

  Shared shared; p.shared = &shared;
  const size_t frameBytes = (size_t)p.width * p.height * 4;
  shared.latest.assign(frameBytes, 0); // transparent black until the first frame arrives
  const int POOL = 4;
  for (int i = 0; i < POOL; i++) {
    IDeckLinkMutableVideoFrame* f = nullptr;
    if (FAILED(out->CreateVideoFrame(p.width, p.height, p.width * 4, bmdFormat8BitBGRA, bmdFrameFlagDefault, &f))) fail("Out of video frame memory on the card.");
    p.pool.push_back(f);
  }
  out->SetScheduledFrameCompletionCallback(&p);

  if (audio) {
    if (FAILED(out->EnableAudioOutput(bmdAudioSampleRate48kHz, bmdAudioSampleType16bitInteger, 2, bmdAudioOutputStreamContinuous))) { emit("{\"type\":\"warn\",\"message\":\"Cannot enable embedded audio.\"}"); audio = false; }
    else out->BeginAudioPreroll();
  }
  for (auto* f : p.pool) p.scheduleNext(f); // preroll
  if (audio) out->EndAudioPreroll();
  if (FAILED(out->StartScheduledPlayback(0, p.timeScale, 1.0))) fail("Cannot start scheduled playback.");
  char ready[256];
  snprintf(ready, sizeof ready, "{\"type\":\"ready\",\"width\":%ld,\"height\":%ld,\"fps\":%.3f,\"keyer\":\"%s\",\"audio\":%s}", p.width, p.height, (double)p.timeScale / p.frameDur, keyState.c_str(), audio ? "true" : "false");
  emit(ready);

  // embedded audio from fd 3 (s16le stereo 48 kHz), scheduled continuously; drop when far ahead of the card
  std::thread audioThread;
  if (audio) {
    audioThread = std::thread([&]() {
      std::vector<unsigned char> buf(48000 / 25 * 4);
      BMDTimeValue t = 0;
      for (;;) {
        int r = _read(3, buf.data(), (unsigned)buf.size());
        if (r <= 0) break;
        unsigned frames = (unsigned)r / 4, written = 0, queued = 0;
        out->GetBufferedAudioSampleFrameCount(&queued);
        if (queued > 24000) continue; // more than 0.5 s ahead: skip to stay in sync
        out->ScheduleAudioSamples(buf.data(), frames, t, 48000, &written);
        t += frames;
      }
    });
  }

  // stats once a second
  std::thread stats([&]() {
    while (!shared.eof) {
      std::this_thread::sleep_for(std::chrono::seconds(1));
      unsigned int buffered = 0; out->GetBufferedVideoFrameCount(&buffered);
      char s[256];
      snprintf(s, sizeof s, "{\"type\":\"stats\",\"received\":%llu,\"shown\":%llu,\"late\":%llu,\"dropped\":%llu,\"repeats\":%llu,\"buffered\":%u}",
        (unsigned long long)shared.received.load(), (unsigned long long)p.shown.load(), (unsigned long long)p.late.load(), (unsigned long long)p.dropped.load(), (unsigned long long)p.repeats.load(), buffered);
      emit(s);
    }
  });

  // main loop: read frames from stdin, keep the newest
  std::vector<unsigned char> buf(frameBytes);
  while (readExact(0, buf.data(), frameBytes)) {
    if (premul) { // shaped fill: colour * alpha
      unsigned char* q = buf.data();
      for (size_t i = 0; i < frameBytes; i += 4) { unsigned a = q[i + 3]; if (a != 255) { q[i] = (unsigned char)((q[i] * a + 127) / 255); q[i + 1] = (unsigned char)((q[i + 1] * a + 127) / 255); q[i + 2] = (unsigned char)((q[i + 2] * a + 127) / 255); } }
    }
    { std::lock_guard<std::mutex> l(shared.m); shared.latest.swap(buf); }
    shared.received++;
  }
  shared.eof = true;
  BMDTimeValue stopAt = 0;
  out->StopScheduledPlayback(0, &stopAt, p.timeScale);
  if (keyer) { keyer->Disable(); keyer->Release(); }
  if (audio) { out->DisableAudioOutput(); _close(3); }
  out->SetScheduledFrameCompletionCallback(nullptr);
  out->DisableVideoOutput();
  stats.join();
  if (audioThread.joinable()) audioThread.join();
  for (auto* f : p.pool) f->Release();
  out->Release(); pick->Release();
  emit("{\"type\":\"stopped\"}");
  return 0;
}

int main(int argc, char** argv) {
  _setmode(0, _O_BINARY);
  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) fail("COM initialisation failed");
  std::string mode = "", dev = "0", modeArg = "1080p25", key = "external";
  int level = 255; bool audio = false, premul = false;
  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    auto next = [&]() -> std::string { return i + 1 < argc ? argv[++i] : ""; };
    if (a == "--list") mode = "list";
    else if (a == "--out") { mode = "out"; dev = next(); }
    else if (a == "--mode") modeArg = next();
    else if (a == "--key") key = next();
    else if (a == "--level") level = atoi(next().c_str());
    else if (a == "--audio") audio = true;
    else if (a == "--premultiply") premul = true;
    else if (a == "--version") { printf("bts-decklink 1.0 (DeckLink API %s)\n", BLACKMAGIC_DECKLINK_API_VERSION_STRING); return 0; }
  }
  int rc;
  if (mode == "list") rc = listDevices();
  else if (mode == "out") rc = playOut(dev, modeArg, key, level, audio, premul);
  else { fprintf(stderr, "usage: bts-decklink --list | --out <index|name> --mode 1080p25 [--key external|internal|none] [--level 0-255] [--audio] [--premultiply]\n"); rc = 1; }
  CoUninitialize();
  return rc;
}

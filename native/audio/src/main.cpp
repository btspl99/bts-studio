// bts-audio — BTS Studio pro-audio helper.
//
//   bts-audio --list                                  JSON list of audio devices (ASIO, WASAPI, WDM-KS, MME…)
//   bts-audio --in <id> [--channels N] [--pair K | --mono C] [--exclusive] [--vst <file.vst3>]...
//   bts-audio --test-tone [--vst <file.vst3>]...       440/660 Hz test signal instead of a device
//        → stdout: 48 kHz stereo s16le PCM (after the VST3 chain)
//        ← stdin : control lines, one JSON object per line (see README.md)
//   bts-audio --out <id> [--pair K] [--exclusive]     stdin: 48 kHz stereo s16le PCM → device
//   bts-audio --vst-info <file.vst3>                   name and parameters of a plug-in (JSON)
//
// Events / errors are written to stderr as JSON lines: {"event":"...", ...}
//
// Licences: PortAudio (MIT-style), Steinberg ASIO SDK (GPLv3 option), Steinberg VST3 SDK (MIT).

#include "portaudio.h"
#if defined(_WIN32)
#include "pa_win_wasapi.h"
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#else
struct PaWasapiStreamInfo { int unused; };
#endif

#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/processdata.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/utility/stringconvert.h"
#include "public.sdk/source/common/memorystream.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/base/ibstream.h"

#include <atomic>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <deque>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace Steinberg;
using namespace Steinberg::Vst;

static const int kRate = 48000;
static const int kMaxBlock = 4096;
static std::mutex gErrMx;

/* ------------------------------------------------------------------ JSON helpers */
static std::string jsonEsc(const std::string& s) {
  std::string o;
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += (char)c; }
    else if (c == '\n') o += "\\n";
    else if (c == '\r') o += "\\r";
    else if (c == '\t') o += "\\t";
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += (char)c;
  }
  return o;
}
static void event(const std::string& body) { // body = JSON fields without braces
  std::lock_guard<std::mutex> l(gErrMx);
  std::cerr << "{" << body << "}" << std::endl;
}
static void error(const std::string& msg) { event("\"event\":\"error\",\"message\":\"" + jsonEsc(msg) + "\""); }

// tiny parser for flat JSON objects: {"cmd":"x","index":1,"value":0.5,"state":"…"}
static std::map<std::string, std::string> parseFlat(const std::string& line) {
  std::map<std::string, std::string> m;
  size_t i = 0, n = line.size();
  auto ws = [&] { while (i < n && isspace((unsigned char)line[i])) i++; };
  auto str = [&]() { std::string s; i++; while (i < n && line[i] != '"') { if (line[i] == '\\' && i + 1 < n) { i++; char c = line[i]; s += c == 'n' ? '\n' : c == 't' ? '\t' : c; } else s += line[i]; i++; } i++; return s; };
  ws(); if (i >= n || line[i] != '{') return m; i++;
  while (i < n) {
    ws(); if (i < n && line[i] == '}') break;
    if (i >= n || line[i] != '"') break;
    std::string k = str(); ws(); if (i < n && line[i] == ':') i++; ws();
    std::string v;
    if (i < n && line[i] == '"') v = str();
    else { while (i < n && line[i] != ',' && line[i] != '}') v += line[i++]; while (!v.empty() && isspace((unsigned char)v.back())) v.pop_back(); }
    m[k] = v; ws(); if (i < n && line[i] == ',') i++;
  }
  return m;
}

static const char* B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
static std::string b64enc(const char* d, size_t n) {
  std::string o; o.reserve((n + 2) / 3 * 4);
  for (size_t i = 0; i < n; i += 3) {
    unsigned v = (unsigned char)d[i] << 16 | (i + 1 < n ? (unsigned char)d[i + 1] << 8 : 0) | (i + 2 < n ? (unsigned char)d[i + 2] : 0);
    o += B64[v >> 18 & 63]; o += B64[v >> 12 & 63]; o += i + 1 < n ? B64[v >> 6 & 63] : '='; o += i + 2 < n ? B64[v & 63] : '=';
  }
  return o;
}
static std::vector<char> b64dec(const std::string& s) {
  std::vector<char> o; int val = 0, bits = -8;
  for (char c : s) {
    const char* p = strchr(B64, c); if (!p || !c) continue;
    val = (val << 6) + int(p - B64); bits += 6;
    if (bits >= 0) { o.push_back(char((val >> bits) & 0xFF)); bits -= 8; }
  }
  return o;
}

/* ------------------------------------------------------------------ VST3 plug-in */
struct Plug;
#if defined(_WIN32)
static void editorOpen(Plug* p);
static void editorClose(Plug* p);
#endif

struct Plug {
  std::string path, name;
  VST3::Hosting::Module::Ptr module;
  IPtr<PlugProvider> provider;
  IPtr<IComponent> component;
  IPtr<IEditController> controller;
  FUnknownPtr<IAudioProcessor> processor;
  HostProcessData data;
  ParameterChanges changes{64};
  std::mutex pendMx;
  std::vector<std::pair<ParamID, ParamValue>> pending;
  std::atomic<bool> bypass{false};
  int inCh = 0, outCh = 0;
  IPlugView* view = nullptr;
  void* window = nullptr;

  bool load(const std::string& file, std::string& err) {
    path = file;
    module = VST3::Hosting::Module::create(file, err);
    if (!module) return false;
    auto factory = module->getFactory();
    for (auto& ci : factory.classInfos()) {
      if (ci.category() == kVstAudioEffectClass) { provider = owned(new PlugProvider(factory, ci, true)); name = ci.name(); break; }
    }
    if (!provider) { err = "No audio effect in " + file; return false; }
    component = provider->getComponent();
    controller = provider->getController();
    if (!component) { err = "Plug-in did not initialise"; return false; }
    processor = FUnknownPtr<IAudioProcessor>(component);
    if (!processor) { err = "Not an audio processor"; return false; }
    SpeakerArrangement st = SpeakerArr::kStereo;
    int nIn = component->getBusCount(kAudio, kInput), nOut = component->getBusCount(kAudio, kOutput);
    processor->setBusArrangements(nIn ? &st : nullptr, nIn ? 1 : 0, &st, nOut ? 1 : 0);
    for (int i = 0; i < nIn; i++) component->activateBus(kAudio, kInput, i, i == 0);
    for (int i = 0; i < nOut; i++) component->activateBus(kAudio, kOutput, i, i == 0);
    ProcessSetup setup{kRealtime, kSample32, kMaxBlock, (SampleRate)kRate};
    if (processor->setupProcessing(setup) != kResultOk) { err = "setupProcessing failed"; return false; }
    data.prepare(*component, kMaxBlock, kSample32);
    data.inputParameterChanges = &changes;
    if (component->setActive(true) != kResultOk) { err = "setActive failed"; return false; }
    processor->setProcessing(true);
    // tell the processor the controller's current values (some plug-ins start silent until they get them)
    if (controller) for (int i = 0, n = controller->getParameterCount(); i < n; i++) { ParameterInfo pi{}; if (controller->getParameterInfo(i, pi) == kResultOk && !(pi.flags & ParameterInfo::kIsReadOnly)) pending.emplace_back(pi.id, controller->getParamNormalized(pi.id)); }
    inCh = data.numInputs ? data.inputs[0].numChannels : 0;
    outCh = data.numOutputs ? data.outputs[0].numChannels : 0;
    return true;
  }
  // process a stereo block in place
  void process(float* L, float* R, int n) {
    if (bypass || !processor || n > kMaxBlock || outCh == 0) return;
    {
      std::unique_lock<std::mutex> l(pendMx, std::try_to_lock);
      changes.clearQueue();
      if (l.owns_lock() && !pending.empty()) {
        for (auto& pv : pending) { int32 qi = 0, pi = 0; auto q = changes.addParameterData(pv.first, qi); if (q) q->addPoint(0, pv.second, pi); }
        pending.clear();
      }
    }
    data.numSamples = n;
    if (inCh >= 1) memcpy(data.inputs[0].channelBuffers32[0], L, n * sizeof(float));
    if (inCh >= 2) memcpy(data.inputs[0].channelBuffers32[1], R, n * sizeof(float));
    if (processor->process(data) != kResultOk) return;
    memcpy(L, data.outputs[0].channelBuffers32[0], n * sizeof(float));
    memcpy(R, data.outputs[0].channelBuffers32[outCh >= 2 ? 1 : 0], n * sizeof(float));
  }
  void setParam(ParamID id, ParamValue v) {
    if (controller) controller->setParamNormalized(id, v);
    std::lock_guard<std::mutex> l(pendMx); pending.emplace_back(id, v);
  }
  std::string paramsJson() {
    std::string o = "[";
    if (controller) {
      int n = controller->getParameterCount();
      for (int i = 0; i < n; i++) {
        ParameterInfo pi{};
        if (controller->getParameterInfo(i, pi) != kResultOk) continue;
        if (o.size() > 1) o += ",";
        o += "{\"id\":" + std::to_string(pi.id) + ",\"name\":\"" + jsonEsc(StringConvert::convert(pi.title)) + "\",\"value\":" + std::to_string(controller->getParamNormalized(pi.id)) + "}";
      }
    }
    return o + "]";
  }
  std::string getState() {
    MemoryStream cs, es;
    if (component) component->getState(&cs);
    if (controller) controller->getState(&es);
    return b64enc(cs.getData(), (size_t)cs.getSize()) + "." + b64enc(es.getData(), (size_t)es.getSize());
  }
  bool setState(const std::string& s) {
    auto dot = s.find('.');
    auto c = b64dec(s.substr(0, dot)), e = dot == std::string::npos ? std::vector<char>() : b64dec(s.substr(dot + 1));
    if (!c.empty() && component) {
      MemoryStream cs(c.data(), (TSize)c.size());
      component->setState(&cs);
      if (controller) { MemoryStream cs2(c.data(), (TSize)c.size()); controller->setComponentState(&cs2); }
    }
    if (!e.empty() && controller) { MemoryStream es(e.data(), (TSize)e.size()); controller->setState(&es); }
    return true;
  }
  void unload() {
#if defined(_WIN32)
    editorClose(this);
#endif
    if (processor) processor->setProcessing(false);
    if (component) component->setActive(false);
    data.unprepare();
    processor = nullptr; controller = nullptr; component = nullptr; provider = nullptr; module = nullptr;
  }
};

static std::vector<std::unique_ptr<Plug>> gChain;
static std::mutex gChainMx; // held by the audio thread while processing; control commands lock it briefly

static void runChain(float* L, float* R, int n) {
  std::unique_lock<std::mutex> l(gChainMx, std::try_to_lock);
  if (!l.owns_lock()) return; // a state change is in progress: pass this block through
  for (int off = 0; off < n; off += kMaxBlock) {
    int k = std::min(kMaxBlock, n - off);
    for (auto& p : gChain) p->process(L + off, R + off, k);
  }
}

/* ------------------------------------------------------------------ Windows editor windows */
#if defined(_WIN32)
static DWORD gUiThread = 0;
static HWND gMsgWnd = nullptr;
static std::mutex gUiMx;
static std::deque<std::function<void()>> gUiQueue;
static const UINT WM_RUN = WM_APP + 1;

static void onUi(std::function<void()> fn) {
  { std::lock_guard<std::mutex> l(gUiMx); gUiQueue.push_back(std::move(fn)); }
  if (gMsgWnd) PostMessage(gMsgWnd, WM_RUN, 0, 0);
}

class Frame : public IPlugFrame {
public:
  HWND hwnd = nullptr;
  tresult PLUGIN_API resizeView(IPlugView* view, ViewRect* r) override {
    RECT rc{0, 0, r->getWidth(), r->getHeight()};
    AdjustWindowRect(&rc, GetWindowLong(hwnd, GWL_STYLE), FALSE);
    SetWindowPos(hwnd, nullptr, 0, 0, rc.right - rc.left, rc.bottom - rc.top, SWP_NOMOVE | SWP_NOZORDER);
    view->onSize(r);
    return kResultTrue;
  }
  tresult PLUGIN_API queryInterface(const TUID iid, void** obj) override {
    if (FUnknownPrivate::iidEqual(iid, IPlugFrame::iid) || FUnknownPrivate::iidEqual(iid, FUnknown::iid)) { *obj = this; return kResultOk; }
    *obj = nullptr; return kNoInterface;
  }
  uint32 PLUGIN_API addRef() override { return 1; }
  uint32 PLUGIN_API release() override { return 1; }
};
static std::map<HWND, Plug*> gWindows;
static std::map<Plug*, std::unique_ptr<Frame>> gFrames;

static LRESULT CALLBACK EditorProc(HWND h, UINT m, WPARAM w, LPARAM l) {
  if (m == WM_CLOSE) { auto it = gWindows.find(h); if (it != gWindows.end()) editorClose(it->second); return 0; }
  if (m == WM_SIZE) {
    auto it = gWindows.find(h);
    if (it != gWindows.end() && it->second->view) { RECT rc; GetClientRect(h, &rc); ViewRect vr(0, 0, rc.right, rc.bottom); it->second->view->onSize(&vr); }
  }
  return DefWindowProcW(h, m, w, l);
}
static LRESULT CALLBACK MsgProc(HWND h, UINT m, WPARAM w, LPARAM l) {
  if (m == WM_RUN) {
    std::deque<std::function<void()>> q;
    { std::lock_guard<std::mutex> lk(gUiMx); q.swap(gUiQueue); }
    for (auto& f : q) f();
    return 0;
  }
  return DefWindowProcW(h, m, w, l);
}
static void editorOpen(Plug* p) {
  if (p->window) { SetForegroundWindow((HWND)p->window); return; }
  if (!p->controller) { error("Plug-in has no editor"); return; }
  IPlugView* v = p->controller->createView(ViewType::kEditor);
  if (!v) { error(p->name + " has no editor window"); return; }
  if (v->isPlatformTypeSupported(kPlatformTypeHWND) != kResultTrue) { v->release(); error("Editor does not support Windows"); return; }
  ViewRect r; if (v->getSize(&r) != kResultOk || r.getWidth() <= 0) r = ViewRect(0, 0, 640, 400);
  DWORD style = WS_OVERLAPPEDWINDOW & ~(v->canResize() == kResultTrue ? 0 : (WS_THICKFRAME | WS_MAXIMIZEBOX));
  RECT rc{0, 0, r.getWidth(), r.getHeight()}; AdjustWindowRect(&rc, style, FALSE);
  std::wstring title = L"BTS Studio — " + std::wstring(p->name.begin(), p->name.end());
  HWND h = CreateWindowExW(WS_EX_TOOLWINDOW, L"BtsVstEditor", title.c_str(), style, CW_USEDEFAULT, CW_USEDEFAULT, rc.right - rc.left, rc.bottom - rc.top, nullptr, nullptr, GetModuleHandle(nullptr), nullptr);
  auto& fr = gFrames[p]; fr.reset(new Frame()); fr->hwnd = h;
  v->setFrame(fr.get());
  if (v->attached(h, kPlatformTypeHWND) != kResultOk) { DestroyWindow(h); v->release(); error("Editor could not open"); return; }
  p->view = v; p->window = h; gWindows[h] = p;
  ShowWindow(h, SW_SHOW); SetForegroundWindow(h);
  event("\"event\":\"editor\",\"open\":true,\"name\":\"" + jsonEsc(p->name) + "\"");
}
static void editorClose(Plug* p) {
  if (!p->window) return;
  HWND h = (HWND)p->window;
  if (p->view) { p->view->removed(); p->view->release(); p->view = nullptr; }
  gWindows.erase(h); DestroyWindow(h); p->window = nullptr; gFrames.erase(p);
  event("\"event\":\"editor\",\"open\":false,\"name\":\"" + jsonEsc(p->name) + "\"");
}
#endif

/* ------------------------------------------------------------------ PCM ring buffer */
struct Ring {
  std::vector<int16_t> buf; size_t r = 0, w = 0, count = 0; std::mutex mx; std::condition_variable cv; bool closed = false;
  explicit Ring(size_t samples) : buf(samples) {}
  void push(const int16_t* d, size_t n, bool dropOldest) {
    std::lock_guard<std::mutex> l(mx);
    for (size_t i = 0; i < n; i++) {
      if (count == buf.size()) { if (!dropOldest) break; r = (r + 1) % buf.size(); count--; }
      buf[w] = d[i]; w = (w + 1) % buf.size(); count++;
    }
    cv.notify_one();
  }
  size_t pop(int16_t* d, size_t n) { // non-blocking
    std::lock_guard<std::mutex> l(mx);
    size_t k = std::min(n, count);
    for (size_t i = 0; i < k; i++) { d[i] = buf[r]; r = (r + 1) % buf.size(); }
    count -= k; return k;
  }
  size_t popWait(int16_t* d, size_t n) {
    std::unique_lock<std::mutex> l(mx);
    cv.wait(l, [&] { return count > 0 || closed; });
    size_t k = std::min(n, count);
    for (size_t i = 0; i < k; i++) { d[i] = buf[r]; r = (r + 1) % buf.size(); }
    count -= k; return k;
  }
};

static inline int16_t toS16(float v) { v = v > 1.f ? 1.f : v < -1.f ? -1.f : v; return (int16_t)lrintf(v * 32767.f); }

/* ------------------------------------------------------------------ capture */
struct InCtx { int channels = 2, left = 0, right = 1; Ring* ring; std::vector<float> L, R; std::vector<int16_t> out; };

static void deliver(InCtx* c, int n) {
  runChain(c->L.data(), c->R.data(), n);
  c->out.resize(n * 2);
  for (int i = 0; i < n; i++) { c->out[i * 2] = toS16(c->L[i]); c->out[i * 2 + 1] = toS16(c->R[i]); }
  c->ring->push(c->out.data(), c->out.size(), true);
}

static int inCallback(const void* input, void*, unsigned long frames, const PaStreamCallbackTimeInfo*, PaStreamCallbackFlags, void* user) {
  auto* c = (InCtx*)user;
  const float* in = (const float*)input;
  c->L.resize(frames); c->R.resize(frames);
  for (unsigned long i = 0; i < frames; i++) {
    c->L[i] = in ? in[i * c->channels + c->left] : 0.f;
    c->R[i] = in ? in[i * c->channels + c->right] : 0.f;
  }
  deliver(c, (int)frames);
  return paContinue;
}

static std::atomic<bool> gQuit{false};

static void writerThread(Ring* ring) {
  std::vector<int16_t> tmp(4800);
  while (!gQuit) {
    size_t k = ring->popWait(tmp.data(), tmp.size());
    if (!k) { if (ring->closed) break; continue; }
    if (fwrite(tmp.data(), sizeof(int16_t), k, stdout) != k) { gQuit = true; break; }
    fflush(stdout);
  }
}

static void handleControl(const std::string& line) {
  auto m = parseFlat(line);
  const std::string cmd = m["cmd"];
  int idx = m.count("index") ? atoi(m["index"].c_str()) : 0;
  auto plug = [&]() -> Plug* { return idx >= 0 && idx < (int)gChain.size() ? gChain[idx].get() : nullptr; };
  if (cmd == "quit") { gQuit = true; return; }
  if (cmd == "chain") {
    std::string o = "\"event\":\"chain\",\"plugins\":[";
    for (size_t i = 0; i < gChain.size(); i++) o += std::string(i ? "," : "") + "{\"index\":" + std::to_string(i) + ",\"name\":\"" + jsonEsc(gChain[i]->name) + "\",\"bypass\":" + (gChain[i]->bypass ? "true" : "false") + "}";
    event(o + "]"); return;
  }
  Plug* p = plug();
  if (!p) { error("No plug-in at index " + std::to_string(idx)); return; }
  if (cmd == "bypass") { p->bypass = m["value"] == "true" || m["value"] == "1"; event("\"event\":\"bypass\",\"index\":" + std::to_string(idx) + ",\"value\":" + (p->bypass ? "true" : "false")); }
  else if (cmd == "param") { p->setParam((ParamID)strtoul(m["id"].c_str(), nullptr, 10), atof(m["value"].c_str())); }
  else if (cmd == "params") { event("\"event\":\"params\",\"index\":" + std::to_string(idx) + ",\"params\":" + p->paramsJson()); }
  else if (cmd == "getState") { std::string s; { std::lock_guard<std::mutex> l(gChainMx); s = p->getState(); } event("\"event\":\"state\",\"index\":" + std::to_string(idx) + ",\"state\":\"" + s + "\""); }
  else if (cmd == "setState") { std::lock_guard<std::mutex> l(gChainMx); p->setState(m["state"]); event("\"event\":\"stateSet\",\"index\":" + std::to_string(idx)); }
  else if (cmd == "editor" || cmd == "closeEditor") {
#if defined(_WIN32)
    bool open = cmd == "editor" && m["value"] != "false";
    onUi([p, open] { if (open) editorOpen(p); else editorClose(p); });
#else
    error("Plug-in editors are only available on Windows");
#endif
  } else error("Unknown command " + cmd);
}

static void controlThread() {
  std::string line;
  while (!gQuit && std::getline(std::cin, line)) {
    if (!line.empty()) handleControl(line);
  }
  gQuit = true; // stdin closed: the app went away
#if defined(_WIN32)
  if (gUiThread) PostThreadMessage(gUiThread, WM_QUIT, 0, 0);
#endif
}

/* ------------------------------------------------------------------ device list */
static void listDevices() {
  std::string o = "{\"hostApis\":[";
  for (int i = 0; i < Pa_GetHostApiCount(); i++) {
    auto* h = Pa_GetHostApiInfo(i);
    o += std::string(i ? "," : "") + "{\"index\":" + std::to_string(i) + ",\"name\":\"" + jsonEsc(h->name) + "\",\"type\":" + std::to_string(h->type) + "}";
  }
  o += "],\"devices\":[";
  for (int i = 0; i < Pa_GetDeviceCount(); i++) {
    auto* d = Pa_GetDeviceInfo(i);
    auto* h = Pa_GetHostApiInfo(d->hostApi);
    o += std::string(i ? "," : "") + "{\"id\":" + std::to_string(i) + ",\"name\":\"" + jsonEsc(d->name) + "\",\"hostApi\":\"" + jsonEsc(h->name) +
         "\",\"maxIn\":" + std::to_string(d->maxInputChannels) + ",\"maxOut\":" + std::to_string(d->maxOutputChannels) +
         ",\"defaultRate\":" + std::to_string((int)d->defaultSampleRate) + ",\"lowLatencyMs\":" + std::to_string((int)(d->defaultLowInputLatency * 1000)) + "}";
  }
  std::cout << o << "]}" << std::endl;
}

static void* hostSpecific(int dev, bool exclusive, PaWasapiStreamInfo* w) {
#if defined(_WIN32)
  auto* d = Pa_GetDeviceInfo(dev);
  if (exclusive && Pa_GetHostApiInfo(d->hostApi)->type == paWASAPI) {
    memset(w, 0, sizeof *w); w->size = sizeof(PaWasapiStreamInfo); w->hostApiType = paWASAPI; w->version = 1; w->flags = paWinWasapiExclusive;
    return w;
  }
#endif
  (void)dev; (void)exclusive; (void)w; return nullptr;
}

/* ------------------------------------------------------------------ main */
int main(int argc, char** argv) {
#if defined(_WIN32)
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stdin), _O_BINARY);
#endif
  std::string mode, vstInfo; int dev = -1, channels = 0, pair = 0, mono = -1; bool exclusive = false;
  std::vector<std::string> vsts;
  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    auto next = [&]() { return i + 1 < argc ? std::string(argv[++i]) : std::string(); };
    if (a == "--list") mode = "list";
    else if (a == "--in") { mode = "in"; dev = atoi(next().c_str()); }
    else if (a == "--out") { mode = "out"; dev = atoi(next().c_str()); }
    else if (a == "--test-tone") mode = "tone";
    else if (a == "--vst-info") { mode = "info"; vstInfo = next(); }
    else if (a == "--vst") vsts.push_back(next());
    else if (a == "--channels") channels = atoi(next().c_str());
    else if (a == "--pair") pair = atoi(next().c_str());
    else if (a == "--mono") mono = atoi(next().c_str());
    else if (a == "--exclusive") exclusive = true;
    else if (a == "--version") { std::cout << "bts-audio 1.0 (" << Pa_GetVersionText() << ")" << std::endl; return 0; }
  }
  if (mode.empty()) { std::cerr << "usage: bts-audio --list | --in <id> | --out <id> | --test-tone | --vst-info <file>\n"; return 2; }

  static HostApplication hostApp;
  PluginContextFactory::instance().setPluginContext(&hostApp);

  if (mode == "info") {
    Plug p; std::string err;
    if (!p.load(vstInfo, err)) { std::cout << "{\"ok\":false,\"error\":\"" << jsonEsc(err) << "\"}" << std::endl; return 1; }
    std::cout << "{\"ok\":true,\"name\":\"" << jsonEsc(p.name) << "\",\"inputs\":" << p.inCh << ",\"outputs\":" << p.outCh << ",\"params\":" << p.paramsJson() << "}" << std::endl;
    p.unload();
    return 0;
  }

  for (auto& v : vsts) {
    auto p = std::make_unique<Plug>(); std::string err;
    if (!p->load(v, err)) { error("VST3 " + v + ": " + err); continue; }
    event("\"event\":\"plugin\",\"index\":" + std::to_string(gChain.size()) + ",\"name\":\"" + jsonEsc(p->name) + "\"");
    gChain.push_back(std::move(p));
  }

  if (mode != "tone") {
    PaError e = Pa_Initialize();
    if (e != paNoError) { error(std::string("PortAudio: ") + Pa_GetErrorText(e)); return 1; }
  }
  if (mode == "list") { listDevices(); Pa_Terminate(); return 0; }

  int rc = 0;
  if (mode == "in" || mode == "tone") {
    Ring ring(kRate * 2 * 2); // 2 s of stereo
    InCtx ctx; ctx.ring = &ring;
    PaStream* stream = nullptr;
    std::thread toneThread;
    if (mode == "in") {
      if (dev < 0 || dev >= Pa_GetDeviceCount()) { error("No such input device"); return 1; }
      auto* d = Pa_GetDeviceInfo(dev);
      ctx.channels = channels > 0 ? std::min(channels, d->maxInputChannels) : std::min(2, d->maxInputChannels);
      if (ctx.channels < 1) { error(std::string(d->name) + " has no inputs"); return 1; }
      // ASIO and multichannel devices: open enough channels to reach the requested pair
      int need = mono >= 0 ? mono + 1 : pair * 2 + 2;
      ctx.channels = std::max(ctx.channels, std::min(need, d->maxInputChannels));
      ctx.left = mono >= 0 ? mono : std::min(pair * 2, ctx.channels - 1);
      ctx.right = mono >= 0 ? mono : std::min(pair * 2 + 1, ctx.channels - 1);
      PaWasapiStreamInfo wi;
      PaStreamParameters ip{dev, ctx.channels, paFloat32, d->defaultLowInputLatency, hostSpecific(dev, exclusive, &wi)};
      PaError e = Pa_OpenStream(&stream, &ip, nullptr, kRate, paFramesPerBufferUnspecified, paNoFlag, inCallback, &ctx);
      if (e != paNoError) { error(std::string("Cannot open ") + d->name + " at 48 kHz: " + Pa_GetErrorText(e)); Pa_Terminate(); return 1; }
      Pa_StartStream(stream);
      auto* si = Pa_GetStreamInfo(stream);
      event("\"event\":\"started\",\"device\":\"" + jsonEsc(d->name) + "\",\"channels\":" + std::to_string(ctx.channels) + ",\"left\":" + std::to_string(ctx.left) + ",\"right\":" + std::to_string(ctx.right) + ",\"latencyMs\":" + std::to_string((int)((si ? si->inputLatency : 0) * 1000)));
    } else {
      toneThread = std::thread([&] { // real-time paced test tone, 10 ms blocks
        const int n = kRate / 100; double ph1 = 0, ph2 = 0; auto t0 = std::chrono::steady_clock::now(); long blocks = 0;
        while (!gQuit) {
          ctx.L.resize(n); ctx.R.resize(n);
          for (int i = 0; i < n; i++) { ctx.L[i] = 0.5f * (float)sin(ph1); ctx.R[i] = 0.5f * (float)sin(ph2); ph1 += 2 * 3.14159265358979 * 440 / kRate; ph2 += 2 * 3.14159265358979 * 660 / kRate; }
          deliver(&ctx, n);
          blocks++;
          std::this_thread::sleep_until(t0 + std::chrono::milliseconds(10 * blocks));
        }
      });
      event("\"event\":\"started\",\"device\":\"test tone\",\"channels\":2,\"latencyMs\":10");
    }
    std::thread writer(writerThread, &ring);
    std::thread control(controlThread);
#if defined(_WIN32)
    gUiThread = GetCurrentThreadId();
    WNDCLASSW wc{}; wc.lpfnWndProc = EditorProc; wc.hInstance = GetModuleHandle(nullptr); wc.lpszClassName = L"BtsVstEditor"; wc.hCursor = LoadCursor(nullptr, IDC_ARROW); RegisterClassW(&wc);
    WNDCLASSW mc{}; mc.lpfnWndProc = MsgProc; mc.hInstance = GetModuleHandle(nullptr); mc.lpszClassName = L"BtsAudioMsg"; RegisterClassW(&mc);
    gMsgWnd = CreateWindowW(L"BtsAudioMsg", L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, GetModuleHandle(nullptr), nullptr);
    MSG msg;
    while (!gQuit && GetMessage(&msg, nullptr, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessage(&msg); }
    for (auto& p : gChain) editorClose(p.get());
#else
    while (!gQuit) std::this_thread::sleep_for(std::chrono::milliseconds(50));
#endif
    gQuit = true;
    { std::lock_guard<std::mutex> l(ring.mx); ring.closed = true; ring.cv.notify_all(); }
    if (stream) { Pa_StopStream(stream); Pa_CloseStream(stream); }
    if (toneThread.joinable()) toneThread.join();
    writer.join();
    control.detach(); // blocked on stdin; the process is exiting
  } else if (mode == "out") {
    if (dev < 0 || dev >= Pa_GetDeviceCount()) { error("No such output device"); return 1; }
    auto* d = Pa_GetDeviceInfo(dev);
    int ch = std::max(2, std::min(d->maxOutputChannels, pair * 2 + 2));
    if (d->maxOutputChannels < 1) { error(std::string(d->name) + " has no outputs"); return 1; }
    ch = std::min(ch, d->maxOutputChannels);
    struct OutCtx { Ring ring{kRate * 2}; int ch, left, right; bool primed = false; std::vector<int16_t> tmp; } oc;
    oc.ch = ch; oc.left = std::min(pair * 2, ch - 1); oc.right = std::min(pair * 2 + 1, ch - 1);
    auto cb = [](const void*, void* output, unsigned long frames, const PaStreamCallbackTimeInfo*, PaStreamCallbackFlags, void* user) -> int {
      auto* c = (OutCtx*)user; float* out = (float*)output;
      memset(out, 0, frames * c->ch * sizeof(float));
      { std::lock_guard<std::mutex> l(c->ring.mx); if (!c->primed && c->ring.count < (size_t)kRate / 50 * 2) return paContinue; c->primed = true; } // 20 ms pre-roll
      c->tmp.resize(frames * 2);
      size_t got = c->ring.pop(c->tmp.data(), frames * 2) / 2;
      for (size_t i = 0; i < got; i++) { out[i * c->ch + c->left] = c->tmp[i * 2] / 32768.f; out[i * c->ch + c->right] = c->tmp[i * 2 + 1] / 32768.f; }
      if (got < frames) c->primed = false; // underrun: re-buffer
      return paContinue;
    };
    PaWasapiStreamInfo wi;
    PaStreamParameters op{dev, ch, paFloat32, d->defaultLowOutputLatency, hostSpecific(dev, exclusive, &wi)};
    PaStream* stream = nullptr;
    PaError e = Pa_OpenStream(&stream, nullptr, &op, kRate, paFramesPerBufferUnspecified, paNoFlag, cb, &oc);
    if (e != paNoError) { error(std::string("Cannot open ") + d->name + " at 48 kHz: " + Pa_GetErrorText(e)); Pa_Terminate(); return 1; }
    Pa_StartStream(stream);
    auto* si = Pa_GetStreamInfo(stream);
    event("\"event\":\"started\",\"device\":\"" + jsonEsc(d->name) + "\",\"channels\":" + std::to_string(ch) + ",\"latencyMs\":" + std::to_string((int)((si ? si->outputLatency : 0) * 1000)));
    std::vector<int16_t> buf(4800);
    while (true) {
      size_t k = fread(buf.data(), sizeof(int16_t), buf.size(), stdin);
      if (k == 0) break;
      // keep latency bounded: drop the oldest audio if the app sends faster than the device plays
      oc.ring.push(buf.data(), k - (k % 2), true);
    }
    Pa_StopStream(stream); Pa_CloseStream(stream);
  }
  for (auto& p : gChain) p->unload();
  gChain.clear();
  if (mode != "tone") Pa_Terminate();
  return rc;
}

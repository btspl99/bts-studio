'use strict';
/**
 * Function registry — shared by keyboard shortcuts, the HTTP API (/api/?Function=...) and the web controller.
 * Parameter names follow the familiar vMix-style convention: Input, Value, Duration, SelectedName.
 */
(function (BTS) {
  const U = BTS.U;
  const F = new Map();

  function def(name, group, params, fn, desc = '') { F.set(name.toLowerCase(), { name, group, params, fn, desc }); }

  const S = () => BTS.studio;
  const inp = (p, fallback = 'preview') => {
    const st = S();
    if (p.Input != null && p.Input !== '') return st.resolve(p.Input);
    return fallback === 'program' ? st.program : st.preview;
  };
  const need = (i) => { if (!i) throw new Error('Input not found'); return i; };
  const num = (v, d) => (v === undefined || v === '' || isNaN(+v) ? d : +v);

  // ---- switching
  def('PreviewInput', 'Switching', ['Input'], (p) => S().setPreview(need(inp(p))), 'Send input to Preview');
  def('PreviewInputNext', 'Switching', [], () => { const st = S(); const i = st.inputs.indexOf(st.preview); return st.setPreview(st.inputs[(i + 1) % st.inputs.length]?.id); });
  def('PreviewInputPrevious', 'Switching', [], () => { const st = S(); const i = st.inputs.indexOf(st.preview); return st.setPreview(st.inputs[(i - 1 + st.inputs.length) % st.inputs.length]?.id); });
  def('Cut', 'Switching', ['Input?'], (p) => S().cut(p.Input), 'Cut Preview (or Input) to Output');
  def('CutDirect', 'Switching', ['Input'], (p) => S().cutDirect(need(inp(p)).id), 'Cut Input straight to Output, keep Preview');
  def('QuickPlay', 'Switching', ['Input?'], (p) => S().quickPlay(p.Input));
  def('Fade', 'Switching', ['Input?', 'Duration?'], (p) => S().transition('Fade', num(p.Duration, 500), p.Input));
  for (const t of BTS.Transitions.list) if (!['Cut', 'Fade'].includes(t.id)) def(t.id, 'Transitions', ['Input?', 'Duration?'], (p) => S().transition(t.id, num(p.Duration, 1000), p.Input));
  for (let n = 1; n <= 4; n++) def(`Transition${n}`, 'Switching', ['Input?'], (p) => S().transitionButton(n, p.Input));
  def('FadeToBlack', 'Switching', [], () => { S().fadeToBlack(); return true; });
  def('SetTransitionDuration', 'Switching', ['Value', 'Duration'], (p) => { const b = S().transitions.buttons[num(p.Value, 1) - 1]; if (!b) throw new Error('Bad transition number'); b.duration = num(p.Duration, 500); S().emit('transitions-config'); return true; });
  def('SetTransitionEffect', 'Switching', ['Value', 'Input'], (p) => { const b = S().transitions.buttons[num(p.Value, 1) - 1]; if (!b) throw new Error('Bad transition number'); b.type = p.Input; S().emit('transitions-config'); return true; }, 'Value=button 1-4, Input=effect name');
  def('SetFader', 'Switching', ['Value'], (p) => { S().setTbar(num(p.Value, 0) / 255, { release: true }); return true; }, 'T-Bar position 0-255');

  // ---- overlays
  for (let n = 1; n <= 8; n++) {
    def(`OverlayInput${n}`, 'Overlays', ['Input?'], (p) => S().overlay(n, p.Input ?? null, 'toggle'), `Toggle Input on Overlay ${n}`);
    def(`OverlayInput${n}In`, 'Overlays', ['Input?'], (p) => S().overlay(n, p.Input ?? null, 'in'));
    def(`OverlayInput${n}Out`, 'Overlays', [], () => S().overlay(n, null, 'out'));
    def(`OverlayInput${n}Off`, 'Overlays', [], () => S().overlay(n, null, 'off'));
    def(`PreviewOverlayInput${n}`, 'Overlays', ['Input?'], (p) => S().overlay(n, p.Input ?? null, 'preview'));
  }
  def('OverlayInputAllOff', 'Overlays', [], () => { S().overlayAllOff(); return true; });

  // ---- playback
  def('Play', 'Playback', ['Input?'], (p) => { need(inp(p)).play(); return true; });
  def('Pause', 'Playback', ['Input?'], (p) => { need(inp(p)).pause(); return true; });
  def('PlayPause', 'Playback', ['Input?'], (p) => { need(inp(p)).togglePlay(); return true; });
  def('Restart', 'Playback', ['Input?'], (p) => { need(inp(p)).restart(); return true; });
  def('Loop', 'Playback', ['Input?'], (p) => { const i = need(inp(p)); i.setLoop ? i.setLoop(!i.props.loop) : (i.props.loop = !i.props.loop); i.emit('state'); return true; });
  def('SetPosition', 'Playback', ['Input', 'Value'], (p) => { need(inp(p)).seek(num(p.Value, 0) / 1000); return true; }, 'Value in ms');
  def('NextItem', 'Playback', ['Input?'], (p) => { need(inp(p)).next(); return true; });
  def('PreviousItem', 'Playback', ['Input?'], (p) => { need(inp(p)).prev(); return true; });
  def('SelectIndex', 'Playback', ['Input', 'Value'], (p) => { const i = need(inp(p)); if (i.load) i.load(num(p.Value, 1) - 1, i.playing); return true; });

  // ---- titles
  def('SetText', 'Titles', ['Input', 'SelectedName', 'Value'], (p) => { const i = need(inp(p)); if (i.type !== 'title') throw new Error('Not a title input'); if (!i.setText(p.SelectedName || p.SelectedIndex || 'Name', p.Value ?? '')) throw new Error('Field not found'); return true; });
  def('SetImage', 'Titles', ['Input', 'SelectedName', 'Value'], (p) => { const i = need(inp(p)); if (i.type !== 'title') throw new Error('Not a title input'); return i.setImage(p.SelectedName, p.Value); });
  def('SetColor', 'Titles', ['Input', 'SelectedName', 'Value'], (p) => { const i = need(inp(p)); return i.renderer.setColor(p.SelectedName, p.Value); });
  def('SetCountdown', 'Titles', ['Input', 'Value', 'SelectedName?'], (p) => { const i = need(inp(p)); const e = p.SelectedName ? i.renderer.find(p.SelectedName) : i.renderer.t.elements.find(x => x.type === 'countdown'); if (!e) throw new Error('No countdown'); i.renderer.setTimer(e, p.Value); return true; }, 'Value seconds or mm:ss');
  def('StartCountdown', 'Titles', ['Input', 'SelectedName?'], (p) => { need(inp(p)).renderer.timerCmd(p.SelectedName, 'start'); return true; });
  def('StopCountdown', 'Titles', ['Input', 'SelectedName?'], (p) => { need(inp(p)).renderer.timerCmd(p.SelectedName, 'stop'); return true; });
  def('PauseCountdown', 'Titles', ['Input', 'SelectedName?'], (p) => { need(inp(p)).renderer.timerCmd(p.SelectedName, 'toggle'); return true; });
  def('ResetCountdown', 'Titles', ['Input', 'SelectedName?'], (p) => { need(inp(p)).renderer.timerCmd(p.SelectedName, 'reset'); return true; });
  def('TitleBeginAnimation', 'Titles', ['Input'], (p) => { const i = need(inp(p)); i.renderer.transitionIn(); return true; });

  // ---- audio
  const ch = (p) => { const i = need(inp(p, 'program')); if (!i.channel) throw new Error('Input has no audio'); return i.channel; };
  def('SetVolume', 'Audio', ['Input', 'Value'], (p) => { ch(p).set({ volume: U.faderToGain(num(p.Value, 75) / 100) }); S().emit('mixer-values'); return true; }, 'Value 0-100 (75 = 0 dB)');
  def('SetVolumeFade', 'Audio', ['Input', 'Value'], (p) => { const [v, ms] = String(p.Value || '0,1000').split(','); ch(p).fadeTo(U.faderToGain(num(v, 0) / 100), num(ms, 1000)); return true; }, 'Value "volume,ms"');
  def('AudioOn', 'Audio', ['Input'], (p) => { ch(p).set({ muted: false }); S().emit('mixer-values'); return true; });
  def('AudioOff', 'Audio', ['Input'], (p) => { ch(p).set({ muted: true }); S().emit('mixer-values'); return true; });
  def('Audio', 'Audio', ['Input'], (p) => { const c = ch(p); c.set({ muted: !c.s.muted }); S().emit('mixer-values'); return true; }, 'Toggle mute');
  def('Solo', 'Audio', ['Input'], (p) => { const c = ch(p); c.set({ solo: !c.s.solo }); S().emit('mixer-values'); return true; });
  def('AudioAutoToggle', 'Audio', ['Input'], (p) => { const c = ch(p); c.set({ followVideo: !c.s.followVideo }); S().emit('mixer-values'); return true; }, 'Toggle audio-follow-video');
  def('AudioBus', 'Audio', ['Input', 'Value'], (p) => { const c = ch(p); const b = String(p.Value || 'M').toUpperCase(); c.s.buses[b] = !c.s.buses[b]; c.apply(); S().emit('mixer-values'); return true; }, 'Toggle routing to bus M/A/B');
  def('SetBalance', 'Audio', ['Input', 'Value'], (p) => { ch(p).set({ balance: num(p.Value, 0) }); return true; }, '-1..1');
  def('SetMasterVolume', 'Audio', ['Value'], (p) => { S().audio.setBusVolume('M', U.faderToGain(num(p.Value, 75) / 100)); S().emit('mixer-values'); return true; });
  def('MasterAudioON', 'Audio', [], () => { S().audio.setBusMute('M', false); S().emit('mixer-values'); return true; });
  def('MasterAudioOFF', 'Audio', [], () => { S().audio.setBusMute('M', true); S().emit('mixer-values'); return true; });
  def('MasterAudio', 'Audio', [], () => { const a = S().audio; a.setBusMute('M', !a.buses.M.muted); S().emit('mixer-values'); return true; });
  def('SetBusAVolume', 'Audio', ['Value'], (p) => { S().audio.setBusVolume('A', U.faderToGain(num(p.Value, 75) / 100)); S().emit('mixer-values'); return true; });
  def('SetBusBVolume', 'Audio', ['Value'], (p) => { S().audio.setBusVolume('B', U.faderToGain(num(p.Value, 75) / 100)); S().emit('mixer-values'); return true; });

  // ---- position / effects
  const pos = (p) => need(inp(p)).props.position;
  def('SetZoom', 'Position', ['Input', 'Value'], (p) => { pos(p).zoom = num(p.Value, 1); return true; });
  def('SetPanX', 'Position', ['Input', 'Value'], (p) => { pos(p).panX = num(p.Value, 0); return true; }, '-1..1 (fraction of width)');
  def('SetPanY', 'Position', ['Input', 'Value'], (p) => { pos(p).panY = num(p.Value, 0); return true; });
  def('SetRotation', 'Position', ['Input', 'Value'], (p) => { pos(p).rotate = num(p.Value, 0); return true; });
  def('SetAlpha', 'Position', ['Input', 'Value'], (p) => { need(inp(p)).props.opacity = U.clamp(num(p.Value, 255) / 255, 0, 1); return true; }, '0-255');
  def('SetCrop', 'Position', ['Input', 'Value'], (p) => { const [l, t, r, b] = String(p.Value || '0,0,0,0').split(',').map(Number); Object.assign(need(inp(p)).props.crop, { l, t, r, b }); return true; }, 'Value "l,t,r,b" fractions');
  def('ChromaKeyToggle', 'Effects', ['Input'], (p) => { const e = need(inp(p)).props.effects.chroma; e.enabled = !e.enabled; return true; });
  def('ColourCorrectionToggle', 'Effects', ['Input'], (p) => { const e = need(inp(p)).props.effects.color; e.enabled = !e.enabled; return true; });
  def('SetLayer', 'Position', ['Input', 'Value'], (p) => { const i = need(inp(p)); if (i.type !== 'scene') throw new Error('Not a scene'); const [n, on] = String(p.Value).split(','); const l = i.cfg.layers[num(n, 1) - 1]; if (!l) throw new Error('No layer'); l.visible = on === undefined ? !(l.visible !== false) : on === 'On' || on === '1' || on === 'true'; S()._updateLive(); return true; }, 'Value "layer,On|Off"');

  // ---- browser
  def('BrowserNavigate', 'Browser', ['Input', 'Value'], (p) => { const i = need(inp(p)); if (i.type !== 'browser') throw new Error('Not a browser input'); i.update({ url: p.Value }); return true; });
  def('BrowserReload', 'Browser', ['Input'], (p) => { need(inp(p)).reload(); return true; });
  def('BrowserBack', 'Browser', ['Input'], (p) => { window.bts.browser.nav(need(inp(p)).id, 'back'); return true; });
  def('BrowserForward', 'Browser', ['Input'], (p) => { window.bts.browser.nav(need(inp(p)).id, 'forward'); return true; });
  def('BrowserExecute', 'Browser', ['Input', 'Value'], async (p) => { const i = need(inp(p)); if (i.type !== 'browser') throw new Error('Not a browser input'); return i.exec(String(p.Value || '')); });
  def('SlideNext', 'Slides', ['Input?'], (p) => { need(inp(p)).next(); return true; });
  def('SlidePrevious', 'Slides', ['Input?'], (p) => { need(inp(p)).prev(); return true; });
  def('SlideSelect', 'Slides', ['Input', 'Value'], (p) => { const i = need(inp(p)); i.load(num(p.Value, 1) - 1); return true; });
  def('GuestHangUp', 'Remote Guests', ['Input'], (p) => { const i = need(inp(p)); if (i.type !== 'guest') throw new Error('Not a Remote Guest input'); i.hangup(true); return true; });
  def('GuestMessage', 'Remote Guests', ['Input', 'Value'], (p) => { const i = need(inp(p)); if (i.type !== 'guest') throw new Error('Not a Remote Guest input'); return !!i.sendChat(String(p.Value || '')); });
  def('BrowserExecute', 'Browser', ['Input', 'Value'], async (p) => { const i = need(inp(p)); if (i.type !== 'browser') throw new Error('Not a browser input'); return { ok: true, data: await i.exec(p.Value) }; }, 'Run JavaScript in the page');

  // ---- outputs
  const O = () => S().outputs;
  def('StartStreaming', 'Output', [], () => O().startStreaming());
  def('StopStreaming', 'Output', [], () => O().stopStreaming().then(() => true));
  def('StartStopStreaming', 'Output', [], () => Promise.resolve(O().toggleStreaming()).then(() => true));
  def('StartRecording', 'Output', [], () => O().startRecording());
  def('StopRecording', 'Output', [], () => O().stopRecording().then(() => true));
  def('StartStopRecording', 'Output', [], () => Promise.resolve(O().toggleRecording()).then(() => true));
  def('StartMultiCorder', 'Output', [], () => (O().isMultiCorder() ? true : O().toggleMultiCorder().then(() => true)));
  def('StopMultiCorder', 'Output', [], () => (O().isMultiCorder() ? O().toggleMultiCorder().then(() => true) : true));
  def('Snapshot', 'Output', [], async () => { const f = await window.bts.snapshot(S().snapshot()); return { ok: true, data: f }; });
  def('SnapshotInput', 'Output', ['Input'], async (p) => { const f = await window.bts.snapshot(S().thumbOf(need(inp(p)).id).replace('image/jpeg', 'image/png')); return { ok: true, data: f }; });
  def('Fullscreen', 'Output', [], () => { BTS.ui && BTS.ui.toggleExternal(); return true; });
  def('StartExternal', 'Output', ['Value?', 'Input?'], (p) => { BTS.ui.openExternal(null, p.Input ? 'input:' + need(inp(p)).id : 'program', p.Value ? num(p.Value, 1) - 1 : null); return true; }, 'Value = output 1-6, Input = optional single input (else Output)');
  def('StopExternal', 'Output', ['Value?'], (p) => { if (p.Value) BTS.ui.closeExternal(num(p.Value, 1) - 1); else for (let i = 0; i < 6; i++) BTS.ui.closeExternal(i); return true; });

  // ---- data sources
  def('DataSourceNextRow', 'Data', ['Value'], (p) => S().data.nextRow(p.Value), 'Value = data source name');
  def('DataSourcePreviousRow', 'Data', ['Value'], (p) => S().data.prevRow(p.Value));
  def('DataSourceSelectRow', 'Data', ['Value', 'Index'], (p) => S().data.selectRow(p.Value, num(p.Index, 1) - 1));
  def('DataSourceRefresh', 'Data', ['Value'], (p) => { const s = S().data.get(p.Value); if (!s) throw new Error('Unknown data source'); S().data.refresh(s); return true; });

  // ---- instant replay
  const R = () => S().replay;
  def('ReplayStartRecording', 'Replay', [], () => R().start().then(ok => ok || { ok: false, error: 'No replay source could be started' }), 'Start the replay buffer');
  def('ReplayStopRecording', 'Replay', [], () => R().stop().then(() => true));
  def('ReplayStartStopRecording', 'Replay', [], () => (R().running ? R().stop().then(() => true) : R().start()));
  def('ReplayMarkIn', 'Replay', [], () => R().markIn());
  def('ReplayMarkOut', 'Replay', [], () => R().markOut());
  def('ReplayMarkInOut', 'Replay', ['Value?'], async (p) => { const ev = await R().clip({ last: num(p.Value, R().cfg.lastSeconds) }); return ev ? { ok: true, data: ev.file } : { ok: false, error: 'Clip failed' }; }, 'Save the last N seconds (Value) as an event');
  def('ReplaySaveMarks', 'Replay', [], async () => { const ev = await R().clip({ marks: true }); return ev ? { ok: true, data: ev.file } : { ok: false, error: 'Set Mark In first' }; });
  def('ReplayPlayLastEvent', 'Replay', ['Value?'], async (p) => R().load(R().events[0], { speed: p.Value ? num(p.Value, 50) / 100 : undefined, toOutput: true }));
  def('ReplayPlayEvent', 'Replay', ['Value'], async (p) => R().load(R().events[num(p.Value, 1) - 1], { toOutput: true }), 'Value = event number (1 = newest)');
  def('ReplayInstant', 'Replay', ['Value?'], (p) => R().instant(num(p.Value, R().cfg.lastSeconds)), 'Clip last N seconds and play it to Output in slow motion');
  def('ReplaySetSpeed', 'Replay', ['Value'], (p) => R().setSpeed(U.clamp(num(p.Value, 50) / 100, 0.05, 2)), 'Value percent (25, 50, 75, 100)');
  def('ReplaySelectCamera', 'Replay', ['Value'], (p) => { const keys = R().loaded ? Object.keys(R().loaded.event.files) : R().cameras; const k = keys[num(p.Value, 1) - 1]; if (!k) throw new Error('No such replay camera'); return R().angle(k); }, 'Switch angle 1-8 (keeps playhead)');
  for (let n = 1; n <= 8; n++) def(`ReplayCamera${n}`, 'Replay', [], () => BTS.Functions.call('ReplaySelectCamera', { Value: String(n) }).then(r => r.ok || r));
  def('ReplayReturnToLive', 'Replay', [], () => R().returnToLive(), 'Back to the input that was live before the replay');
  def('ReplayPlay', 'Replay', [], () => R().goLive(), 'Send the loaded replay to Output');
  def('ReplayPause', 'Replay', [], () => { const i = R().replayInput(); if (!i) throw new Error('No replay loaded'); i.togglePlay(); return true; });
  def('ReplayPlayHighlights', 'Replay', [], () => R().playHighlights(), 'Play starred events back-to-back');
  def('ReplayJog', 'Replay', ['Value'], (p) => { const i = R().replayInput(); if (!i) throw new Error('No replay loaded'); i.pause(); i.seek(i.currentTime + num(p.Value, 0.04)); return true; }, 'Seconds (negative = back)');

  // ---- scripting (macros)
  def('ScriptStart', 'Scripting', ['Value'], (p) => S().macros.run(p.Value), 'Value = macro name');
  def('ScriptStop', 'Scripting', ['Value'], (p) => S().macros.stop(p.Value));
  def('ScriptStopAll', 'Scripting', [], () => { S().macros.stopAll(); return true; });

  // ---- playlist
  def('StartPlayList', 'Playlist', [], () => S().sequencer.start());
  def('StopPlayList', 'Playlist', [], () => S().sequencer.stop());
  def('NextPlayListEntry', 'Playlist', [], () => S().sequencer.next());
  def('PreviousPlayListEntry', 'Playlist', [], () => S().sequencer.prev());

  // ---- tickers / speed
  def('PauseTicker', 'Titles', ['Input', 'SelectedName?'], (p) => { need(inp(p)).renderer.tickerCmd(p.SelectedName, 'pause'); return true; });
  def('ResumeTicker', 'Titles', ['Input', 'SelectedName?'], (p) => { need(inp(p)).renderer.tickerCmd(p.SelectedName, 'play'); return true; });
  def('ResetTicker', 'Titles', ['Input', 'SelectedName?'], (p) => { need(inp(p)).renderer.tickerCmd(p.SelectedName, 'reset'); return true; });
  def('SetTickerSpeed', 'Titles', ['Input', 'Value', 'SelectedName?'], (p) => { const r = need(inp(p)).renderer; for (const e of r.t.elements.filter(x => x.type === 'ticker' && (!p.SelectedName || x.name === p.SelectedName))) e.speed = num(p.Value, 120); return true; }, 'pixels per second');
  def('SetRate', 'Playback', ['Input', 'Value'], (p) => { const i = need(inp(p)); if (!i.setSpeed) throw new Error('Not a media input'); i.setSpeed(U.clamp(num(p.Value, 1), 0.1, 4)); return true; }, 'Playback speed, 1 = normal');
  def('SetColourTag', 'General', ['Input', 'Value'], (p) => { const i = need(inp(p)); i.props.colorTag = p.Value || ''; S().emit('inputs'); return true; }, 'Value = #hex or empty');

  // ---- mix inputs (a second switcher)
  const mix = (p) => { const m = need(st0().resolve(p.Input)); if (m.type !== 'mix') throw new Error('Input is not a Mix'); return m; };
  const st0 = () => S();
  def('MixPreviewInput', 'Mix', ['Input', 'Value'], (p) => mix(p).setPreview(p.Value), 'Input = Mix input, Value = source');
  def('MixCut', 'Mix', ['Input', 'Value?'], (p) => mix(p).cut(p.Value ?? null), 'Cut the Mix (optionally to Value)');
  def('MixFade', 'Mix', ['Input', 'Value?', 'Duration?'], (p) => mix(p).transition('Fade', num(p.Duration, mix(p).cfg.duration), p.Value ?? null));
  def('MixTransition', 'Mix', ['Input', 'Value?'], (p) => mix(p).transition(null, null, p.Value ?? null), 'Mix default transition');
  def('SetDelay', 'General', ['Input', 'Value'], (p) => { const i = need(inp(p)); if (i.type !== 'delay') throw new Error('Not a Video Delay input'); i.cfg.delayMs = U.clamp(num(p.Value, 2000), 40, 10000); if (i.channel) i.channel.set({ delayMs: i.cfg.delayMs }); return true; }, 'Video Delay in ms');

  // ---- general
  def('AddInput', 'General', ['Value'], async (p) => { const [type, ...rest] = String(p.Value || '').split('|'); const v = rest.join('|'); const map = { Video: 'video', Image: 'image', Browser: 'browser', Colour: 'color', Color: 'color', Title: 'title' }; const t = map[type] || type.toLowerCase(); const cfg = t === 'browser' ? { url: v } : t === 'color' ? { color: v || '#000000' } : t === 'title' ? { templateId: v || 'lower-third' } : { path: v }; const i = await S().addInput({ type: t, cfg, title: v ? U.baseName(v) : undefined }); return { ok: true, data: i.id }; }, 'Value "Video|C:\\file.mp4", "Browser|https://..", "Title|lower-third"');
  def('RemoveInput', 'General', ['Input'], (p) => { S().removeInput(need(inp(p)).id); return true; });
  def('SetInputName', 'General', ['Input', 'Value'], (p) => { S().renameInput(need(inp(p)).id, p.Value); return true; });
  def('OpenPreset', 'General', ['Value'], (p) => { BTS.ui.openProject(p.Value); return true; });
  def('SavePreset', 'General', ['Value?'], (p) => { BTS.ui.saveProject(p.Value); return true; });

  async function call(name, params = {}) {
    const f = F.get(String(name).toLowerCase());
    if (!f) return { ok: false, error: `Unknown function ${name}` };
    try {
      const r = await f.fn(params);
      if (r && typeof r === 'object' && 'ok' in r) return r;
      return r === false ? { ok: false, error: 'Function could not be completed' } : { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  BTS.Functions = { call, all: () => [...F.values()].map(({ name, group, params, desc }) => ({ name, group, params, desc })), has: (n) => F.has(String(n).toLowerCase()) };
})(window.BTS);

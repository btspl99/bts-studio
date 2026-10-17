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
  const title = (p) => { const i = need(inp(p)); if (i.type !== 'title') throw new Error('Not a title input'); return i; };
  def('TitlePageNext', 'Titles', ['Input'], (p) => title(p).nextPage(), 'Show the next page (storyboard) of a title');
  def('TitlePagePrevious', 'Titles', ['Input'], (p) => title(p).prevPage());
  def('TitlePage', 'Titles', ['Input', 'Value'], (p) => title(p).goPage(num(p.Value, 1) - 1), 'Show page Value (1 = first)');
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
  def('AudioBus', 'Audio', ['Input', 'Value'], (p) => { const c = ch(p); const b = String(p.Value || 'M').toUpperCase(); c.s.buses[b] = !c.s.buses[b]; c.apply(); S().emit('mixer-values'); return true; }, 'Toggle routing to bus M/A–G');
  def('SetBalance', 'Audio', ['Input', 'Value'], (p) => { ch(p).set({ balance: num(p.Value, 0) }); return true; }, '-1..1');
  def('SetMasterVolume', 'Audio', ['Value'], (p) => { S().audio.setBusVolume('M', U.faderToGain(num(p.Value, 75) / 100)); S().emit('mixer-values'); return true; });
  def('MasterAudioON', 'Audio', [], () => { S().audio.setBusMute('M', false); S().emit('mixer-values'); return true; });
  def('MasterAudioOFF', 'Audio', [], () => { S().audio.setBusMute('M', true); S().emit('mixer-values'); return true; });
  def('MasterAudio', 'Audio', [], () => { const a = S().audio; a.setBusMute('M', !a.buses.M.muted); S().emit('mixer-values'); return true; });
  for (const b of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
    def(`SetBus${b}Volume`, 'Audio', ['Value'], (p) => { S().audio.setBusVolume(b, U.faderToGain(num(p.Value, 75) / 100)); S().emit('mixer-values'); return true; }, `Bus ${b} fader 0-100`);
    def(`Bus${b}Audio`, 'Audio', [], () => { const a = S().audio; a.setBusMute(b, !a.buses[b].muted); S().emit('mixer-values'); return true; }, `Toggle mute of Bus ${b}`);
    def(`Bus${b}AudioOn`, 'Audio', [], () => { S().audio.setBusMute(b, false); S().emit('mixer-values'); return true; });
    def(`Bus${b}AudioOff`, 'Audio', [], () => { S().audio.setBusMute(b, true); S().emit('mixer-values'); return true; });
    def(`Bus${b}ToMaster`, 'Audio', ['Value?'], (p) => { const a = S().audio; a.setBusToMaster(b, p.Value == null ? !a.buses[b].toMaster : /^(1|true|on)$/i.test(String(p.Value))); S().emit('mixer'); return true; });
  }
  def('AudioBusOn', 'Audio', ['Input', 'Value'], (p) => { const c = ch(p); c.s.buses[String(p.Value || 'M').toUpperCase()] = true; c.apply(); S().emit('mixer'); return true; }, 'Route input to bus M/A–G');
  def('AudioBusOff', 'Audio', ['Input', 'Value'], (p) => { const c = ch(p); c.s.buses[String(p.Value || 'M').toUpperCase()] = false; c.apply(); S().emit('mixer'); return true; });

  // ---- position / effects
  const pos = (p) => need(inp(p)).props.position;
  def('DigitalPTZPreset', 'Position', ['Input', 'Value', 'Duration?'], (p) => { if (!need(inp(p)).ptzPreset(num(p.Value, 1), p.Duration != null && p.Duration !== '' ? num(p.Duration, 1500) : undefined)) throw new Error('No such digital PTZ preset'); return true; }, 'Glide an input to its saved framing 1–12');
  def('DigitalPTZMove', 'Position', ['Input', 'Value', 'Duration?'], (p) => { const [z, x, y] = String(p.Value || '').split(',').map(Number); need(inp(p)).moveTo({ zoom: isNaN(z) ? undefined : z, panX: isNaN(x) ? undefined : x, panY: isNaN(y) ? undefined : y }, num(p.Duration, 1000)); return true; }, 'Value="zoom,panX,panY" e.g. 2,0.3,-0.2');
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
  const tele = async () => BTS.TelestratorUI ? BTS.TelestratorUI.ensureInput() : S().inputs.find(i => i.type === 'telestrator');
  def('TelestratorOpen', 'Telestrator', [], () => { BTS.TelestratorUI.open(); return true; });
  def('TelestratorClear', 'Telestrator', [], async () => { (await tele()).clear(); return true; });
  def('TelestratorUndo', 'Telestrator', [], async () => { (await tele()).undo(); return true; });
  // PTZ (VISCA over IP) — Input = camera input with PTZ configured (defaults to the one selected in the PTZ module)
  const ptzOf = (p) => { const i = p.Input != null && p.Input !== '' ? S().resolve(p.Input) : BTS.ptzUI && BTS.ptzUI.cam; const c = i && (i.type === 'virtual' ? i.ptz : i.cfg.ptz); if (!c || !c.host) throw new Error('No PTZ camera configured'); return c; };
  const ptzRes = (r) => (r && r.ok === false ? { ok: false, error: r.error } : true);
  const sp = (p) => U.clamp(num(p.Value, 50) / 100, 0.05, 1);
  for (const [n, x, y] of [['Up', 0, -1], ['Down', 0, 1], ['Left', -1, 0], ['Right', 1, 0], ['UpLeft', -1, -1], ['UpRight', 1, -1], ['DownLeft', -1, 1], ['DownRight', 1, 1]]) def(`PTZMove${n}`, 'PTZ', ['Input?', 'Value?'], async (p) => ptzRes(await window.bts.ptz.move(ptzOf(p), x * sp(p), y * sp(p))), `Value = speed 1-100`);
  def('PTZMoveStop', 'PTZ', ['Input?'], async (p) => ptzRes(await window.bts.ptz.stop(ptzOf(p))));
  def('PTZZoomIn', 'PTZ', ['Input?', 'Value?'], async (p) => ptzRes(await window.bts.ptz.zoom(ptzOf(p), sp(p))));
  def('PTZZoomOut', 'PTZ', ['Input?', 'Value?'], async (p) => ptzRes(await window.bts.ptz.zoom(ptzOf(p), -sp(p))));
  def('PTZZoomStop', 'PTZ', ['Input?'], async (p) => ptzRes(await window.bts.ptz.zoom(ptzOf(p), 0)));
  def('PTZHome', 'PTZ', ['Input?'], async (p) => ptzRes(await window.bts.ptz.home(ptzOf(p))));
  def('PTZFocusAuto', 'PTZ', ['Input?'], async (p) => ptzRes(await window.bts.ptz.focus(ptzOf(p), 'auto')));
  def('PTZRecallPreset', 'PTZ', ['Input?', 'Value'], async (p) => ptzRes(await window.bts.ptz.recall(ptzOf(p), num(p.Value, 1) - 1)), 'Value = preset 1-128');
  def('PTZStorePreset', 'PTZ', ['Input?', 'Value'], async (p) => ptzRes(await window.bts.ptz.store(ptzOf(p), num(p.Value, 1) - 1)));
  def('VirtualSetShot', 'Virtual Set', ['Input', 'Value'], (p) => { const i = need(inp(p)); if (i.type !== 'vset') throw new Error('Not a Virtual Set input'); const v = String(p.Value ?? '1'); const n = isNaN(+v) ? i.cfg.shots.findIndex(s => s.name.toLowerCase() === v.toLowerCase()) : +v - 1; if (!i.shot(n)) throw new Error('No such shot'); return true; }, 'Value = shot number (1 = Wide) or name');
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
  def('Fullscreen', 'Output', [], () => { BTS.DisplayOutputs.toggle(); return true; }, 'Turn the saved external outputs on / off (like the External button)');
  def('StartExternal', 'Output', ['Value?', 'Input?'], async (p) => {
    // output N goes full screen on the Nth screen that is not the control screen (or a window if there is none)
    const slot = p.Value ? num(p.Value, 1) - 1 : 0;
    const screens = (await window.bts.displays()).filter(d => !d.control);
    const d = screens[slot] || screens[0];
    BTS.ui.openExternal(d ? String(d.id) : null, p.Input ? 'input:' + need(inp(p)).id : 'program', slot);
    return true;
  }, 'Value = output 1-6, Input = optional single input (else Output). Opens full screen on a second screen when one is connected.');
  def('StartVirtualCamera', 'Output', [], () => O().vcam.live || O().vcam.start(), 'Start the BTS Studio Virtual Camera (Windows)');
  def('StopVirtualCamera', 'Output', [], () => { O().vcam.stop(); return true; });
  def('StartStopVirtualCamera', 'Output', [], () => O().vcam.toggle());
  def('StartBlackmagic', 'Output', ['Value?'], async (p) => { const n = p.Value ? num(p.Value, 1) : 1; const c = ((BTS.settings.decklink || {}).outputs || [])[n - 1]; if (!c || !c.device) throw new Error('Set up Blackmagic output ' + n + ' in External Outputs first'); return O().startDecklink(n, c); }, 'Value = Blackmagic output 1-2 (configured in External Outputs)');
  def('StopBlackmagic', 'Output', ['Value?'], (p) => O().stopDecklink(p.Value ? num(p.Value, 1) : null));
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
  def('SocialHide', 'Social', [], () => { BTS.social.hide(); return true; }, 'Take the on-air comment off');
  def('SocialShowNewest', 'Social', [], () => { const c = BTS.social.comments[0]; if (!c) throw new Error('No comments yet'); return BTS.social.show(c); }, 'Show the newest comment with the comment title');
  def('ReplayTagLastEvent', 'Replay', ['Value'], (p) => R().tagLast(String(p.Value || 'Best')), 'Add a tag (event list) to the newest event, e.g. Value=Goal');
  def('ReplayPlayTag', 'Replay', ['Value'], (p) => R().playTag(String(p.Value || '')), 'Play every event with this tag back-to-back');
  def('ReplaySelectChannel', 'Replay', ['Value'], (p) => R().select(String(p.Value || 'A').toUpperCase()), 'A or B — which replay channel the controls act on');
  def('ReplayChannelA', 'Replay', [], () => R().select('A'));
  def('ReplayChannelB', 'Replay', [], () => R().select('B'));
  def('ReplayBFollowA', 'Replay', ['Value?'], (p) => { R().cfg.bFollow = p.Value == null ? !R().cfg.bFollow : /^(1|true|on)$/i.test(String(p.Value)); R().emit('change'); return true; }, 'Replay B plays the same moment as A from another angle');
  def('ReplayBAngle', 'Replay', ['Value'], (p) => { R().cfg.bAngle = U.clamp(num(p.Value, 2), 1, 8); R().emit('change'); return true; });
  def('ReplayMusicOn', 'Replay', [], async () => { await R()._musicIn(); return true; }, 'Fade in the highlights music bed');
  def('ReplayMusicOff', 'Replay', [], () => { R()._musicOut(); return true; });
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

  // ---- vMix-compatible names (so Companion / Stream Deck profiles and scripts written for vMix work)
  const alias = (name, target, map = (p) => p, desc = '') => { if (!F.has(name.toLowerCase())) def(name, 'vMix compatible', F.get(target.toLowerCase())?.params || [], (p) => call(target, map(p)), desc || `Same as ${target}`); };
  alias('ActiveInput', 'CutDirect');
  alias('NextTitlePreset', 'TitlePageNext'); alias('PreviousTitlePreset', 'TitlePagePrevious');
  alias('SelectTitlePreset', 'TitlePage', (p) => ({ ...p, Value: String(num(p.Value, 0) + 1) }), 'Value 0-based like vMix');
  def('StartStopMultiCorder', 'vMix compatible', [], () => call(O().isMultiCorder() ? 'StopMultiCorder' : 'StartMultiCorder'));
  def('StartStopExternal', 'vMix compatible', [], () => { BTS.DisplayOutputs.toggle(); return true; });
  const titleEl = (p) => { const i = need(inp(p)); if (i.type !== 'title') throw new Error('Not a title input'); const e = i.renderer.find(p.SelectedName || p.SelectedIndex || 'Name'); if (!e) throw new Error('Field not found'); return [i, e]; };
  for (const [nm, v] of [['SetTextVisibleOn', false], ['SetTextVisibleOff', true], ['SetImageVisibleOn', false], ['SetImageVisibleOff', true]]) def(nm, 'Titles', ['Input', 'SelectedName'], (p) => { const [i, e] = titleEl(p); e.hidden = v; i.emit('fields'); return true; });
  for (const nm of ['SetTextVisible', 'SetImageVisible']) def(nm, 'Titles', ['Input', 'SelectedName'], (p) => { const [i, e] = titleEl(p); e.hidden = !e.hidden; i.emit('fields'); return true; }, 'Toggle a title field');
  def('SetTextColour', 'Titles', ['Input', 'SelectedName', 'Value'], (p) => { const [i, e] = titleEl(p); e.color = String(p.Value || '#ffffff'); i.emit('fields'); return true; }, 'Value #RRGGBB');
  def('AdjustCountdown', 'Titles', ['Input', 'Value', 'SelectedName?'], (p) => { const i = need(inp(p)); const e = p.SelectedName ? i.renderer.find(p.SelectedName) : i.renderer.t.elements.find(x => x.type === 'countdown'); if (!e) throw new Error('No countdown'); const tm = i.renderer.timers[e.id]; const cur = i.renderer.timerValue(e); if (tm) { tm.value = Math.max(0, cur + num(p.Value, 0)); if (tm.running) tm.startedAt = performance.now(); } return true; }, 'Add Value seconds (negative to subtract)');
  // input layers (vMix "MultiView overlays"): Value = layer number 1-10
  const layerOf = (p) => { const i = need(inp(p)); const list = i.type === 'scene' ? i.cfg.layers : (i.props.layers || []); const l = list[num(p.Value, 1) - 1]; if (!l) throw new Error('No layer ' + p.Value); return l; };
  def('LayerOn', 'Position', ['Input', 'Value'], (p) => { layerOf(p).visible = true; S()._updateLive(); return true; }, 'Show layer Value of an input');
  def('LayerOff', 'Position', ['Input', 'Value'], (p) => { layerOf(p).visible = false; S()._updateLive(); return true; });
  def('LayerToggle', 'Position', ['Input', 'Value'], (p) => { const l = layerOf(p); l.visible = l.visible === false; S()._updateLive(); return true; });
  alias('MultiViewOverlayOn', 'LayerOn'); alias('MultiViewOverlayOff', 'LayerOff'); alias('MultiViewOverlay', 'LayerToggle');
  def('KeyPress', 'General', ['Value'], (p) => { const k = String(p.Value || ''); const list = (BTS.ui && BTS.ui.shortcuts || []).filter(s => s.key.toLowerCase() === k.toLowerCase()); if (!list.length) throw new Error('No shortcut on ' + k); for (const sc of list) setTimeout(() => call(sc.fn, sc.params || {}), +sc.delay || 0); return true; }, 'Run the shortcut(s) on a key, e.g. Value=Ctrl+1');

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

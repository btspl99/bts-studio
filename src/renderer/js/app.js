'use strict';
/** BTS Studio — renderer bootstrap */
(async function (BTS) {
  const U = BTS.U;
  // never let a script error go unnoticed: log to file, keep running
  window.addEventListener('error', (e) => window.bts.log('error', `${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => window.bts.log('error', 'Unhandled: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
  const query = new URLSearchParams(location.search);
  try {
    const settings = await window.bts.settings.get();
    BTS.settings = settings;
    const info = await window.bts.info();
    const st = BTS.studio = new BTS.Studio(settings);
    st.version = info.version;
    st.outputs = new BTS.OutputManager(st);
    st.data = new BTS.DataSources(st);
    st.macros = new BTS.Macros(st);
    st.replay = new BTS.Replay(st);
    st.sequencer = new BTS.Sequencer(st);
    st.midi = new BTS.Midi(st);
    st.midi.init().then(ok => { if (ok && st.midi.devices.length) U.toast('MIDI controller: ' + st.midi.devices.join(', ')); });
    BTS.ui = new BTS.MainUI(st);
    BTS.inputsUI = new BTS.InputsUI(st);
    BTS.mixerUI = new BTS.MixerUI(st);
    BTS.health = new BTS.Health(st);
    BTS.operatorUI = new BTS.OperatorUI(st);
    BTS.workspaceUI = new BTS.WorkspaceUI(st);
    BTS.operatorUI.mountModules();
    BTS.DisplayOutputs.init();
    setTimeout(() => { const vm = BTS.settings.virtualMic; if (vm && vm.bus) st.audio.setVirtualMic(vm.bus).then(r => { if (!r.ok) console.warn('virtual mic', r.error); }); }, 2000);
    BTS.proAudioOut = new BTS.ProAudioOut(st);
    setTimeout(() => { try { if (BTS.proAudioOut.cfg().autoStart) BTS.proAudioOut.startAll(); } catch (e) { console.warn('pro audio autostart', e); } }, 3000);
    setTimeout(() => { try { const n = BTS.studio.outputs.ndi; if (n && n.cfg().autoStart) n.startAll(); } catch (e) { console.warn('ndi autostart', e); } }, 2500);
    setTimeout(async () => { try { const v = BTS.studio.outputs.vcam; if (v && v.cfg().autoStart && (await window.bts.vcam.status()).installed) v.start(); } catch (e) { console.warn('vcam autostart', e); } }, 3000);
    if (localStorage.getItem('bts.density') === 'compact') document.body.classList.add('compact');

    // main-process bridges
    window.bts.onMenu((m) => BTS.ui.handleMenu(m));
    window.bts.api.onCall(async ({ reqId, fn, params }) => {
      let r;
      if (fn === '__thumb') { try { r = { ok: true, data: st.thumbOf(params.Input, params.Width, params.Quality ? +params.Quality : undefined) }; } catch (e) { r = { ok: false, error: e.message }; } }
      else r = await BTS.Functions.call(fn, params || {});
      window.bts.api.result(reqId, r);
    });
    window.bts.api.functions(BTS.Functions.all());
    setTimeout(() => window.bts.output.encoders(), 3000); // warm encoder probe cache
    const pushState = () => { try { window.bts.api.state(st.apiState()); } catch (e) { /* noop */ } };
    setInterval(pushState, 400);
    // push immediately on switching so tally (HTTP / TCP) follows within a frame
    let pushT = 0; const pushSoon = () => { if (!pushT) pushT = setTimeout(() => { pushT = 0; pushState(); }, 15); };
    st.on('live-changed', pushSoon); st.on('overlays', pushSoon); st.on('transition', pushSoon); st.on('bus', pushSoon);

    window.bts.browser.onFrame((id, w, h, buf) => { const i = st.byId(id); if (i && i.onFrame) i.onFrame(w, h, buf); });
    window.bts.browser.onStatus((id, s) => {
      const i = st.byId(id); if (!i) return;
      if (s.error) i.setStatus('error', s.error);
      else if (s.loaded) { i.pageTitle = s.title; if (i.status !== 'ok') i.setStatus('ok'); }
    });
    window.bts.update.onStatus((s) => BTS.SettingsUI.onUpdateStatus(s));
    window.bts.onNotice((n) => U.toast(n.message, n.level || 'info', 9000));
    window.bts.stream.onStatus((s) => { const i = st.byId(s.id); if (i && i.onStreamStatus) i.onStreamStatus(s); });
    window.bts.stream.onAudio((id, buf) => { const i = st.byId(id); if (i && i.onAudio) i.onAudio(buf); });

    // startup: file passed on command line, crash recovery, or first-run demo
    const pending = await window.bts.project.pending();
    const clean = localStorage.getItem('bts.cleanExit');
    localStorage.setItem('bts.cleanExit', '0');
    window.addEventListener('beforeunload', () => { localStorage.setItem('bts.cleanExit', '1'); st.outputs.stopAll(); });

    if (query.get('recover') === '1') {
      const auto = await window.bts.project.autosaveRead();
      if (auto) await st.load(auto);
      U.toast(`The engine was restarted after a problem (${query.get('reason') || 'unknown'}). Your last autosave was restored — restart streaming/recording if needed.`, 'error', 12000);
    } else if (pending) await BTS.ui.openProject(pending);
    else {
      const auto = await window.bts.project.autosaveRead();
      if (auto && auto.inputs && auto.inputs.length && clean === '0') {
        if (await BTS.Dialog.confirm('BTS Studio did not close normally. Restore your last session?', { ok: 'Restore' })) await st.load(auto);
      } else if (auto && auto.inputs && auto.inputs.length && localStorage.getItem('bts.restoreLast') !== '0') {
        await st.load(auto);
      } else if (!localStorage.getItem('bts.firstRunDone')) {
        await st.addInput({ type: 'color', title: 'Bars', cfg: { mode: 'bars', label: 'BTS STUDIO' } });
        await st.addInput({ type: 'color', title: 'Black', cfg: { mode: 'solid', color: '#000000' } }, { select: false });
        await st.addInput({ type: 'title', title: 'Lower Third', cfg: { templateId: 'lower-third' } }, { select: false });
        await st.addInput({ type: 'title', title: 'Clock', cfg: { templateId: 'clock' } }, { select: false });
        st.setPreview(st.inputs[1].id);
        localStorage.setItem('bts.firstRunDone', '1');
        setTimeout(() => U.toast('Welcome to BTS Studio! Click "＋ Add Input" or drop media files below to get started.', 'ok', 8000), 800);
      }
    }
    BTS.ui.updateFormatInfo();
    setInterval(() => BTS.ui.saveAutosave(), 20000);
    document.body.classList.add('ready');
  } catch (e) {
    console.error(e);
    document.body.innerHTML = `<pre style="color:#f88;padding:20px;white-space:pre-wrap">BTS Studio failed to start:\n${U.esc(e.stack || e.message)}</pre>`;
  }
})(window.BTS);

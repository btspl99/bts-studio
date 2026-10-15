'use strict';
/** BTS Studio — renderer bootstrap */
(async function (BTS) {
  const U = BTS.U;
  try {
    const settings = await window.bts.settings.get();
    BTS.settings = settings;
    const info = await window.bts.info();
    const st = BTS.studio = new BTS.Studio(settings);
    st.version = info.version;
    st.outputs = new BTS.OutputManager(st);
    st.data = new BTS.DataSources(st);
    BTS.ui = new BTS.MainUI(st);
    BTS.inputsUI = new BTS.InputsUI(st);
    BTS.mixerUI = new BTS.MixerUI(st);

    // main-process bridges
    window.bts.onMenu((m) => BTS.ui.handleMenu(m));
    window.bts.api.onCall(async ({ reqId, fn, params }) => {
      let r;
      if (fn === '__thumb') { try { r = { ok: true, data: st.thumbOf(params.Input) }; } catch (e) { r = { ok: false, error: e.message }; } }
      else r = await BTS.Functions.call(fn, params || {});
      window.bts.api.result(reqId, r);
    });
    window.bts.api.functions(BTS.Functions.all());
    setTimeout(() => window.bts.output.encoders(), 3000); // warm encoder probe cache
    setInterval(() => { try { window.bts.api.state(st.apiState()); } catch (e) { /* noop */ } }, 400);

    window.bts.browser.onFrame((id, w, h, buf) => { const i = st.byId(id); if (i && i.onFrame) i.onFrame(w, h, buf); });
    window.bts.browser.onStatus((id, s) => {
      const i = st.byId(id); if (!i) return;
      if (s.error) i.setStatus('error', s.error);
      else if (s.loaded) { i.pageTitle = s.title; if (i.status !== 'ok') i.setStatus('ok'); }
    });
    window.bts.update.onStatus((s) => BTS.SettingsUI.onUpdateStatus(s));

    // startup: file passed on command line, crash recovery, or first-run demo
    const pending = await window.bts.project.pending();
    const clean = localStorage.getItem('bts.cleanExit');
    localStorage.setItem('bts.cleanExit', '0');
    window.addEventListener('beforeunload', () => { localStorage.setItem('bts.cleanExit', '1'); st.outputs.stopAll(); });

    if (pending) await BTS.ui.openProject(pending);
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
    setInterval(() => BTS.ui.saveAutosave(), 30000);
    document.body.classList.add('ready');
  } catch (e) {
    console.error(e);
    document.body.innerHTML = `<pre style="color:#f88;padding:20px;white-space:pre-wrap">BTS Studio failed to start:\n${U.esc(e.stack || e.message)}</pre>`;
  }
})(window.BTS);

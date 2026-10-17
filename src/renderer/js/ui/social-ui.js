'use strict';
/**
 * Social — live comments from YouTube and Twitch, approved by the operator and shown with a title.
 * Twitch chat is read anonymously over its public IRC WebSocket (no login). YouTube uses the
 * YouTube Data API v3 (an API key from console.cloud.google.com and the live video's ID or URL).
 */
(function (BTS) {
  const U = BTS.U;

  class Social extends BTS.Emitter {
    constructor() {
      super();
      this.comments = []; // newest first {id, src, name, text, avatar, t, shown}
      this.status = { twitch: 'off', youtube: 'off' };
      this.tw = null; this.yt = null;
    }
    get cfg() { const s = BTS.settings; s.social = s.social || { twitch: '', ytKey: '', ytVideo: '', titleId: '', nameField: '', textField: '', overlay: 1, autoHideSec: 10 }; return s.social; }
    _add(c) {
      c.id = c.id || U.uid('c'); c.t = c.t || Date.now();
      if (this.comments.some(x => x.id === c.id)) return;
      this.comments.unshift(c); if (this.comments.length > 300) this.comments.pop();
      this.emit('comment', c);
    }
    _status(k, v) { this.status[k] = v; this.emit('status'); }

    /* ---------- Twitch (anonymous IRC over WebSocket) ---------- */
    connectTwitch(channel) {
      this.disconnectTwitch();
      channel = String(channel || '').trim().replace(/^.*twitch\.tv\//i, '').replace(/^#/, '').toLowerCase();
      if (!channel) return;
      const ws = this.tw = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
      this._status('twitch', 'connecting');
      ws.onopen = () => { ws.send('CAP REQ :twitch.tv/tags'); ws.send('PASS SCHMOOPIIE'); ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`); ws.send(`JOIN #${channel}`); };
      ws.onmessage = (e) => {
        for (const line of String(e.data).split('\r\n')) {
          if (!line) continue;
          if (line.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv'); continue; }
          if (/ 366 /.test(line)) this._status('twitch', 'live');
          const m = /^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\S+ :(.*)$/.exec(line);
          if (!m) continue;
          const tags = Object.fromEntries((m[1] || '').split(';').map(kv => kv.split('=')));
          this._add({ id: 'tw-' + (tags.id || Date.now() + Math.random()), src: 'twitch', name: (tags['display-name'] || m[2]).replace(/\\s/g, ' '), text: m[3], color: tags.color || '' });
        }
      };
      ws.onclose = () => { if (this.tw === ws) { this._status('twitch', 'off'); this._twRetry = setTimeout(() => { if (this.tw === ws) this.connectTwitch(channel); }, 5000); } };
      ws.onerror = () => this._status('twitch', 'error');
    }
    disconnectTwitch() { clearTimeout(this._twRetry); const w = this.tw; this.tw = null; if (w) try { w.close(); } catch { /* noop */ } this._status('twitch', 'off'); }

    /* ---------- YouTube (Data API v3) ---------- */
    async connectYouTube(key, video) {
      this.disconnectYouTube();
      key = String(key || '').trim();
      const id = (/(?:v=|youtu\.be\/|live\/|shorts\/)([\w-]{11})/.exec(video) || [])[1] || String(video || '').trim();
      if (!key || !/^[\w-]{11}$/.test(id)) { this._status('youtube', 'error'); U.toast('YouTube: enter an API key and the live video ID or URL', 'error'); return; }
      const token = this.yt = { stop: false };
      this._status('youtube', 'connecting');
      try {
        const v = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${id}&key=${encodeURIComponent(key)}`)).json();
        if (v.error) throw new Error(v.error.message);
        const chat = v.items && v.items[0] && v.items[0].liveStreamingDetails && v.items[0].liveStreamingDetails.activeLiveChatId;
        if (!chat) throw new Error('This video has no active live chat (is the stream live?)');
        let page = '';
        this._status('youtube', 'live');
        while (!token.stop) {
          const r = await (await fetch(`https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${encodeURIComponent(chat)}&part=snippet,authorDetails&maxResults=200&key=${encodeURIComponent(key)}${page ? '&pageToken=' + page : ''}`)).json();
          if (r.error) throw new Error(r.error.message);
          for (const it of r.items || []) {
            const s = it.snippet || {}, a = it.authorDetails || {};
            if (s.type && !/textMessageEvent|superChatEvent/.test(s.type)) continue;
            this._add({ id: 'yt-' + it.id, src: 'youtube', name: a.displayName || 'Viewer', text: s.displayMessage || '', avatar: a.profileImageUrl || '', t: Date.parse(s.publishedAt) || Date.now(), superChat: s.type === 'superChatEvent' });
          }
          page = r.nextPageToken || page;
          await new Promise(res => setTimeout(res, Math.max(2000, r.pollingIntervalMillis || 5000)));
        }
      } catch (e) {
        if (!token.stop) { this._status('youtube', 'error'); U.toast('YouTube chat: ' + e.message, 'error', 9000); }
      }
    }
    disconnectYouTube() { if (this.yt) this.yt.stop = true; this.yt = null; this._status('youtube', 'off'); }

    /* ---------- on air ---------- */
    show(c) {
      const st = BTS.studio, cfg = this.cfg;
      const t = st.byId(cfg.titleId) || st.inputs.find(i => i.type === 'title');
      if (!t) { U.toast('Choose a title for comments (⚙ in the Social window)', 'error'); return false; }
      const fields = t.renderer ? t.renderer.fields.map(f => f.name) : [];
      const nf = cfg.nameField || fields[0], tf = cfg.textField || fields[1] || fields[0];
      if (nf) t.setText(nf, c.name);
      if (tf && tf !== nf) t.setText(tf, c.text); else if (tf) t.setText(tf, `${c.name}: ${c.text}`);
      for (const x of this.comments) x.shown = x === c;
      st.overlay(cfg.overlay || 1, t.id, 'in');
      clearTimeout(this._hide);
      if (cfg.autoHideSec > 0) this._hide = setTimeout(() => this.hide(), cfg.autoHideSec * 1000);
      this.emit('change');
      return true;
    }
    hide() { clearTimeout(this._hide); BTS.studio.overlay(this.cfg.overlay || 1, null, 'out'); for (const x of this.comments) x.shown = false; this.emit('change'); }
  }

  let dlg = null;
  function open() {
    const S = BTS.social, cfg = S.cfg, st = BTS.studio;
    if (dlg && document.body.contains(dlg.el)) return;
    const list = U.el('div', { class: 'list social-list', style: { height: '360px', overflow: 'auto' } });
    const stat = U.el('div', { class: 'hint' });
    const draw = () => {
      stat.textContent = `Twitch: ${S.status.twitch} · YouTube: ${S.status.youtube} · ${S.comments.length} comments`;
      list.innerHTML = '';
      if (!S.comments.length) list.append(U.el('div', { class: 'mod-empty', text: 'Comments appear here. Click one to show it on air with the chosen title.' }));
      for (const c of S.comments.slice(0, 150)) {
        list.append(U.el('div', { class: 'li' + (c.shown ? ' sel' : ''), style: { cursor: 'pointer', alignItems: 'flex-start' }, onclick: () => S.show(c) }, [
          U.el('span', { text: c.src === 'twitch' ? '🟣' : '🔴', style: { marginRight: '6px' } }),
          U.el('div', { class: 'grow' }, [U.el('b', { text: c.name + (c.superChat ? ' 💲' : '') }), U.el('div', { text: c.text, style: { whiteSpace: 'normal' } })]),
          U.el('span', { class: 'hint', text: new Date(c.t).toLocaleTimeString() })
        ]));
      }
    };
    const titles = st.inputs.filter(i => i.type === 'title');
    if (!cfg.titleId && titles[0]) cfg.titleId = titles[0].id;
    const fieldsOf = () => { const t = st.byId(cfg.titleId); return t && t.renderer ? t.renderer.fields.map(f => [f.name, f.name]) : []; };
    const form = BTS.Dialog.form([
      { section: 'Twitch' },
      { label: 'Channel', key: 'twitch', placeholder: 'channel name or twitch.tv/… link' },
      { custom: U.el('div', { class: 'inline' }, [U.el('button', { class: 'btn', text: 'Connect', onclick: () => { BTS.SettingsUI.save(); S.connectTwitch(cfg.twitch); } }), U.el('button', { class: 'btn', text: 'Disconnect', onclick: () => S.disconnectTwitch() })]) },
      { section: 'YouTube' },
      { label: 'API key', key: 'ytKey', type: 'password', hint: 'Free from console.cloud.google.com → APIs → YouTube Data API v3 → Credentials.' },
      { label: 'Live video', key: 'ytVideo', placeholder: 'https://youtube.com/live/… or video ID' },
      { custom: U.el('div', { class: 'inline' }, [U.el('button', { class: 'btn', text: 'Connect', onclick: () => { BTS.SettingsUI.save(); S.connectYouTube(cfg.ytKey, cfg.ytVideo); } }), U.el('button', { class: 'btn', text: 'Disconnect', onclick: () => S.disconnectYouTube() })]) },
      { section: 'On air' },
      { label: 'Title', key: 'titleId', type: 'select', options: titles.map(t => [t.id, `${t.number}. ${t.title}`]) },
      { label: 'Name field', key: 'nameField', type: 'select', options: [['', 'First field'], ...fieldsOf()] },
      { label: 'Comment field', key: 'textField', type: 'select', options: [['', 'Second field'], ...fieldsOf()] },
      { label: 'Overlay channel', key: 'overlay', type: 'select', number: true, options: [1, 2, 3, 4, 5, 6, 7, 8].map(n => [n, 'Overlay ' + n]) },
      { label: 'Hide after (s)', key: 'autoHideSec', type: 'number', min: 0, max: 120, hint: '0 = stays until you press Hide.' }
    ], cfg);
    const body = U.el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '14px' } }, [form, U.el('div', {}, [stat, list, U.el('div', { class: 'inline', style: { marginTop: '6px' } }, [U.el('button', { class: 'btn danger', text: 'Hide comment', onclick: () => S.hide() }), U.el('button', { class: 'btn', text: 'Clear list', onclick: () => { S.comments = []; draw(); } })])])]);
    const off1 = S.on('comment', draw), off2 = S.on('status', draw), off3 = S.on('change', draw);
    draw();
    dlg = BTS.Dialog.open({ title: 'Social — live comments', body, width: 980, onClose: () => { off1(); off2(); off3(); BTS.SettingsUI.save(); }, buttons: [{ label: 'Close', primary: true }] });
  }

  BTS.Social = Social;
  BTS.social = new Social();
  BTS.SocialUI = { open };
})(window.BTS);

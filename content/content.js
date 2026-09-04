/**
 * StudOn content script.
 *
 * Zeigt den ⚡-Badge und einen kleinen Dialog direkt auf der Kursseite:
 * Was exportieren, in welches Notebook, los. Der Dialog sammelt nur die
 * Entscheidung – die Arbeit macht der Export-Tab, der mit den gewählten
 * Parametern geöffnet wird und sofort startet.
 *
 * Alles lebt in einem Shadow DOM, damit ILIAS-CSS und unser Design sich
 * nicht in die Quere kommen.
 */
(function studonToNotebookLM() {
  if (window.top !== window) return;
  if (document.getElementById('s2n-host')) return;

  const TYPE_LABELS = {
    crs: 'Kurs', fold: 'Ordner', grp: 'Gruppe', sess: 'Sitzung', lm: 'Lernmodul', exc: 'Übung', copa: 'Inhaltsseite',
    wiki: 'Wiki', frm: 'Forum', mcst: 'Mediacast', webr: 'Weblinks', glo: 'Glossar', cat: 'Kategorie', file: 'Datei',
  };

  /** Chips im Dialog → Scan-Optionen des Exporters (lib/storage.js DEFAULT_SETTINGS.scan). */
  const CHIPS = [
    { label: 'Dateien', opts: ['files'] },
    { label: 'Lernmodule', opts: ['learningModules'] },
    { label: 'Übungen & Sitzungen', opts: ['exercises', 'sessions'] },
    { label: 'Seiten & Glossare', opts: ['pages', 'wiki', 'glossary', 'courseInfo'] },
    { label: 'Links & Videos', opts: ['weblinks', 'fauTv', 'media'] },
  ];
  const CHIP_OPTS = new Set(CHIPS.flatMap((c) => c.opts));

  /* ---------- Objekt erkennen ---------- */

  function parseLink(href) {
    if (!href) return null;
    const h = href.replace(/&amp;/g, '&');
    let m = h.match(/\/go\/([a-z0-9]+)\/(\d+)/i) || h.match(/goto\.php\?(?:[^#]*&)?target=([a-z0-9]+)_(\d+)/i);
    if (m) return { type: m[1].toLowerCase(), refId: m[2] };
    m = h.match(/[?&]ref_id=(\d+)/i);
    if (!m) return null;
    let type = null;
    if (/ilLMPresentationGUI/i.test(h)) type = 'lm';
    else if (/ilExerciseHandlerGUI/i.test(h)) type = 'exc';
    else if (/ilwikihandlergui/i.test(h)) type = 'wiki';
    else if (/ilobjforumgui/i.test(h)) type = 'frm';
    else if (/ilLinkResourceHandlerGUI/i.test(h)) type = 'webr';
    else if (/ilGlossaryPresentationGUI/i.test(h)) type = 'glo';
    else if (/ilobjmediacastgui|ilMediaCastHandlerGUI/i.test(h)) type = 'mcst';
    else if (/ilobjcontentpagegui/i.test(h)) type = 'copa';
    else if (/ilobjfilegui/i.test(h)) type = 'file';
    return { type, refId: m[1] };
  }

  function detectObject() {
    let current = parseLink(location.href);
    if (!current || !current.refId) {
      const counts = new Map();
      for (const a of document.querySelectorAll('.ilTabs a[href*="ref_id="], #ilTab a[href*="ref_id="], .il-mainbar a[href*="ref_id="], a.il-link[href*="ref_id="]')) {
        const p = parseLink(a.getAttribute('href'));
        if (p) counts.set(p.refId, (counts.get(p.refId) || 0) + 1);
      }
      let best = null;
      for (const [refId, n] of counts) if (!best || n > best.n) best = { refId, n };
      if (best) current = { refId: best.refId, type: null };
    }
    if (!current || !current.refId || current.refId === '1') return null;
    if (!current.type) {
      const icon = document.querySelector('.il-page-content-header img.icon, .ilHeaderImage img, #headerimage');
      const src = icon ? icon.getAttribute('src') || '' : '';
      const m = src.match(/icon_([a-z0-9]+)\./i);
      if (m) current.type = m[1].toLowerCase();
      else if (/baseClass=ilrepositorygui/i.test(location.href) || /\/go\//.test(location.href)) current.type = 'crs';
    }
    return current;
  }

  function detectTitle() {
    const h = document.querySelector('.il-page-content-header h1, .il-page-content-header, h1.ilHeader, .ilHeader h1, #il_center_col h1');
    let title = h ? h.textContent.trim() : '';
    if (!title) title = document.title.replace(/\s*[:\-–]\s*StudOn\s*$/i, '').replace(/^Inhalt\s*[:\-–]\s*/i, '').trim();
    return title.replace(/\s+/g, ' ');
  }

  const obj = detectObject();
  if (!obj) return;
  const title = detectTitle();
  const label = TYPE_LABELS[obj.type] || 'Objekt';

  /* ---------- Shadow DOM ---------- */

  const host = document.createElement('div');
  host.id = 's2n-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <link rel="stylesheet" href="${chrome.runtime.getURL('content/content.css')}">
    <button type="button" class="badge" id="badge" title="${label} nach NotebookLM exportieren">
      <span class="bolt">⚡</span><span>NotebookLM</span>
    </button>

    <div class="backdrop" id="backdrop" hidden>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <header>
          <div class="eyebrow"><span class="bolt">⚡</span> Nach NotebookLM</div>
          <button type="button" class="close" id="close" aria-label="Schließen">×</button>
          <h1 id="dlg-title"></h1>
          <div class="meta" id="meta"></div>
        </header>

        <section>
          <div class="section-label">Inhalt</div>
          <div class="chips" id="chips"></div>
        </section>

        <section>
          <div class="section-label">Notebook</div>
          <div class="segment" role="radiogroup">
            <button type="button" class="seg" data-mode="new" aria-checked="true">Neu anlegen</button>
            <button type="button" class="seg" data-mode="existing" aria-checked="false">Vorhandenes</button>
          </div>
          <input type="text" id="nb-title" class="field" placeholder="Titel des Notebooks" spellcheck="false">
          <div class="select-wrap" id="nb-existing-wrap" hidden>
            <select id="nb-existing" class="field"><option value="">Lade Notebooks …</option></select>
          </div>
          <div class="hint" id="nb-hint"></div>
        </section>

        <footer>
          <div class="status" id="status"><span class="dot"></span><span id="status-text">NotebookLM wird geprüft …</span></div>
          <div class="actions">
            <button type="button" class="ghost" id="more">Mehr Einstellungen <span class="arrow">↗</span></button>
            <button type="button" class="primary" id="go">Exportieren</button>
          </div>
        </footer>
      </div>
    </div>`;
  document.body.appendChild(host);

  const $ = (id) => root.getElementById(id);
  const backdrop = $('backdrop');
  const state = {
    mode: 'new',
    scan: {},            // vollständige Scan-Optionen (aus Einstellungen, von Chips überschrieben)
    notebooks: [],
    nlmOk: null,
    lastNotebookId: null,
    lastNotebookTitle: '',
  };

  $('dlg-title').textContent = title || `StudOn ${obj.refId}`;
  $('meta').textContent = `${label} · ref ${obj.refId}`;
  $('nb-title').value = title;

  /* ---------- Chips ---------- */

  function renderChips() {
    const wrap = $('chips');
    wrap.innerHTML = '';
    for (const chip of CHIPS) {
      const on = chip.opts.some((o) => state.scan[o]);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.innerHTML = `<span class="tick">✓</span>${chip.label}`;
      b.addEventListener('click', () => {
        const next = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', next ? 'true' : 'false');
        for (const o of chip.opts) state.scan[o] = next;
        updateGo();
      });
      wrap.appendChild(b);
    }
  }

  function enabledScanKeys() {
    return Object.entries(state.scan).filter(([, v]) => v).map(([k]) => k);
  }

  /* ---------- Notebook-Wahl ---------- */

  function setMode(mode) {
    state.mode = mode;
    for (const b of root.querySelectorAll('.seg')) b.setAttribute('aria-checked', b.dataset.mode === mode ? 'true' : 'false');
    $('nb-title').hidden = mode !== 'new';
    $('nb-existing-wrap').hidden = mode !== 'existing';
    const hint = $('nb-hint');
    if (mode === 'existing' && state.lastNotebookId) {
      hint.textContent = `Zuletzt für diesen ${label} verwendet – nur Neues wird ergänzt.`;
    } else if (mode === 'existing') {
      hint.textContent = 'Bereits vorhandene Quellen bleiben unberührt.';
    } else {
      hint.textContent = '';
    }
    updateGo();
  }

  function renderNotebooks() {
    const sel = $('nb-existing');
    sel.innerHTML = '';
    if (!state.notebooks.length) {
      sel.innerHTML = '<option value="">Keine eigenen Notebooks gefunden</option>';
      return;
    }
    for (const nb of state.notebooks) {
      const o = document.createElement('option');
      o.value = nb.id;
      o.textContent = `${nb.emoji ? `${nb.emoji} ` : ''}${nb.title} · ${nb.sourceCount} Quellen`;
      sel.appendChild(o);
    }
    if (state.lastNotebookId && state.notebooks.some((n) => n.id === state.lastNotebookId)) sel.value = state.lastNotebookId;
  }

  function setStatus(kind, text) {
    const dot = $('status').querySelector('.dot');
    dot.className = `dot ${kind}`;
    $('status-text').textContent = text;
  }

  function updateGo() {
    const nothing = enabledScanKeys().filter((k) => CHIP_OPTS.has(k)).length === 0;
    const needsNotebook = state.mode === 'existing' && !$('nb-existing').value;
    $('go').disabled = nothing || needsNotebook || state.nlmOk === false;
  }

  /* ---------- Daten laden ---------- */

  function storageGet(keys) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(keys, (data) => resolve(data || {})); } catch { resolve({}); }
    });
  }

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => resolve(chrome.runtime.lastError ? null : res));
      } catch { resolve(null); }
    });
  }

  async function load() {
    const data = await storageGet(['settings', `course:${obj.refId}`]);
    const scanDefaults = {
      files: true, learningModules: true, pages: true, wiki: true, glossary: true, exercises: true,
      sessions: true, forum: false, media: true, weblinks: true, fauTv: true, courseInfo: true,
    };
    state.scan = { ...scanDefaults, ...((data.settings && data.settings.scan) || {}) };
    renderChips();

    const course = data[`course:${obj.refId}`];
    if (course && course.primaryNotebookId) {
      state.lastNotebookId = course.primaryNotebookId;
      const nb = (course.notebooks || []).find((n) => n.id === course.primaryNotebookId);
      state.lastNotebookTitle = nb ? nb.title : '';
      const n = Object.keys(course.items || {}).length;
      $('meta').textContent = `${label} · ref ${obj.refId} · ${n} Objekte bereits in NotebookLM`;
    }
    // Neu ist der Normalfall; wurde der Kurs schon exportiert, ist das alte Notebook der bessere Default.
    setMode(state.lastNotebookId ? 'existing' : 'new');

    const res = await send({ type: 'list-notebooks' });
    if (res && res.ok) {
      state.nlmOk = true;
      state.notebooks = res.notebooks || [];
      renderNotebooks();
      setStatus('ok', res.email ? `NotebookLM · ${res.email}` : 'NotebookLM verbunden');
    } else {
      state.nlmOk = false;
      $('nb-existing').innerHTML = '<option value="">Nicht verfügbar</option>';
      const loggedOut = !res || res.notLoggedIn;
      setStatus('err', loggedOut ? 'Nicht bei NotebookLM angemeldet' : `NotebookLM: ${res.error}`);
      if (loggedOut) {
        const a = document.createElement('a');
        a.href = 'https://notebooklm.google.com/';
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Anmelden ↗';
        $('status').appendChild(a);
      }
    }
    updateGo();
  }

  /* ---------- Öffnen / Schließen ---------- */

  let loaded = false;
  function open() {
    backdrop.hidden = false;
    // Timer statt requestAnimationFrame: laeuft auch in Hintergrund-Tabs zuverlaessig an.
    setTimeout(() => backdrop.classList.add('in'), 10);
    if (!loaded) { loaded = true; load(); }
    setTimeout(() => { if (state.mode === 'new') $('nb-title').select(); }, 50);
  }
  function close() {
    backdrop.classList.remove('in');
    setTimeout(() => { backdrop.hidden = true; }, 160);
  }

  $('badge').addEventListener('click', open);
  $('close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  root.addEventListener('keydown', (e) => {
    if (backdrop.hidden) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target === $('nb-title')) { e.preventDefault(); launch(true); }
  });
  for (const b of root.querySelectorAll('.seg')) b.addEventListener('click', () => setMode(b.dataset.mode));
  $('nb-existing').addEventListener('change', updateGo);
  $('nb-title').addEventListener('input', updateGo);
  $('go').addEventListener('click', () => launch(true));
  $('more').addEventListener('click', () => launch(false));

  /* ---------- Export-Tab starten ---------- */

  function launchParams() {
    const params = {
      type: 'open-exporter',
      ref: obj.refId,
      type_: obj.type || '',
      title,
      url: location.href,
      scan: enabledScanKeys().join(','),
      mode: state.mode,
    };
    if (state.mode === 'existing') {
      params.notebook = $('nb-existing').value;
      const nb = state.notebooks.find((n) => n.id === params.notebook);
      params.nbtitle = nb ? nb.title : state.lastNotebookTitle;
    } else {
      params.nbtitle = $('nb-title').value.trim() || title;
    }
    return params;
  }

  async function launch(autostart) {
    const go = $('go');
    go.disabled = true;
    go.textContent = autostart ? 'Öffne Export …' : 'Exportieren';
    const params = { ...launchParams(), autostart: autostart ? '1' : '' };
    // Der Objekttyp heisst in der Nachricht "objType", damit er nicht mit dem Nachrichtentyp kollidiert.
    params.objType = params.type_;
    delete params.type_;
    const res = await send(params);
    if (!res || !res.ok) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (k !== 'type' && v) q.set(k === 'objType' ? 'type' : k, v);
      window.open(chrome.runtime.getURL(`export/export.html?${q.toString()}`), '_blank');
    }
    setTimeout(() => { go.textContent = 'Exportieren'; updateGo(); close(); }, 400);
  }
})();

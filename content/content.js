/**
 * StudOn content script: floating badge that opens the exporter for the
 * course / folder / object currently shown.
 */
(function studonToNotebookLM() {
  if (window.top !== window) return;
  if (document.getElementById('s2n-badge')) return;

  const TYPE_LABELS = {
    crs: 'Kurs', fold: 'Ordner', grp: 'Gruppe', sess: 'Sitzung', lm: 'Lernmodul', exc: 'Übung', copa: 'Inhaltsseite',
    wiki: 'Wiki', frm: 'Forum', mcst: 'Mediacast', webr: 'Weblinks', glo: 'Glossar', cat: 'Kategorie', file: 'Datei',
  };

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

  const badge = document.createElement('div');
  badge.id = 's2n-badge';
  badge.innerHTML = `
    <button type="button" class="s2n-main" title="Diesen ${label} nach NotebookLM exportieren">
      <span class="s2n-icon">⚡</span><span class="s2n-text">NotebookLM</span>
    </button>
    <div class="s2n-panel" hidden>
      <div class="s2n-panel-title">${label}: <b></b></div>
      <div class="s2n-panel-meta">Noch nicht exportiert</div>
      <div class="s2n-panel-actions">
        <button type="button" class="s2n-btn s2n-primary" data-action="export">Export öffnen</button>
        <button type="button" class="s2n-btn" data-action="options">Optionen</button>
      </div>
    </div>`;
  badge.querySelector('.s2n-panel-title b').textContent = title || obj.refId;
  document.body.appendChild(badge);

  const panel = badge.querySelector('.s2n-panel');
  const meta = badge.querySelector('.s2n-panel-meta');

  function refreshMeta() {
    try {
      chrome.storage.local.get(`course:${obj.refId}`, (data) => {
        const state = data && data[`course:${obj.refId}`];
        if (!state || !state.lastRun) { meta.textContent = 'Noch nicht exportiert'; return; }
        const n = Object.keys(state.items || {}).length;
        const when = new Date(state.lastRun).toLocaleString('de-DE');
        meta.textContent = `Zuletzt: ${when} · ${n} Objekte · ${state.notebooks.length} Notebook${state.notebooks.length === 1 ? '' : 's'}`;
      });
    } catch {
      meta.textContent = '';
    }
  }

  function openExporter() {
    chrome.runtime.sendMessage({ type: 'open-exporter', ref: obj.refId, type: obj.type || '', title, url: location.href }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        window.open(chrome.runtime.getURL(`export/export.html?ref=${obj.refId}&type=${obj.type || ''}&title=${encodeURIComponent(title)}&url=${encodeURIComponent(location.href)}`), '_blank');
      }
    });
  }

  badge.querySelector('.s2n-main').addEventListener('click', () => {
    const open = panel.hasAttribute('hidden');
    if (open) { refreshMeta(); panel.removeAttribute('hidden'); } else panel.setAttribute('hidden', '');
  });
  badge.querySelector('[data-action="export"]').addEventListener('click', openExporter);
  badge.querySelector('[data-action="options"]').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-url', url: chrome.runtime.getURL('options/options.html') });
  });
  document.addEventListener('click', (e) => {
    if (!badge.contains(e.target)) panel.setAttribute('hidden', '');
  });
})();

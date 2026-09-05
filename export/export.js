import { StudOnCrawler, SessionExpiredError, flatten } from '../lib/crawler.js';
import { NotebookLMClient, NotLoggedInError } from '../lib/nlm-client.js';
import { DriveClient, buildAuthUrl, parseTokenFromRedirect } from '../lib/drive-client.js';
import { planExport, Exporter, itemKey, reconcileNotebook, deleteDuplicateSources, targetChain, isPresent } from '../lib/exporter.js';
import { extractAudioBlob } from '../lib/audio-extract.js';
import { getSettings, saveSettings, getCourseState, saveCourseState } from '../lib/storage.js';
import { typeLabel, formatBytes, gotoUrl, repoUrl } from '../lib/ilias.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const course = {
  refId: params.get('ref') || '',
  type: params.get('type') || '',
  title: params.get('title') || '',
  url: params.get('url') || '',
};

/** Startparameter aus dem Dialog auf der StudOn-Seite (content/content.js). */
const launch = {
  autostart: params.get('autostart') === '1',
  mode: params.get('mode') || '',                      // new | existing
  notebookId: params.get('notebook') || '',
  notebookTitle: params.get('nbtitle') || '',
  scan: params.has('scan') ? new Set(params.get('scan').split(',').filter(Boolean)) : null,
};

const ui = {
  state: 'idle',
  tree: null,
  nodes: new Map(),
  crawler: null,
  exporter: null,
  nlm: null,
  notebooks: [],
  settings: null,
  courseState: null,
  plan: null,
  result: null,
  drive: null,
  recon: null,       // Ergebnis des Live-Abgleichs mit dem Ziel-Notebook (reconcileNotebook)
  reconToken: 0,
};

function log(target, message, cls = '') {
  const el = $(target);
  el.hidden = false;
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString('de-DE')}] ${message}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function banner(message, kind = '', link = null) {
  const el = $('banner');
  if (!message) { el.hidden = true; el.innerHTML = ''; return; }
  el.className = `banner ${kind}`;
  el.textContent = message;
  if (link) {
    el.append(' ');
    const a = document.createElement('a');
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = link.text;
    el.appendChild(a);
  }
  el.hidden = false;
}

function setProgress(id, ratio) {
  $(id).firstElementChild.style.width = `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`;
}

/* ---------- init ---------- */

async function init() {
  if (!course.refId) {
    banner('Keine StudOn-Objekt-ID übergeben. Bitte den Export über den ⚡-Button auf einer StudOn-Kursseite starten.', 'error');
    $('btn-scan').disabled = true;
    return;
  }
  ui.settings = await getSettings();
  ui.courseState = await getCourseState(course.refId);
  const title = course.title || ui.courseState.title || `StudOn ${course.refId}`;
  $('course-title').textContent = title;
  $('course-kind').textContent = typeLabel(course.type || 'crs');
  $('course-link').href = course.url || (course.type ? gotoUrl(course.type, course.refId) : repoUrl(course.refId));
  document.title = `${title} → NotebookLM`;
  $('target-title').value = title;

  for (const input of document.querySelectorAll('#scan-toggles input')) {
    const opt = input.dataset.opt;
    if (launch.scan) input.checked = launch.scan.has(opt);
    else if (opt in ui.settings.scan) input.checked = !!ui.settings.scan[opt];
  }
  if (launch.notebookTitle && launch.mode !== 'existing') $('target-title').value = launch.notebookTitle;
  $('opt-overview').checked = ui.settings.export.overviewSource !== false;
  $('opt-wait').checked = ui.settings.export.waitForProcessing !== false;
  $('opt-zip').checked = !!ui.settings.export.zip;
  $('opt-video-audio').checked = ui.settings.export.videoAsAudio !== false;
  $('opt-drive-mirror').checked = !!ui.settings.export.driveMirror;
  $('opt-drive-source').checked = !!ui.settings.export.driveAsSource;
  if (!ui.settings.driveClientId) {
    $('opt-drive-mirror').disabled = true;
    $('opt-drive-source').disabled = true;
    $('drive-hint').innerHTML = '– zuerst OAuth-Client-ID in den <a href="../options/options.html" target="_blank">Optionen</a> eintragen';
  }

  if (ui.courseState.primaryNotebookId) {
    const nb = ui.courseState.notebooks.find((n) => n.id === ui.courseState.primaryNotebookId);
    $('target-auto-title').textContent = nb ? nb.title : ui.courseState.primaryNotebookId;
    $('target-auto').checked = true;
  } else {
    $('target-auto').disabled = true;
  }

  const connected = connectNotebookLM();
  if (launch.mode || launch.autostart) await applyLaunch(connected);
}

/**
 * Setzt Notebook-Wahl aus dem Dialog um und startet auf Wunsch sofort
 * Scan und Export - ohne weiteren Klick.
 */
async function applyLaunch(connected) {
  await connected;
  if (launch.mode === 'existing' && launch.notebookId) {
    const sel = $('target-existing');
    if ([...sel.options].some((o) => o.value === launch.notebookId)) {
      sel.value = launch.notebookId;
      document.querySelector('input[name="target"][value="existing"]').checked = true;
    } else if (ui.courseState.primaryNotebookId === launch.notebookId && !$('target-auto').disabled) {
      $('target-auto').checked = true;
    } else {
      banner('Das gewählte Notebook wurde nicht gefunden - es wird ein neues angelegt.', 'info');
      document.querySelector('input[name="target"][value="new"]').checked = true;
    }
  } else if (launch.mode === 'new') {
    document.querySelector('input[name="target"][value="new"]').checked = true;
  }

  if (!launch.autostart) return;
  if (!ui.nlm || !ui.nlm.at) return; // Banner mit Login-Hinweis steht bereits.
  await runScan();
  if (ui.state !== 'scanned') return;
  if (!ui.plan || !ui.plan.jobs.length) {
    banner('Nichts zu exportieren - alles liegt bereits im Notebook oder ist abgewählt.', 'info');
    return;
  }
  await runExport();
}

async function connectNotebookLM() {
  ui.nlm = new NotebookLMClient({ fetch: (u, i) => fetch(u, i), authuser: ui.settings.authuser, log: (m) => log('scan-log', m) });
  try {
    const info = await ui.nlm.init();
    $('nlm-account').textContent = `NotebookLM: ${info.email || 'verbunden'}`;
    $('nlm-account').className = 'pill ok';
    ui.notebooks = await ui.nlm.listNotebooks();
    const sel = $('target-existing');
    sel.innerHTML = '';
    if (!ui.notebooks.length) sel.innerHTML = '<option value="">Keine Notebooks gefunden</option>';
    for (const nb of ui.notebooks.filter((n) => n.owned)) {
      const o = document.createElement('option');
      o.value = nb.id;
      o.textContent = `${nb.emoji ? `${nb.emoji} ` : ''}${nb.title} (${nb.sourceCount} Quellen)`;
      sel.appendChild(o);
    }
  } catch (err) {
    $('nlm-account').textContent = 'NotebookLM: nicht angemeldet';
    $('nlm-account').className = 'pill err';
    if (err instanceof NotLoggedInError) {
      banner('Du bist in diesem Chrome-Profil nicht bei NotebookLM angemeldet. Nach dem Login diese Seite neu laden.', 'error', { href: 'https://notebooklm.google.com/', text: 'NotebookLM öffnen' });
    } else {
      banner(`NotebookLM-Verbindung fehlgeschlagen: ${err.message}`, 'error');
    }
  }
}

/* ---------- scan ---------- */

function scanOptionsFromUi() {
  const opts = {};
  for (const input of document.querySelectorAll('#scan-toggles input')) opts[input.dataset.opt] = input.checked;
  return opts;
}

async function runScan() {
  if (ui.state === 'scanning') return;
  ui.state = 'scanning';
  banner('');
  $('btn-scan').disabled = true;
  $('btn-scan-abort').hidden = false;
  $('scan-log').innerHTML = '';
  $('scan-log').hidden = false;
  $('tree').hidden = true;
  $('scan-stats').hidden = true;
  $('target-card').hidden = true;
  $('result-card').hidden = true;
  setProgress('scan-progress', 0.02);

  const scan = scanOptionsFromUi();
  await saveSettings({ scan });
  ui.settings.scan = scan;

  ui.crawler = new StudOnCrawler({
    fetch: (u, i) => fetch(u, i),
    DOMParser: window.DOMParser,
    options: scan,
    log: (m) => log('scan-log', m),
    onProgress: ({ message, stats }) => {
      $('scan-status').textContent = message;
      updateStats(stats);
      setProgress('scan-progress', Math.min(0.95, 0.05 + stats.requests / (stats.requests + 25)));
    },
  });

  try {
    ui.tree = await ui.crawler.scan({ refId: course.refId, type: course.type || null, title: course.title, url: course.url });
    course.title = course.title || ui.tree.title;
    $('course-title').textContent = ui.tree.title;
    if (!$('target-title').value) $('target-title').value = ui.tree.title;
    ui.courseState.title = ui.tree.title;
    renderTree();
    updateStats(ui.crawler.stats);
    setProgress('scan-progress', 1);
    $('scan-status').textContent = 'Scan abgeschlossen';
    $('target-card').hidden = false;
    ui.state = 'scanned';
    updatePlanSummary();
    $('target-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    await refreshReconcile();
  } catch (err) {
    ui.state = 'idle';
    setProgress('scan-progress', 0);
    $('scan-status').textContent = 'Scan fehlgeschlagen';
    log('scan-log', err.message, 'err');
    if (err instanceof SessionExpiredError) {
      banner('Deine StudOn-Session ist abgelaufen. Bitte in StudOn neu einloggen und den Scan wiederholen.', 'error', { href: course.url || repoUrl(course.refId), text: 'StudOn öffnen' });
    } else {
      banner(`Scan fehlgeschlagen: ${err.message}`, 'error');
    }
  } finally {
    $('btn-scan').disabled = false;
    $('btn-scan').textContent = 'Erneut scannen';
    $('btn-scan-abort').hidden = true;
  }
}

function updateStats(stats) {
  if (!stats) return;
  $('scan-stats').hidden = false;
  $('st-containers').textContent = stats.containers;
  $('st-files').textContent = stats.files;
  $('st-texts').textContent = stats.texts;
  $('st-links').textContent = stats.links;
  $('st-skipped').textContent = stats.skipped;
  $('st-skipped-pill').hidden = !stats.skipped;
  $('st-errors').textContent = stats.errors;
  $('st-errors-pill').hidden = !stats.errors;
}

const ICONS = { container: '📁', file: '📄', text: '📝', link: '🔗', skipped: '⏭' };

function nodeMeta(n) {
  const parts = [];
  if (n.kind === 'container' && n.type) parts.push(typeLabel(n.type));
  if (n.kind === 'file') {
    if (n.sizeText) parts.push(n.sizeText);
    else if (n.sizeBytes) parts.push(formatBytes(n.sizeBytes));
  }
  if (n.kind === 'text') parts.push(`${n.words} Wörter${n.pages ? ` · ${n.pages} Seiten` : ''}`);
  if (n.kind === 'link') parts.push(n.isYouTube ? 'YouTube' : 'Web');
  if (n.kind === 'skipped') parts.push(n.reason || '');
  if (n.modified) parts.push(n.modified);
  return parts.join(' · ');
}

function renderTree() {
  const root = $('tree');
  root.innerHTML = '';
  ui.nodes.clear();
  const exported = ui.courseState.items || {};

  const build = (node) => {
    const li = document.createElement('li');
    li.dataset.id = node.id;
    const row = document.createElement('div');
    row.className = `node ${node.kind}`;
    const isLeaf = node.kind !== 'container';
    const caret = document.createElement('span');
    caret.className = `caret${node.children.length ? '' : ' empty'}`;
    caret.textContent = '▾';
    caret.addEventListener('click', () => li.classList.toggle('collapsed'));
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = node.kind !== 'skipped';
    cb.disabled = node.kind === 'skipped';
    cb.addEventListener('change', () => {
      for (const child of li.querySelectorAll('input[type="checkbox"]:not(:disabled)')) child.checked = cb.checked;
      syncParents(li);
      updatePlanSummary();
    });
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = ICONS[node.kind] || '•';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = node.kind === 'file' ? (node.filename || node.title) : node.title;
    title.title = node.url || '';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = nodeMeta(node);
    row.append(caret, cb, icon, title, meta);
    let done = null;
    if (isLeaf) {
      done = document.createElement('span');
      done.className = 'badge done';
      done.textContent = 'im Notebook';
      done.hidden = true;
      row.appendChild(done);
    }
    const status = document.createElement('span');
    status.className = 'badge';
    status.hidden = true;
    row.appendChild(status);
    li.appendChild(row);
    if (node.errors && node.errors.length) {
      const e = document.createElement('div');
      e.className = 'errors';
      e.textContent = node.errors.join(' · ');
      li.appendChild(e);
    }
    if (node.children.length) {
      const ul = document.createElement('ul');
      for (const c of node.children) ul.appendChild(build(c));
      li.appendChild(ul);
    }
    ui.nodes.set(node.id, { node, li, cb, status, done });
    return li;
  };

  const ul = document.createElement('ul');
  for (const c of ui.tree.children) ul.appendChild(build(c));
  root.appendChild(ul);
  root.hidden = false;
  refreshBadges();
}

function syncParents(li) {
  let parent = li.parentElement && li.parentElement.closest('li');
  while (parent) {
    const boxes = [...parent.querySelectorAll(':scope > ul input[type="checkbox"]:not(:disabled)')];
    const own = parent.querySelector(':scope > .node input[type="checkbox"]');
    const checked = boxes.filter((b) => b.checked).length;
    own.checked = checked > 0;
    own.indeterminate = checked > 0 && checked < boxes.length;
    parent = parent.parentElement && parent.parentElement.closest('li');
  }
}

function selectedIds() {
  const ids = new Set();
  for (const [id, entry] of ui.nodes) if (entry.cb.checked && !entry.cb.disabled) ids.add(id);
  return ids;
}

function setAll(checked) {
  for (const [, entry] of ui.nodes) if (!entry.cb.disabled) { entry.cb.checked = checked; entry.cb.indeterminate = false; }
  updatePlanSummary();
}

function selectNew() {
  const exported = ui.courseState.items || {};
  const chain = currentChain();
  const leaves = [];
  for (const [, entry] of ui.nodes) {
    if (entry.cb.disabled || entry.node.kind === 'container') continue;
    entry.cb.checked = !isPresent(exported[itemKey(entry.node)], chain);
    leaves.push(entry.li);
  }
  for (const li of leaves) syncParents(li);
  updatePlanSummary();
}

function exportSettingsFromUi() {
  return {
    overviewSource: $('opt-overview').checked,
    waitForProcessing: $('opt-wait').checked,
    zip: $('opt-zip').checked,
    videoAsAudio: $('opt-video-audio').checked,
    driveMirror: $('opt-drive-mirror').checked && !!ui.settings.driveClientId,
    driveAsSource: $('opt-drive-source').checked && !!ui.settings.driveClientId,
    driveRootFolder: ui.settings.driveRootFolder,
  };
}

function updatePlanSummary() {
  if (!ui.tree) return;
  const settings = exportSettingsFromUi();
  ui.plan = planExport({ tree: ui.tree, selectedIds: selectedIds(), state: ui.courseState, settings, notebookIds: currentChain() });
  const c = ui.plan.counts;
  const skippedReasons = {};
  for (const s of ui.plan.skipped) skippedReasons[s.reason] = (skippedReasons[s.reason] || 0) + 1;
  const reasons = Object.entries(skippedReasons).map(([r, n]) => `${n}× ${r}`).join(', ');
  $('plan-summary').textContent = `Geplant: ${c.files} Dateien${c.audio ? ` (davon ${c.audio} Videos als Tonspur)` : ''}, ${c.texts} Texte, ${c.links} Links${settings.overviewSource ? ', 1 Kursstruktur' : ''}` + (reasons ? ` · übersprungen: ${reasons}` : '');
  $('btn-export').disabled = ui.plan.jobs.length === 0 || !ui.nlm || !ui.nlm.at || ui.state === 'exporting';
}

/* ---------- Ziel & Live-Abgleich ---------- */

function currentTarget() {
  const checked = document.querySelector('input[name="target"]:checked');
  const mode = checked ? checked.value : 'new';
  const target = { mode, title: $('target-title').value.trim() || (ui.tree ? ui.tree.title : '') };
  if (mode === 'existing') {
    target.notebookId = $('target-existing').value;
    const nb = ui.notebooks.find((n) => n.id === target.notebookId);
    if (nb) target.title = nb.title;
  }
  return target;
}

/** Notebook-Kette des aktuell gewählten Ziels (leer bei „Neues Notebook“). */
function currentChain() {
  if (ui.recon) return ui.recon.notebookIds;
  return targetChain(ui.courseState, currentTarget());
}

/**
 * Gleicht den Kurszustand mit der echten Quellenliste des Ziel-Notebooks ab (siehe lib/exporter.js).
 * Läuft nach dem Scan, bei jedem Zielwechsel und nach dem Export; der Export selbst wiederholt ihn.
 */
async function refreshReconcile() {
  const token = ++ui.reconToken;
  ui.recon = null;
  if (!ui.tree || !ui.nlm || !ui.nlm.at) { renderRecon(); return; }
  const chain = targetChain(ui.courseState, currentTarget());
  if (!chain.length) { renderRecon(); return; }
  $('recon-text').textContent = 'Gleiche mit dem Notebook ab …';
  $('recon-summary').hidden = false;
  $('btn-dedupe').hidden = true;
  try {
    const rec = await reconcileNotebook({ nlm: ui.nlm, state: ui.courseState, tree: ui.tree, notebookIds: chain, settings: exportSettingsFromUi(), log: (m) => log('scan-log', m) });
    if (token !== ui.reconToken) return;
    await saveCourseState(ui.courseState);
    ui.recon = rec;
  } catch (err) {
    if (token !== ui.reconToken) return;
    ui.recon = { notebookIds: chain, error: err.message, duplicates: [], total: 0, adopted: 0, missing: 0 };
  }
  refreshBadges();
  renderRecon();
}

function renderRecon() {
  const el = $('recon-summary');
  const btn = $('btn-dedupe');
  const r = ui.recon;
  if (!r) {
    el.hidden = true;
    btn.hidden = true;
    updatePlanSummary();
    return;
  }
  if (r.error) {
    $('recon-text').textContent = `Abgleich mit dem Notebook fehlgeschlagen: ${r.error}`;
    el.hidden = false;
    btn.hidden = true;
    updatePlanSummary();
    return;
  }
  const dups = r.duplicates.reduce((n, g) => n + g.remove.length, 0);
  const parts = [`${r.total} Quellen im Notebook`];
  if (r.adopted) parts.push(`${r.adopted} dem Kurs zugeordnet`);
  if (r.missing) parts.push(`${r.missing} lokal vermerkte fehlen dort und werden neu hochgeladen`);
  if (dups) parts.push(`${dups} doppelte`);
  $('recon-text').textContent = `Abgleich: ${parts.join(', ')}.`;
  el.hidden = false;
  btn.hidden = !dups;
  btn.textContent = `${dups} doppelte Quellen im Notebook löschen`;
  updatePlanSummary();
}

/** „im Notebook“-Badges nach dem Zustand für die aktuelle Ziel-Kette setzen. */
function refreshBadges() {
  if (!ui.courseState) return;
  const items = ui.courseState.items || {};
  const chain = currentChain();
  for (const [, entry] of ui.nodes) {
    if (!entry.done) continue;
    entry.done.hidden = !isPresent(items[itemKey(entry.node)], chain);
    // Nach dem Lauf sagt das Status-Badge dasselbe wie „im Notebook“ – nur eines zeigen.
    if (!entry.done.hidden && entry.status.classList.contains('done')) entry.status.hidden = true;
  }
}

async function removeDuplicates() {
  const r = ui.recon;
  if (!r || !r.duplicates.length || !ui.nlm) return;
  const n = r.duplicates.reduce((s, g) => s + g.remove.length, 0);
  const sample = r.duplicates.slice(0, 6).map((g) => `• ${g.title} (${g.remove.length}× zu viel)`).join('\n');
  const more = r.duplicates.length > 6 ? `\n• … und ${r.duplicates.length - 6} weitere` : '';
  if (!window.confirm(`${n} doppelte Quellen aus dem Notebook löschen? Von jeder Gruppe bleibt eine Quelle erhalten.\n\n${sample}${more}`)) return;
  $('btn-dedupe').disabled = true;
  try {
    const deleted = await deleteDuplicateSources(ui.nlm, r.duplicates, { live: r.live });
    log('export-log', `${deleted} doppelte Quellen aus dem Notebook gelöscht`, 'ok');
    banner(`${deleted} doppelte Quellen gelöscht.`, 'info');
  } catch (err) {
    banner(`Löschen fehlgeschlagen: ${err.message}`, 'error');
  } finally {
    $('btn-dedupe').disabled = false;
  }
  await refreshReconcile();
}

/* ---------- drive ---------- */

async function getDriveToken({ refresh = false } = {}) {
  const { getDriveToken: cached, saveDriveToken } = await import('../lib/storage.js');
  if (!refresh) {
    const t = await cached();
    if (t) return t.token;
  }
  const redirectUri = chrome.identity.getRedirectURL();
  const url = buildAuthUrl({ clientId: ui.settings.driveClientId, redirectUri, loginHint: ui.nlm && ui.nlm.email ? ui.nlm.email : '' });
  const responseUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  const token = parseTokenFromRedirect(responseUrl);
  await saveDriveToken(token);
  return token.token;
}

/* ---------- export ---------- */

async function runExport() {
  if (!ui.plan || ui.state === 'exporting') return;
  ui.state = 'exporting';
  banner('');
  $('btn-export').disabled = true;
  $('btn-export-abort').hidden = false;
  $('btn-scan').disabled = true;
  $('export-log').innerHTML = '';
  $('export-log').hidden = false;
  $('result-card').hidden = true;
  setProgress('export-progress', 0.01);
  for (const [, entry] of ui.nodes) { entry.status.hidden = true; entry.status.className = 'badge'; }

  const settings = exportSettingsFromUi();
  await saveSettings({ export: { overviewSource: settings.overviewSource, waitForProcessing: settings.waitForProcessing, zip: settings.zip, videoAsAudio: settings.videoAsAudio, driveMirror: settings.driveMirror, driveAsSource: settings.driveAsSource } });

  const target = currentTarget();
  if (target.mode === 'existing' && !target.notebookId) {
    banner('Bitte ein vorhandenes Notebook auswählen.', 'error');
    ui.state = 'scanned';
    $('btn-export').disabled = false;
    $('btn-export-abort').hidden = true;
    $('btn-scan').disabled = false;
    return;
  }

  if (settings.driveMirror || settings.driveAsSource) {
    try {
      ui.drive = new DriveClient({ fetch: (u, i) => fetch(u, i), getToken: getDriveToken, log: (m) => log('export-log', m) });
      await getDriveToken();
    } catch (err) {
      banner(`Google Drive konnte nicht verbunden werden: ${err.message}`, 'error');
      ui.state = 'scanned';
      $('btn-export').disabled = false;
      $('btn-export-abort').hidden = true;
      $('btn-scan').disabled = false;
      return;
    }
  }

  const keyToNode = new Map();
  for (const [, entry] of ui.nodes) if (entry.node.kind !== 'container') keyToNode.set(itemKey(entry.node), entry);

  ui.exporter = new Exporter({
    nlm: ui.nlm,
    drive: ui.drive,
    fetch: (u, i) => fetch(u, i),
    JSZip: window.JSZip,
    extractAudio: extractAudioBlob,
    settings: { ...settings, delayMs: 350 },
    state: ui.courseState,
    persist: (s) => saveCourseState(s),
    log: (m) => log('export-log', m, /^✗/.test(m) ? 'err' : /^✓/.test(m) ? 'ok' : ''),
    onProgress: ({ phase, message, index, total, jobKey, status, batchKeys, error }) => {
      $('export-status').textContent = message;
      if (typeof index === 'number' && total) setProgress('export-progress', Math.min(0.97, index / total));
      if (phase === 'processing') setProgress('export-progress', 0.98);
      const keys = batchKeys || (jobKey ? [jobKey] : []);
      for (const key of keys) {
        const entry = keyToNode.get(key);
        if (!entry) continue;
        entry.status.hidden = false;
        if (status === 'running') { entry.status.textContent = 'läuft'; entry.status.className = 'badge run'; }
        if (status === 'ok') { entry.status.textContent = 'in NotebookLM'; entry.status.className = 'badge done'; }
        if (status === 'error') { entry.status.textContent = 'Fehler'; entry.status.className = 'badge err'; entry.status.title = error || ''; }
      }
    },
  });

  try {
    ui.result = await ui.exporter.run({ tree: ui.tree, plan: ui.plan, target, courseUrl: course.url || gotoUrl(course.type || 'crs', course.refId) });
    setProgress('export-progress', 1);
    $('export-status').textContent = ui.result.aborted ? 'Export abgebrochen' : 'Export abgeschlossen';
    renderResult();
    ui.courseState = await getCourseState(course.refId);
    // Nach dem Export ist dieses Notebook das „zuletzt verwendete“: ein weiterer Klick ergänzt dort,
    // statt mit „Neues Notebook“ noch eines anzulegen.
    if (ui.courseState.primaryNotebookId) {
      const nb = ui.courseState.notebooks.find((n) => n.id === ui.courseState.primaryNotebookId);
      $('target-auto-title').textContent = nb ? nb.title : ui.courseState.primaryNotebookId;
      $('target-auto').disabled = false;
      $('target-auto').checked = true;
    }
    refreshBadges();
    await refreshReconcile();
  } catch (err) {
    log('export-log', err.message, 'err');
    if (err instanceof NotLoggedInError) banner(err.message, 'error', { href: 'https://notebooklm.google.com/', text: 'NotebookLM öffnen' });
    else banner(`Export fehlgeschlagen: ${err.message}`, 'error');
    $('export-status').textContent = 'Export fehlgeschlagen';
  } finally {
    ui.state = 'scanned';
    $('btn-export').disabled = false;
    $('btn-export-abort').hidden = true;
    $('btn-scan').disabled = false;
  }
}

function renderResult() {
  const r = ui.result;
  const body = $('result-body');
  body.innerHTML = '';
  const nbs = document.createElement('div');
  nbs.className = 'result-notebooks';
  for (const nb of r.notebooks) {
    const a = document.createElement('a');
    a.href = nb.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `📓 ${nb.title} in NotebookLM öffnen`;
    nbs.appendChild(a);
  }
  body.appendChild(nbs);

  const ready = Object.values(r.statuses).filter((s) => s.status === 2).length;
  const failed = Object.values(r.statuses).filter((s) => s.status === 3).length;
  const pending = Object.values(r.statuses).filter((s) => s.timedOut).length;
  const dl = document.createElement('dl');
  dl.className = 'kv';
  const rows = [
    ['Quellen hinzugefügt', String(r.added)],
    ['Bereits im Notebook (übersprungen)', String(r.present || 0)],
    ['Fehler', String(r.errors.length)],
  ];
  if (r.reconcile && r.reconcile.duplicates.length) {
    rows.push(['Doppelte Quellen im Notebook', `${r.reconcile.duplicates.reduce((n, g) => n + g.remove.length, 0)} – siehe Abgleich oben`]);
  }
  if (Object.keys(r.statuses).length) rows.push(['Verarbeitung', `${ready} fertig${failed ? `, ${failed} fehlgeschlagen` : ''}${pending ? `, ${pending} noch in Arbeit` : ''}`]);
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  body.appendChild(dl);

  if (r.errors.length) {
    const ul = document.createElement('ul');
    ul.className = 'result-errors';
    for (const e of r.errors) {
      const li = document.createElement('li');
      li.textContent = `${e.title}: ${e.error}`;
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }
  if (r.zipBlob) {
    $('btn-zip').hidden = false;
    $('btn-zip').onclick = () => {
      const url = URL.createObjectURL(r.zipBlob);
      chrome.downloads.download({ url, filename: `${(ui.tree.title || 'StudOn').replace(/[\\/:*?"<>|]+/g, '_')}_NotebookLM.zip`, saveAs: true });
    };
  } else {
    $('btn-zip').hidden = true;
  }
  $('result-card').hidden = false;
  $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- wiring ---------- */

$('btn-scan').addEventListener('click', runScan);
$('btn-scan-abort').addEventListener('click', () => ui.crawler && ui.crawler.abort());
$('btn-export').addEventListener('click', runExport);
$('btn-export-abort').addEventListener('click', () => ui.exporter && ui.exporter.abort());
$('btn-rescan').addEventListener('click', runScan);
$('btn-select-all').addEventListener('click', () => setAll(true));
$('btn-select-none').addEventListener('click', () => setAll(false));
$('btn-select-new').addEventListener('click', selectNew);
$('btn-dedupe').addEventListener('click', removeDuplicates);
// Ziel oder Optionen geändert → Abgleich mit dem (neuen) Ziel-Notebook, dann Plan.
for (const el of document.querySelectorAll('#target-card input, #target-card select')) el.addEventListener('change', () => { refreshReconcile(); });

init();

/**
 * Export planning and execution: tree → NotebookLM (+ optional Drive mirror, ZIP).
 * Everything is injected (nlm client, drive client, fetch, JSZip) for testability.
 *
 * Dubletten-Schutz in zwei Stufen:
 *  1. Lokaler Zustand pro Kurs (`state.items[key]`): welche Quelle(n) ein StudOn-Objekt in
 *     welchem Notebook hat, plus Signatur (Größe|Datum) für Änderungserkennung.
 *  2. Abgleich mit der echten Quellenliste des Ziel-Notebooks (`reconcileNotebook`), vor jedem
 *     Export: lokal vermerkte Quellen, die im Notebook fehlen, werden neu geplant; Quellen, die
 *     im Notebook liegen, aber lokal unbekannt sind, werden per Titel bzw. URL übernommen.
 *     Der lokale Zustand ist damit nur ein Cache – das Notebook ist die Wahrheit.
 *
 * Ein Ziel ist immer eine Notebook-Kette: das gewählte Notebook plus seine Folge-Notebooks
 * („(2)“, „(3)“ …), die beim Erreichen des Quellen-Limits angelegt wurden. Der Abgleich läuft
 * über die ganze Kette; hochgeladen wird in das letzte Glied.
 */

import { flatten, treeToOverview } from './crawler.js';
import { RpcError, SOURCE_STATUS, SOURCE_TYPE } from './nlm-client.js';
import { CONVERSIONS, NLM_DRIVE_MIMES } from './drive-client.js';
import * as ilias from './ilias.js';
import { splitByWords, wordCount } from './text.js';

/** Official NotebookLM upload admission list (43 extensions). */
export const NLM_DIRECT_EXTENSIONS = new Set([
  'pdf', 'txt', 'md', 'docx', 'csv', 'pptx', 'epub',
  'avif', 'bmp', 'gif', 'heic', 'heif', 'ico', 'jp2', 'jpe', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp',
  '3g2', '3gp', 'aac', 'aif', 'aifc', 'aiff', 'amr', 'au', 'avi', 'cda', 'm4a', 'mid', 'mp3', 'mp4', 'mpeg', 'ogg', 'opus', 'ra', 'ram', 'snd', 'wav', 'wma',
]);

export const TEXT_LIKE_EXTENSIONS = new Set([
  'py', 'java', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'json', 'xml', 'yaml', 'yml',
  'tex', 'bib', 'r', 'm', 'sql', 'sh', 'ps1', 'bat', 'html', 'htm', 'css', 'ipynb', 'log', 'ini', 'cfg', 'toml',
  'rst', 'org', 'tsv', 'srt', 'vtt', 'rtf',
]);

export const ARCHIVE_EXTENSIONS = new Set(['zip']);
export const MEDIA_EXTENSIONS = new Set(['mp4', 'avi', 'mpeg', 'mp3', 'm4a', 'wav', 'ogg', 'opus', 'aac', '3gp', '3g2', 'wma', 'aif', 'aiff', 'amr', 'au', 'mid', 'ra', 'ram', 'snd', 'cda', 'webm', 'mov']);
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** Container, aus denen lib/audio-extract.js die Tonspur ohne Neukodierung loesen kann. */
export const DEMUXABLE_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', '3gp', '3g2']);
export const MAX_TEXT_WORDS = 400000;
export const PRESENT_REASON = 'bereits im Notebook';

export function classifyFile(filename) {
  const ext = ilias.extensionOf(filename);
  if (ARCHIVE_EXTENSIONS.has(ext)) return { action: 'archive', ext };
  if (NLM_DIRECT_EXTENSIONS.has(ext)) return { action: 'direct', ext };
  if (TEXT_LIKE_EXTENSIONS.has(ext)) return { action: 'astext', ext };
  if (CONVERSIONS[ext]) return { action: 'drive-convert', ext };
  if (!ext) return { action: 'direct', ext };
  return { action: 'unsupported', ext };
}

export function itemKey(node) {
  if (node.kind === 'file') return node.refId ? `file:${node.refId}` : `dl:${node.downloadUrl}`;
  if (node.kind === 'text') return `text:${node.type}:${node.refId}:${node.filename}`;
  if (node.kind === 'link') return `link:${node.href}`;
  return `node:${node.id}`;
}

function signature(node) {
  return `${node.sizeText || node.sizeBytes || ''}|${node.modified || ''}`;
}

export function overviewTitle(tree) {
  return `${tree.title} – Kursstruktur`;
}

/** Quellen-IDs eines Zustandseintrags (ZIP-Inhalte und Text-Teile haben mehrere). */
export function idsOf(item) {
  if (!item) return [];
  if (Array.isArray(item.sourceIds) && item.sourceIds.length) return item.sourceIds;
  return item.sourceId ? [item.sourceId] : [];
}

/** Ist das Objekt laut Zustand in einem der Notebooks der Kette? */
export function isPresent(item, notebookIds = null) {
  if (!item || !idsOf(item).length) return false;
  return !notebookIds || notebookIds.includes(item.notebookId);
}

/**
 * Zuordnungen zu anderen Notebooks bleiben in `history` erhalten, damit ein Wechsel
 * zwischen zwei Notebooks (A → B → A) die Quellen in A wiederfindet – auch bei ZIP-Inhalten,
 * die sich nicht über den Titel erkennen lassen.
 */
function withHistory(prev, notebookId, ids) {
  const history = { ...((prev && prev.history) || {}) };
  if (prev && prev.notebookId && prev.notebookId !== notebookId && idsOf(prev).length) history[prev.notebookId] = idsOf(prev);
  if (ids.length) history[notebookId] = ids;
  else delete history[notebookId];
  return history;
}

/* ---------- Notebook-Ketten ---------- */

function groupOf(state, entry) {
  return entry.group || (state.notebooks[0] ? state.notebooks[0].id : entry.id);
}

/** Alle Notebook-IDs der Kette, zu der `notebookId` gehört (unbekannte IDs bilden eine eigene Kette). */
export function notebookChain(state, notebookId) {
  if (!notebookId) return [];
  const notebooks = Array.isArray(state.notebooks) ? state.notebooks : [];
  const entry = notebooks.find((n) => n.id === notebookId);
  if (!entry) return [notebookId];
  const group = groupOf(state, entry);
  return notebooks.filter((n) => groupOf(state, n) === group).map((n) => n.id);
}

/** Kette für ein Exportziel, ohne etwas anzulegen (`new` → leer). */
export function targetChain(state, target) {
  if (!target) return [];
  if (target.mode === 'existing' && target.notebookId) return notebookChain(state, target.notebookId);
  if (target.mode === 'auto' && state.primaryNotebookId) return notebookChain(state, state.primaryNotebookId);
  return [];
}

/* ---------- Titel/URL-Abgleich ---------- */

export function normTitle(s) {
  return String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function youtubeId(url) {
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (host === 'youtu.be') return url.pathname.split('/')[1] || null;
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    const v = url.searchParams.get('v');
    if (v) return v;
    const m = url.pathname.match(/^\/(?:embed|shorts|v|live)\/([^/?]+)/);
    if (m) return m[1];
  }
  return null;
}

export function normUrl(u) {
  const raw = String(u ?? '').trim();
  try {
    const url = new URL(raw);
    const yt = youtubeId(url);
    if (yt) return `youtube:${yt}`;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw;
  }
}

function textParts(node, settings = {}) {
  const parts = splitByWords(node.content, settings.maxTextWords || MAX_TEXT_WORDS);
  return parts.map((content, i) => ({
    title: parts.length > 1 ? `${node.title} (Teil ${i + 1}/${parts.length})` : node.title,
    content,
  }));
}

/**
 * Titel, unter denen ein Knoten nach dem Upload im Notebook erscheint. Mehrere Kandidaten,
 * weil der endgültige Dateiname erst beim Download feststeht (Content-Disposition, .txt-Umwandlung,
 * Tonspur .m4a). ZIP-Inhalte sind nicht vorhersagbar.
 */
export function expectedTitles(node, settings = {}) {
  if (node.kind === 'text') return { titles: textParts(node, settings).map((p) => p.title), all: true, stem: null };
  if (node.kind !== 'file') return { titles: [], all: false, stem: null };
  const base = node.filename || ilias.sanitizeName(node.title);
  const cls = classifyFile(base);
  if (cls.action === 'archive') return { titles: [], all: false, stem: null };
  const tooBig = !!(node.sizeBytes && node.sizeBytes > MAX_FILE_BYTES);
  const stem = base.replace(/\.[a-z0-9]+$/i, '');
  const titles = [base];
  if (cls.action === 'astext') titles.unshift(`${base}.txt`);
  if (DEMUXABLE_EXTENSIONS.has(cls.ext) && (tooBig || settings.videoAsAudio !== false)) titles.unshift(`${stem}.m4a`);
  return { titles, all: false, stem: cls.ext ? null : stem };
}

/** Quellenliste eines Notebooks (oder einer Kette) mit Zuordnung „von welchem Objekt beansprucht“. */
export class LiveIndex {
  constructor() {
    this.sources = [];
    this.byId = new Map();
    this.claimed = new Map();
  }

  add(src, notebookId) {
    if (!src || !src.id || this.byId.has(src.id)) return;
    const s = { ...src, notebookId, normTitle: normTitle(src.title), normUrl: src.url ? normUrl(src.url) : null };
    this.sources.push(s);
    this.byId.set(s.id, s);
  }

  has(id) { return this.byId.has(id); }
  claim(id, key) { if (this.byId.has(id)) this.claimed.set(id, key); }
  unclaimed(pred) { return this.sources.filter((s) => !this.claimed.has(s.id) && pred(s)); }
  findTitle(title) { const n = normTitle(title); return this.unclaimed((s) => s.normTitle === n)[0] || null; }
  findStem(stem) {
    const n = normTitle(stem);
    const hits = this.unclaimed((s) => s.normTitle.replace(/\.[a-z0-9]+$/i, '') === n);
    return hits.length === 1 ? hits[0] : null;
  }
  findUrl(url) { const n = normUrl(url); return n ? this.unclaimed((s) => s.normUrl === n)[0] || null : null; }
  remove(ids) {
    for (const id of ids) { this.byId.delete(id); this.claimed.delete(id); }
    this.sources = this.sources.filter((s) => this.byId.has(s.id));
  }

  /** Gruppen gleichlautender Titel im selben Notebook. Pro Gruppe bleibt eine Quelle: die vermerkte, sonst eine fertige, sonst die erste. */
  duplicates() {
    const groups = new Map();
    for (const s of this.sources) {
      if (!s.normTitle) continue;
      const k = `${s.notebookId} ${s.normTitle}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const out = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const keep = group.find((s) => this.claimed.has(s.id)) || group.find((s) => s.status === SOURCE_STATUS.READY) || group[0];
      out.push({ title: keep.title, notebookId: keep.notebookId, keep: keep.id, remove: group.filter((s) => s !== keep).map((s) => s.id) });
    }
    return out;
  }
}

function matchLive(live, node, settings) {
  if (node.kind === 'link') {
    const hit = live.findUrl(node.href);
    return hit ? { ids: [hit.id], notebookId: hit.notebookId, title: hit.title, replaceIds: [] } : null;
  }
  const exp = expectedTitles(node, settings);
  if (!exp.titles.length) return null;
  if (exp.all) {
    const hits = exp.titles.map((t) => live.findTitle(t));
    const found = hits.filter(Boolean);
    if (found.length === hits.length) return { ids: found.map((h) => h.id), notebookId: found[0].notebookId, title: node.title, replaceIds: [] };
    // Nur ein Teil eines mehrteiligen Textes liegt im Notebook: beim Export ersetzen statt ergänzen.
    return found.length ? { ids: [], notebookId: found[0].notebookId, title: node.title, replaceIds: found.map((h) => h.id) } : null;
  }
  for (const t of exp.titles) {
    const hit = live.findTitle(t);
    if (hit) return { ids: [hit.id], notebookId: hit.notebookId, title: hit.title, replaceIds: [] };
  }
  if (exp.stem) {
    const hit = live.findStem(exp.stem);
    if (hit) return { ids: [hit.id], notebookId: hit.notebookId, title: hit.title, replaceIds: [] };
  }
  return null;
}

/**
 * Gleicht den Kurszustand mit den echten Quellen der Notebook-Kette ab und passt `state.items` an.
 * - vermerkte Quellen, die im Notebook fehlen → Zuordnung gelöscht (werden neu geplant)
 * - unbekannte Quellen im Notebook, die zu einem Kursobjekt passen (Titel/URL) → übernommen
 * Wirft, wenn ein Notebook nicht lesbar ist (außer es existiert nicht mehr → `gone`).
 */
export async function reconcileNotebook({ nlm, state, tree, notebookIds, settings = {}, log = () => {} }) {
  const live = new LiveIndex();
  const gone = [];
  for (const id of notebookIds) {
    try {
      const nb = await nlm.getNotebook(id);
      for (const s of nb.sources || []) live.add(s, id);
    } catch (err) {
      if (err instanceof RpcError && (err.code === 5 || err.code === 7)) {
        gone.push(id);
        log(`Notebook ${id} ist nicht (mehr) erreichbar – wird ignoriert`);
        continue;
      }
      throw new Error(`Quellenliste des Notebooks konnte nicht gelesen werden: ${err.message}`);
    }
  }
  const chain = notebookIds.filter((id) => !gone.includes(id));
  const items = state.items || (state.items = {});
  const now = new Date().toISOString();

  // 1. Vermerkte Zuordnungen prüfen (aktuelle und aus der History dieser Kette).
  let missing = 0;
  for (const [key, item] of Object.entries(items)) {
    const candidates = [];
    if (chain.includes(item.notebookId) && idsOf(item).length) candidates.push([item.notebookId, idsOf(item)]);
    for (const nb of chain) if (item.history && item.history[nb] && nb !== item.notebookId) candidates.push([nb, item.history[nb]]);
    if (!candidates.length) continue;
    let restored = false;
    let orphans = [];
    for (const [nb, ids] of candidates) {
      const present = ids.filter((id) => live.has(id));
      if (present.length === ids.length) {
        ids.forEach((id) => live.claim(id, key));
        if (nb !== item.notebookId) items[key] = { ...item, sourceId: ids[0], sourceIds: ids, notebookId: nb, history: withHistory(item, nb, ids) };
        restored = true;
        break;
      }
      orphans = orphans.concat(present);
    }
    if (restored) continue;
    if (!chain.includes(item.notebookId)) continue;
    orphans.forEach((id) => live.claim(id, key));
    items[key] = { ...item, sourceId: null, sourceIds: [], orphanIds: orphans, history: withHistory(item, item.notebookId, []) };
    missing += 1;
  }

  // 2. Unbekannte Quellen im Notebook per Titel/URL den Kursobjekten zuordnen.
  let adopted = 0;
  const seen = new Set();
  const pendingLinks = [];
  const adopt = (node, key, m) => {
    const prev = items[key] || {};
    if (m.ids.length) {
      m.ids.forEach((id) => live.claim(id, key));
      items[key] = {
        sourceId: m.ids[0], sourceIds: m.ids, notebookId: m.notebookId, driveFileId: prev.driveFileId || null,
        signature: signature(node), filename: m.title, when: now, via: 'adopted', history: withHistory(prev, m.notebookId, m.ids),
      };
      adopted += 1;
    } else if (m.replaceIds.length) {
      m.replaceIds.forEach((id) => live.claim(id, key));
      items[key] = { ...prev, sourceId: null, sourceIds: [], notebookId: m.notebookId, orphanIds: [...(prev.orphanIds || []), ...m.replaceIds] };
    }
  };
  for (const node of flatten(tree)) {
    if (node === tree || node.kind === 'container' || node.kind === 'skipped') continue;
    const key = itemKey(node);
    if (seen.has(key)) continue;
    seen.add(key);
    if (isPresent(items[key], chain)) continue;
    const m = matchLive(live, node, settings);
    if (m) adopt(node, key, m);
    else if (node.kind === 'link') pendingLinks.push([node, key]);
  }
  // Links ohne Treffer: Die Quellenliste nennt nicht bei jedem Typ die URL – dann die
  // unbeanspruchten Web-/YouTube-Quellen einzeln lesen (begrenzt) und erneut abgleichen.
  if (pendingLinks.length && typeof nlm.getSource === 'function') {
    const isLinkType = (s) => s.type === SOURCE_TYPE.WEB_PAGE || s.type === SOURCE_TYPE.YOUTUBE || s.type == null;
    const candidates = live.unclaimed((s) => !s.normUrl && isLinkType(s)).slice(0, 40);
    for (const s of candidates) {
      try {
        const detail = await nlm.getSource(s.id);
        if (detail && detail.url) { s.url = detail.url; s.normUrl = normUrl(detail.url); }
      } catch (err) {
        log(`  Quelle „${s.title}“ nicht lesbar: ${err.message}`);
      }
    }
    for (const [node, key] of pendingLinks) {
      const m = matchLive(live, node, settings);
      if (m) adopt(node, key, m);
    }
  }
  if (!isPresent(items.overview, chain)) {
    const hit = live.findTitle(overviewTitle(tree));
    if (hit) {
      live.claim(hit.id, 'overview');
      items.overview = { sourceId: hit.id, sourceIds: [hit.id], notebookId: hit.notebookId, driveFileId: null, signature: '', filename: hit.title, when: now, via: 'adopted', history: withHistory(items.overview, hit.notebookId, [hit.id]) };
      adopted += 1;
    }
  }

  return { notebookIds: chain, live, gone, adopted, missing, duplicates: live.duplicates(), total: live.sources.length };
}

/** Löscht die überzähligen Quellen aus `duplicates()`-Gruppen. Nur auf ausdrücklichen Wunsch aufrufen. */
export async function deleteDuplicateSources(nlm, groups, { live = null } = {}) {
  const ids = groups.flatMap((g) => g.remove);
  for (let i = 0; i < ids.length; i += 10) await nlm.deleteSources(ids.slice(i, i + 10));
  if (live) live.remove(ids);
  return ids.length;
}

/* ---------- Planung ---------- */

/**
 * Decide what to do with each selected node. `notebookIds` = Kette des Ziels; Zustandseinträge
 * anderer Notebooks zählen dann nicht als „bereits im Notebook“.
 * @returns {{ jobs: Array, skipped: Array, counts: object, selectedIds, notebookIds }}
 */
export function planExport({ tree, selectedIds = null, state = { items: {} }, settings = {}, notebookIds = null }) {
  const jobs = [];
  const linkJobs = [];
  const skipped = [];
  const seen = new Set();
  const isSelected = (n) => !selectedIds || selectedIds.has(n.id);
  const items = state.items || {};
  const applies = (item) => !!item && (!notebookIds || notebookIds.includes(item.notebookId));

  for (const node of flatten(tree)) {
    if (node === tree) continue;
    if (!isSelected(node)) continue;
    if (node.kind === 'container' || node.kind === 'skipped') continue;
    const key = itemKey(node);
    if (seen.has(key)) continue;
    seen.add(key);

    const existing = applies(items[key]) ? items[key] : null;
    const ids = idsOf(existing);
    if (existing && ids.length && (node.kind !== 'file' || existing.signature === signature(node) || !node.sizeText)) {
      skipped.push({ node, key, reason: PRESENT_REASON });
      continue;
    }
    const replaceSourceIds = existing ? [...ids, ...(existing.orphanIds || [])] : [];

    if (node.kind === 'file') {
      const cls = classifyFile(node.filename || node.title);
      const tooBig = !!(node.sizeBytes && node.sizeBytes > MAX_FILE_BYTES);
      const demuxable = DEMUXABLE_EXTENSIONS.has(cls.ext);
      if (tooBig && !demuxable) {
        skipped.push({ node, key, reason: 'größer als 200 MB' });
        continue;
      }
      // Videos: NotebookLM wertet nur den Ton aus - die Tonspur ist kleiner, schneller
      // und ab 200 MB der einzige Weg.
      const asAudio = demuxable && (tooBig || settings.videoAsAudio !== false);
      if (cls.action === 'unsupported' && !settings.driveMirror) {
        skipped.push({ node, key, reason: `Format .${cls.ext} wird von NotebookLM nicht unterstützt` });
        continue;
      }
      if (cls.action === 'drive-convert' && !settings.driveAsSource) {
        // pptx/docx are accepted directly by NotebookLM; other office formats only via Drive
        if (!NLM_DIRECT_EXTENSIONS.has(cls.ext) && !settings.driveMirror) {
          skipped.push({ node, key, reason: `Format .${cls.ext} nur über Google Drive exportierbar` });
          continue;
        }
      }
      jobs.push({ key, kind: 'file', node, filename: node.filename || ilias.sanitizeName(node.title), action: asAudio ? 'audio' : cls.action, ext: cls.ext, replaceSourceIds });
      continue;
    }

    if (node.kind === 'text') {
      const parts = textParts(node, settings);
      jobs.push({ key, kind: 'text', node, title: node.title, parts, content: parts.length === 1 ? parts[0].content : null, words: wordCount(node.content), replaceSourceIds });
      continue;
    }

    if (node.kind === 'link') {
      linkJobs.push({ key, kind: 'link', node, url: node.href, title: node.title, replaceSourceIds: [] });
    }
  }

  // Links are cheap and order-independent: run them after the uploads, batched.
  jobs.push(...linkJobs);

  if (settings.overviewSource !== false) {
    const ov = applies(items.overview) ? items.overview : null;
    jobs.push({ key: 'overview', kind: 'overview', title: overviewTitle(tree), replaceSourceIds: ov ? [...idsOf(ov), ...(ov.orphanIds || [])] : [] });
  }

  const counts = {
    files: jobs.filter((j) => j.kind === 'file').length,
    texts: jobs.filter((j) => j.kind === 'text').length,
    audio: jobs.filter((j) => j.action === 'audio').length,
    links: jobs.filter((j) => j.kind === 'link').length,
    skipped: skipped.length,
    present: skipped.filter((s) => s.reason === PRESENT_REASON).length,
    total: jobs.length,
  };
  return { jobs, skipped, counts, selectedIds, notebookIds };
}

async function blobToText(blob) {
  if (typeof blob.text === 'function') return blob.text();
  return new TextDecoder().decode(await blob.arrayBuffer());
}

export class Exporter {
  constructor({ nlm, drive = null, fetch, JSZip = null, extractAudio = null, log = () => {}, onProgress = () => {}, settings = {}, state, persist = async () => {}, sleep }) {
    this.nlm = nlm;
    this.extractAudio = extractAudio;
    this.drive = drive;
    this.fetch = fetch;
    this.JSZip = JSZip;
    this.log = log;
    this.onProgress = onProgress;
    this.settings = { driveMirror: false, driveAsSource: false, zip: false, waitForProcessing: true, delayMs: 400, ...settings };
    this.state = state;
    this.state.notebooks ||= [];
    this.state.items ||= {};
    this.persist = persist;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.aborted = false;
    this.zipEntries = [];
    this.results = [];
    this.chain = [];
    this.live = null;
  }

  abort() {
    this.aborted = true;
  }

  progress(message, extra = {}) {
    this.log(message);
    this.onProgress({ phase: 'export', message, ...extra });
  }

  titleOf(notebookId, fallback = '') {
    const nb = this.state.notebooks.find((n) => n.id === notebookId);
    return (nb && nb.title) || fallback;
  }

  /**
   * Wählt die Ziel-Kette und das Notebook, in das hochgeladen wird (letztes Glied der Kette).
   * `auto` = zuletzt für diesen Kurs verwendete Kette.
   */
  async ensureNotebook(target, courseTitle) {
    const state = this.state;
    for (const n of state.notebooks) if (!n.group) n.group = state.notebooks[0].id;
    let chain = [];
    if (target.mode === 'existing' && target.notebookId) {
      if (!state.notebooks.some((n) => n.id === target.notebookId)) {
        state.notebooks.push({ id: target.notebookId, title: target.title || courseTitle, group: target.notebookId });
      }
      chain = notebookChain(state, target.notebookId);
    } else if (target.mode === 'auto' && state.primaryNotebookId && state.notebooks.some((n) => n.id === state.primaryNotebookId)) {
      chain = notebookChain(state, state.primaryNotebookId);
    } else {
      const title = target.title || courseTitle;
      const nb = await this.nlm.createNotebook(title);
      state.notebooks.push({ id: nb.id, title: nb.title, group: nb.id });
      chain = [nb.id];
      this.progress(`Notebook „${title}“ angelegt`);
    }
    this.chain = chain;
    this.notebookId = chain[chain.length - 1];
    this.notebookTitle = this.titleOf(this.notebookId, target.title || courseTitle);
    state.primaryNotebookId = chain[0];
    this.baseTitle = this.titleOf(chain[0], this.notebookTitle);
    await this.persist(state);
    return this.notebookId;
  }

  async overflowNotebook() {
    const root = this.state.notebooks.find((n) => n.id === this.chain[0]);
    const n = this.chain.length + 1;
    const title = `${this.baseTitle.replace(/ \(\d+\)$/, '')} (${n})`;
    const nb = await this.nlm.createNotebook(title);
    this.state.notebooks.push({ id: nb.id, title, group: root ? root.group || root.id : nb.id });
    this.chain.push(nb.id);
    this.notebookId = nb.id;
    this.notebookTitle = title;
    this.progress(`Notebook voll – weiter in neuem Notebook „${title}“`);
    await this.persist(this.state);
  }

  /** Live-Abgleich der Kette; entfernt verschwundene Notebooks aus Kette und Zustand. */
  async reconcile(tree) {
    const rec = await reconcileNotebook({ nlm: this.nlm, state: this.state, tree, notebookIds: this.chain, settings: this.settings, log: this.log });
    this.live = rec.live;
    if (rec.gone.length) {
      this.chain = this.chain.filter((id) => !rec.gone.includes(id));
      this.state.notebooks = this.state.notebooks.filter((n) => !rec.gone.includes(n.id));
      if (!this.state.notebooks.some((n) => n.id === this.state.primaryNotebookId)) this.state.primaryNotebookId = this.chain[0] || null;
    }
    await this.persist(this.state);
    return rec;
  }

  async withQuota(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RpcError && err.isQuota) {
        await this.overflowNotebook();
        return fn();
      }
      throw err;
    }
  }

  async downloadFile(job) {
    const res = await this.fetch(job.node.downloadUrl, { credentials: 'include', redirect: 'follow' });
    const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    const cd = (res.headers && res.headers.get && res.headers.get('content-disposition')) || '';
    if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
    if (ilias.looksLikeLogin(res.url || '', '')) throw new Error('StudOn-Session abgelaufen – bitte neu einloggen');
    if (/text\/html/i.test(type) && !/attachment/i.test(cd)) {
      const html = await res.text();
      if (ilias.looksLikeLogin(res.url || '', html)) throw new Error('StudOn-Session abgelaufen – bitte neu einloggen');
      throw new Error('StudOn liefert keine Datei (keine Berechtigung oder kein Download-Objekt)');
    }
    const blob = await res.blob();
    let filename = ilias.filenameFromContentDisposition(cd) || job.filename;
    filename = ilias.sanitizeName(filename);
    if (!ilias.extensionOf(filename) && ilias.extensionOf(job.filename)) filename = `${filename}.${ilias.extensionOf(job.filename)}`;
    return { blob, filename };
  }

  /** Video -> .m4a (Tonspur, ohne Neukodierung). */
  async toAudio(blob, filename) {
    if (!this.extractAudio) throw new Error('Tonspur-Extraktion nicht verfügbar');
    this.log(`  🎬 ${filename}: Tonspur wird herausgelöst (${Math.round(blob.size / 1048576)} MB Video)`);
    const { blob: audio, info } = await this.extractAudio(blob);
    const name = `${filename.replace(/\.[a-z0-9]+$/i, '')}.m4a`;
    this.log(`  🎧 ${name}: ${Math.round(audio.size / 1048576)} MB, ${Math.round((info.durationSeconds || 0) / 60)} min`);
    return { blob: audio, filename: name };
  }

  async expandArchive(blob, filename) {
    if (!this.JSZip) throw new Error('ZIP-Entpacken nicht verfügbar');
    const zip = await this.JSZip.loadAsync(await blob.arrayBuffer());
    const entries = [];
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      if (/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(path)) continue;
      const data = await entry.async('uint8array');
      entries.push({ blob: new Blob([data]), filename: ilias.sanitizeName(path.split('/').pop()), path });
    }
    this.log(`Archiv ${filename}: ${entries.length} Dateien entpackt`);
    return entries;
  }

  async addFileToNotebook(job, blob, filename, cls) {
    if (blob.size === 0) throw new Error('Datei ist leer');
    if (blob.size > MAX_FILE_BYTES) throw new Error('Datei größer als 200 MB');
    let uploadBlob = blob;
    let uploadName = filename;
    if (cls.action === 'astext') {
      const text = await blobToText(blob);
      uploadBlob = new Blob([text], { type: 'text/plain' });
      uploadName = `${filename}.txt`;
    }

    let driveFile = null;
    if (this.drive && (this.settings.driveMirror || this.settings.driveAsSource)) {
      const folderId = await this.drive.ensureFolderPath([this.settings.driveRootFolder || 'NotebookLM Import', ...(job.node.path || [])]);
      const convertTo = this.settings.driveAsSource && CONVERSIONS[cls.ext] ? CONVERSIONS[cls.ext] : null;
      driveFile = await this.drive.uploadFile(filename, blob, folderId, { convertTo });
      this.log(`Drive: ${filename}${convertTo ? ' (konvertiert)' : ''}`);
    }

    if (this.settings.driveAsSource && driveFile && NLM_DRIVE_MIMES.has(driveFile.mimeType)) {
      const src = await this.withQuota(() => this.nlm.addDriveSource(this.notebookId, driveFile.id, driveFile.mimeType, filename));
      return { sourceId: src.id, driveFileId: driveFile.id, via: 'drive', title: filename };
    }
    if (cls.action === 'unsupported' || (cls.action === 'drive-convert' && !NLM_DIRECT_EXTENSIONS.has(cls.ext))) {
      if (driveFile) return { sourceId: null, driveFileId: driveFile.id, via: 'drive-only', title: filename };
      throw new Error(`Format .${cls.ext} wird von NotebookLM nicht unterstützt`);
    }
    const src = await this.withQuota(() => this.nlm.uploadFile(this.notebookId, uploadName, uploadBlob));
    return { sourceId: src.id, driveFileId: driveFile ? driveFile.id : null, via: 'upload', title: uploadName };
  }

  /** Alte Quelle(n) eines geänderten Objekts löschen, bevor die neue Fassung hochgeladen wird. */
  async replace(job) {
    const ids = (job.replaceSourceIds || []).filter(Boolean);
    if (!ids.length) return;
    await this.nlm.deleteSources(ids).catch((err) => this.log(`  alte Quelle(n) konnten nicht gelöscht werden: ${err.message}`));
    if (this.live) this.live.remove(ids);
  }

  record(key, job, result, extra = {}) {
    const ids = result.sourceIds || (result.sourceId ? [result.sourceId] : []);
    const prev = this.state.items[key];
    this.state.items[key] = {
      sourceId: ids[0] || null,
      sourceIds: ids,
      notebookId: this.notebookId,
      driveFileId: result.driveFileId || null,
      signature: job.node ? signature(job.node) : '',
      filename: extra.filename || job.filename || job.title || '',
      when: new Date().toISOString(),
      via: result.via || 'text',
      history: withHistory(prev, this.notebookId, ids),
    };
    if (this.live) {
      const titles = result.titles || [result.title || extra.filename || job.title || ''];
      ids.forEach((id, i) => {
        this.live.add({ id, title: titles[i] || titles[0] || '', status: SOURCE_STATUS.PROCESSING, url: job.kind === 'link' ? job.url : null }, this.notebookId);
        this.live.claim(id, key);
      });
    }
  }

  async runFileJob(job) {
    let { blob, filename } = await this.downloadFile(job);
    let cls = classifyFile(filename);
    if (DEMUXABLE_EXTENSIONS.has(cls.ext) && (job.action === 'audio' || blob.size > MAX_FILE_BYTES || this.settings.videoAsAudio)) {
      ({ blob, filename } = await this.toAudio(blob, filename));
      cls = classifyFile(filename);
    }
    if (this.settings.zip) this.zipEntries.push({ path: [...(job.node.path || []), filename].join('/'), blob });
    await this.replace(job);

    if (cls.action === 'archive') {
      const entries = await this.expandArchive(blob, filename);
      const ids = [];
      const titles = [];
      for (const entry of entries) {
        if (this.aborted) break;
        const ecls = classifyFile(entry.filename);
        if (ecls.action === 'unsupported' || ecls.action === 'archive') {
          this.log(`  ⏭ ${entry.path}: Format wird übersprungen`);
          continue;
        }
        const r = await this.addFileToNotebook({ ...job, node: { ...job.node, path: [...(job.node.path || []), filename.replace(/\.zip$/i, '')] } }, entry.blob, entry.filename, ecls);
        if (r.sourceId) { ids.push(r.sourceId); titles.push(r.title); }
        this.log(`  ✓ ${entry.path}`);
        await this.sleep(this.settings.delayMs);
      }
      this.record(job.key, job, { sourceIds: ids, titles, via: 'archive' }, { filename });
      return { sourceIds: ids, filename };
    }

    const r = await this.addFileToNotebook(job, blob, filename, cls);
    this.record(job.key, job, r, { filename });
    return { sourceIds: r.sourceId ? [r.sourceId] : [], filename, via: r.via };
  }

  async runTextJob(job) {
    await this.replace(job);
    const parts = job.parts || [{ title: job.title, content: job.content }];
    const ids = [];
    const titles = [];
    for (const part of parts) {
      const src = await this.withQuota(() => this.nlm.addTextSource(this.notebookId, part.title, part.content));
      ids.push(src.id);
      titles.push(part.title);
      if (parts.length > 1) await this.sleep(this.settings.delayMs);
    }
    if (this.settings.zip) this.zipEntries.push({ path: [...(job.node.path || []), job.node.filename].join('/'), blob: new Blob([parts.map((p) => p.content).join('\n\n')], { type: 'text/markdown' }) });
    this.record(job.key, job, { sourceIds: ids, titles, via: 'text' });
    return { sourceIds: ids };
  }

  async runLinkBatch(jobs) {
    const urls = jobs.map((j) => j.url);
    const added = await this.withQuota(() => this.nlm.addUrlSources(this.notebookId, urls));
    const byUrl = new Map(added.filter((a) => a.url).map((a) => [normUrl(a.url), a]));
    const pick = (job, i) => byUrl.get(normUrl(job.url)) || (added.length === jobs.length ? added[i] : null);
    const matched = jobs.map(pick);
    // Antwort kürzer als die Anfrage (oder ohne URLs): fehlende Quellen über die Quellenliste per URL nachschlagen.
    if (matched.some((s) => !s) && typeof this.nlm.getNotebook === 'function') {
      try {
        const nb = await this.nlm.getNotebook(this.notebookId);
        const fresh = new LiveIndex();
        for (const s of nb.sources || []) if (!this.live || !this.live.claimed.has(s.id)) fresh.add(s, this.notebookId);
        for (const a of added) fresh.claim(a.id, 'batch');
        jobs.forEach((job, i) => { if (!matched[i]) { const hit = fresh.findUrl(job.url); if (hit) { fresh.claim(hit.id, job.key); matched[i] = hit; } } });
      } catch (err) {
        this.log(`  Quellenliste für Link-Abgleich nicht lesbar: ${err.message}`);
      }
    }
    const ids = new Set();
    jobs.forEach((job, i) => {
      const src = matched[i];
      if (src) ids.add(src.id);
      this.record(job.key, job, { sourceId: src ? src.id : null, via: 'link', title: src ? src.title : job.title });
    });
    return { sourceIds: [...ids] };
  }

  async runOverviewJob(job, tree, courseUrl) {
    await this.replace(job);
    const content = treeToOverview(tree, { courseUrl });
    const src = await this.withQuota(() => this.nlm.addTextSource(this.notebookId, job.title, content));
    if (this.settings.zip) this.zipEntries.push({ path: 'Kursstruktur.md', blob: new Blob([content], { type: 'text/markdown' }) });
    this.record('overview', job, { sourceId: src.id, via: 'text', title: job.title });
    return { sourceIds: [src.id] };
  }

  /**
   * Plan nach dem Live-Abgleich neu berechnen: dieselbe Auswahl, aber gegen den abgeglichenen
   * Zustand und die Ziel-Kette. Handverlesene Pläne (nur bestimmte Jobs) bleiben beschränkt.
   */
  replan(tree, plan) {
    let selectedIds = null;
    if (plan.selectedIds) selectedIds = plan.selectedIds;
    else if (plan.jobs.some((j) => j.node) || (plan.skipped || []).length) {
      selectedIds = new Set();
      for (const j of plan.jobs) if (j.node) selectedIds.add(j.node.id);
      for (const s of plan.skipped || []) if (s.node) selectedIds.add(s.node.id);
    }
    const overviewSource = plan.jobs.some((j) => j.kind === 'overview');
    return planExport({ tree, selectedIds, state: this.state, settings: { ...this.settings, overviewSource }, notebookIds: this.chain });
  }

  /**
   * Execute the plan. target = { mode: 'new'|'existing'|'auto', notebookId?, title? }
   */
  async run({ tree, plan, target, courseUrl = '' }) {
    this.state.title = tree.title;
    await this.ensureNotebook(target, tree.title);
    let rec = await this.reconcile(tree);
    if (!this.chain.length) {
      if (target.mode === 'existing') throw new Error('Das gewählte Notebook ist nicht (mehr) erreichbar.');
      this.progress('Bisheriges Notebook existiert nicht mehr – neues wird angelegt');
      await this.ensureNotebook({ mode: 'new', title: target.title }, tree.title);
      rec = await this.reconcile(tree);
    }
    if (rec.total) this.progress(`Abgleich: ${rec.total} Quellen im Notebook, ${rec.adopted} wiedererkannt, ${rec.missing} fehlen und werden neu hochgeladen${rec.duplicates.length ? `, ${rec.duplicates.length} Dubletten-Gruppen` : ''}`);

    const livePlan = this.replan(tree, plan);
    const jobs = [...livePlan.jobs];
    const present = livePlan.counts.present;
    if (present) this.progress(`${present} Objekte sind bereits im Notebook und werden übersprungen`);
    const total = jobs.length;
    const uploaded = [];
    const errors = [];
    let done = 0;

    let i = 0;
    while (i < jobs.length) {
      if (this.aborted) break;
      const job = jobs[i];
      const label = job.kind === 'file' ? `${job.action === 'audio' ? '🎬' : '📄'} ${job.filename}` : job.kind === 'text' ? `📝 ${job.title}` : job.kind === 'link' ? `🔗 ${job.title}` : `🗂 ${job.title}`;
      this.progress(`${label}`, { index: done, total, jobKey: job.key, status: 'running' });
      try {
        let result;
        if (job.kind === 'link') {
          const batch = [job];
          while (i + batch.length < jobs.length && jobs[i + batch.length].kind === 'link' && batch.length < 10) batch.push(jobs[i + batch.length]);
          result = await this.runLinkBatch(batch);
          for (const b of batch) this.results.push({ key: b.key, status: 'ok' });
          this.onProgress({ phase: 'export', message: `${batch.length} Links hinzugefügt`, index: done + batch.length, total, jobKey: job.key, status: 'ok', batchKeys: batch.map((b) => b.key) });
          i += batch.length;
          done += batch.length;
          uploaded.push(...result.sourceIds);
          await this.persist(this.state);
          await this.sleep(this.settings.delayMs);
          continue;
        }
        if (job.kind === 'file') result = await this.runFileJob(job);
        else if (job.kind === 'text') result = await this.runTextJob(job);
        else if (job.kind === 'overview') result = await this.runOverviewJob(job, tree, courseUrl);
        uploaded.push(...(result.sourceIds || []));
        this.results.push({ key: job.key, status: 'ok', filename: result.filename });
        this.onProgress({ phase: 'export', message: `✓ ${label}`, index: done + 1, total, jobKey: job.key, status: 'ok' });
      } catch (err) {
        errors.push({ key: job.key, title: job.filename || job.title, error: err.message });
        this.results.push({ key: job.key, status: 'error', error: err.message });
        this.log(`✗ ${label}: ${err.message}`);
        this.onProgress({ phase: 'export', message: `✗ ${label}: ${err.message}`, index: done + 1, total, jobKey: job.key, status: 'error', error: err.message });
        if (/Session abgelaufen|Nicht bei NotebookLM angemeldet/.test(err.message)) {
          this.aborted = true;
        }
      }
      i += 1;
      done += 1;
      await this.persist(this.state);
      await this.sleep(this.settings.delayMs);
    }

    this.state.lastRun = new Date().toISOString();
    await this.persist(this.state);

    let statuses = {};
    if (this.settings.waitForProcessing && uploaded.length && !this.aborted) {
      this.progress(`Warte auf Verarbeitung von ${uploaded.length} Quellen …`, { status: 'waiting' });
      const perNotebook = {};
      for (const item of Object.values(this.state.items)) {
        for (const id of idsOf(item)) if (uploaded.includes(id)) (perNotebook[item.notebookId] ||= []).push(id);
      }
      for (const [nbId, ids] of Object.entries(perNotebook)) {
        try {
          const s = await this.nlm.waitForSources(nbId, ids, {
            onUpdate: (states, pending) => this.onProgress({ phase: 'processing', message: `Verarbeitung: ${ids.length - pending}/${ids.length} fertig`, states }),
          });
          statuses = { ...statuses, ...s };
        } catch (err) {
          this.log(`Statusabfrage fehlgeschlagen: ${err.message}`);
        }
      }
    }

    let zipBlob = null;
    if (this.settings.zip && this.JSZip && this.zipEntries.length) {
      const zip = new this.JSZip();
      for (const e of this.zipEntries) {
        const data = typeof e.blob === 'string' ? e.blob : await e.blob.arrayBuffer();
        zip.file(e.path, data);
      }
      zipBlob = await zip.generateAsync({ type: this.settings.zipOutputType || 'blob' });
    }

    return {
      notebooks: this.state.notebooks.filter((n) => this.chain.includes(n.id)).map((n) => ({ ...n, url: this.nlm.notebookUrl ? this.nlm.notebookUrl(n.id) : '' })),
      added: uploaded.length,
      present,
      reconcile: { total: rec.total, adopted: rec.adopted, missing: rec.missing, duplicates: rec.duplicates },
      errors,
      results: this.results,
      statuses,
      zipBlob,
      aborted: this.aborted,
    };
  }
}

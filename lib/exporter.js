/**
 * Export planning and execution: tree → NotebookLM (+ optional Drive mirror, ZIP).
 * Everything is injected (nlm client, drive client, fetch, JSZip) for testability.
 */

import { flatten, treeToOverview } from './crawler.js';
import { RpcError } from './nlm-client.js';
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

/**
 * Decide what to do with each selected node.
 * @returns {{ jobs: Array, skipped: Array, counts: object }}
 */
export function planExport({ tree, selectedIds = null, state = { items: {} }, settings = {} }) {
  const jobs = [];
  const linkJobs = [];
  const skipped = [];
  const seen = new Set();
  const isSelected = (n) => !selectedIds || selectedIds.has(n.id);
  const items = state.items || {};

  for (const node of flatten(tree)) {
    if (node === tree) continue;
    if (!isSelected(node)) continue;
    if (node.kind === 'container' || node.kind === 'skipped') continue;
    const key = itemKey(node);
    if (seen.has(key)) continue;
    seen.add(key);

    const existing = items[key];
    if (existing && existing.sourceId && (node.kind !== 'file' || existing.signature === signature(node) || !node.sizeText)) {
      skipped.push({ node, key, reason: 'bereits exportiert' });
      continue;
    }

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
      jobs.push({ key, kind: 'file', node, filename: node.filename || ilias.sanitizeName(node.title), action: asAudio ? 'audio' : cls.action, ext: cls.ext, replaceSourceId: existing ? existing.sourceId : null });
      continue;
    }

    if (node.kind === 'text') {
      const parts = splitByWords(node.content, MAX_TEXT_WORDS);
      parts.forEach((content, i) => {
        const title = parts.length > 1 ? `${node.title} (Teil ${i + 1}/${parts.length})` : node.title;
        jobs.push({ key: parts.length > 1 ? `${key}#${i + 1}` : key, kind: 'text', node, title, content, words: wordCount(content), replaceSourceId: existing ? existing.sourceId : null });
      });
      continue;
    }

    if (node.kind === 'link') {
      linkJobs.push({ key, kind: 'link', node, url: node.href, title: node.title });
    }
  }

  // Links are cheap and order-independent: run them after the uploads, batched.
  jobs.push(...linkJobs);

  if (settings.overviewSource !== false) {
    jobs.push({ key: 'overview', kind: 'overview', title: `${tree.title} – Kursstruktur`, replaceSourceId: items.overview ? items.overview.sourceId : null });
  }

  const counts = {
    files: jobs.filter((j) => j.kind === 'file').length,
    texts: jobs.filter((j) => j.kind === 'text').length,
    audio: jobs.filter((j) => j.action === 'audio').length,
    links: jobs.filter((j) => j.kind === 'link').length,
    skipped: skipped.length,
    total: jobs.length,
  };
  return { jobs, skipped, counts };
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
    this.persist = persist;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.aborted = false;
    this.zipEntries = [];
    this.results = [];
  }

  abort() {
    this.aborted = true;
  }

  progress(message, extra = {}) {
    this.log(message);
    this.onProgress({ phase: 'export', message, ...extra });
  }

  async ensureNotebook(target, courseTitle) {
    if (target.mode === 'existing' && target.notebookId) {
      this.notebookId = target.notebookId;
      this.notebookTitle = target.title || courseTitle;
    } else if (target.mode === 'auto' && this.state.primaryNotebookId) {
      this.notebookId = this.state.primaryNotebookId;
      this.notebookTitle = (this.state.notebooks.find((n) => n.id === this.notebookId) || {}).title || courseTitle;
    } else {
      const title = target.title || courseTitle;
      const nb = await this.nlm.createNotebook(title);
      this.notebookId = nb.id;
      this.notebookTitle = nb.title;
      this.progress(`Notebook „${title}“ angelegt`);
    }
    if (!this.state.notebooks.some((n) => n.id === this.notebookId)) {
      this.state.notebooks.push({ id: this.notebookId, title: this.notebookTitle });
    }
    if (!this.state.primaryNotebookId) this.state.primaryNotebookId = this.notebookId;
    this.baseTitle = this.state.notebooks[0] ? this.state.notebooks[0].title : this.notebookTitle;
    await this.persist(this.state);
    return this.notebookId;
  }

  async overflowNotebook() {
    const n = this.state.notebooks.length + 1;
    const title = `${this.baseTitle.replace(/ \(\d+\)$/, '')} (${n})`;
    const nb = await this.nlm.createNotebook(title);
    this.state.notebooks.push({ id: nb.id, title });
    this.notebookId = nb.id;
    this.notebookTitle = title;
    this.progress(`Notebook voll – weiter in neuem Notebook „${title}“`);
    await this.persist(this.state);
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
      return { sourceId: src.id, driveFileId: driveFile.id, via: 'drive' };
    }
    if (cls.action === 'unsupported' || (cls.action === 'drive-convert' && !NLM_DIRECT_EXTENSIONS.has(cls.ext))) {
      if (driveFile) return { sourceId: null, driveFileId: driveFile.id, via: 'drive-only' };
      throw new Error(`Format .${cls.ext} wird von NotebookLM nicht unterstützt`);
    }
    const src = await this.withQuota(() => this.nlm.uploadFile(this.notebookId, uploadName, uploadBlob));
    return { sourceId: src.id, driveFileId: driveFile ? driveFile.id : null, via: 'upload' };
  }

  record(key, job, result, extra = {}) {
    this.state.items[key] = {
      sourceId: result.sourceId || null,
      notebookId: this.notebookId,
      driveFileId: result.driveFileId || null,
      signature: job.node ? signature(job.node) : '',
      filename: extra.filename || job.filename || job.title || '',
      when: new Date().toISOString(),
      via: result.via || 'text',
    };
  }

  async runFileJob(job) {
    let { blob, filename } = await this.downloadFile(job);
    let cls = classifyFile(filename);
    if (DEMUXABLE_EXTENSIONS.has(cls.ext) && (job.action === 'audio' || blob.size > MAX_FILE_BYTES || this.settings.videoAsAudio)) {
      ({ blob, filename } = await this.toAudio(blob, filename));
      cls = classifyFile(filename);
    }
    if (this.settings.zip) this.zipEntries.push({ path: [...(job.node.path || []), filename].join('/'), blob });
    if (job.replaceSourceId) await this.nlm.deleteSources([job.replaceSourceId]).catch(() => {});

    if (cls.action === 'archive') {
      const entries = await this.expandArchive(blob, filename);
      const ids = [];
      for (const entry of entries) {
        if (this.aborted) break;
        const ecls = classifyFile(entry.filename);
        if (ecls.action === 'unsupported' || ecls.action === 'archive') {
          this.log(`  ⏭ ${entry.path}: Format wird übersprungen`);
          continue;
        }
        const r = await this.addFileToNotebook({ ...job, node: { ...job.node, path: [...(job.node.path || []), filename.replace(/\.zip$/i, '')] } }, entry.blob, entry.filename, ecls);
        if (r.sourceId) ids.push(r.sourceId);
        this.log(`  ✓ ${entry.path}`);
        await this.sleep(this.settings.delayMs);
      }
      this.record(job.key, job, { sourceId: ids[0] || null, via: 'archive' }, { filename });
      this.state.items[job.key].sourceIds = ids;
      return { sourceIds: ids, filename };
    }

    const r = await this.addFileToNotebook(job, blob, filename, cls);
    this.record(job.key, job, r, { filename });
    return { sourceIds: r.sourceId ? [r.sourceId] : [], filename, via: r.via };
  }

  async runTextJob(job) {
    if (job.replaceSourceId) await this.nlm.deleteSources([job.replaceSourceId]).catch(() => {});
    const src = await this.withQuota(() => this.nlm.addTextSource(this.notebookId, job.title, job.content));
    if (this.settings.zip) this.zipEntries.push({ path: [...(job.node.path || []), job.node.filename].join('/'), blob: new Blob([job.content], { type: 'text/markdown' }) });
    this.record(job.key, job, { sourceId: src.id, via: 'text' });
    return { sourceIds: [src.id] };
  }

  async runLinkBatch(jobs) {
    const urls = jobs.map((j) => j.url);
    const added = await this.withQuota(() => this.nlm.addUrlSources(this.notebookId, urls));
    jobs.forEach((job, i) => {
      const src = added[i] || added.find((a) => a.url === job.url) || null;
      this.record(job.key, job, { sourceId: src ? src.id : null, via: 'link' });
    });
    return { sourceIds: added.map((a) => a.id).filter(Boolean) };
  }

  async runOverviewJob(job, tree, courseUrl) {
    if (job.replaceSourceId) await this.nlm.deleteSources([job.replaceSourceId]).catch(() => {});
    const content = treeToOverview(tree, { courseUrl });
    const src = await this.withQuota(() => this.nlm.addTextSource(this.notebookId, job.title, content));
    if (this.settings.zip) this.zipEntries.push({ path: 'Kursstruktur.md', blob: new Blob([content], { type: 'text/markdown' }) });
    this.record('overview', job, { sourceId: src.id, via: 'text' });
    return { sourceIds: [src.id] };
  }

  /**
   * Execute the plan. target = { mode: 'new'|'existing'|'auto', notebookId?, title? }
   */
  async run({ tree, plan, target, courseUrl = '' }) {
    this.state.title = tree.title;
    await this.ensureNotebook(target, tree.title);
    const total = plan.jobs.length;
    const uploaded = [];
    const errors = [];
    let done = 0;

    const jobs = [...plan.jobs];
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
      for (const [key, item] of Object.entries(this.state.items)) {
        const ids = item.sourceIds || (item.sourceId ? [item.sourceId] : []);
        for (const id of ids) if (uploaded.includes(id)) (perNotebook[item.notebookId] ||= []).push(id);
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
      notebooks: this.state.notebooks.map((n) => ({ ...n, url: this.nlm.notebookUrl ? this.nlm.notebookUrl(n.id) : '' })),
      added: uploaded.length,
      errors,
      results: this.results,
      statuses,
      zipBlob,
      aborted: this.aborted,
    };
  }
}

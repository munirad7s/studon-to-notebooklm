import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DOMParser } from 'linkedom';
import { StudOnCrawler } from '../lib/crawler.js';
import { planExport, classifyFile, Exporter, itemKey, reconcileNotebook, deleteDuplicateSources, notebookChain, normUrl, normTitle, PRESENT_REASON } from '../lib/exporter.js';
import { RpcError } from '../lib/nlm-client.js';
import * as fx from './fixtures/studon.js';

await import('../lib/jszip.min.js');
const JSZip = globalThis.JSZip;
void createRequire;

async function scanFixture() {
  const c = new StudOnCrawler({ fetch: fx.fakeFetch(fx.routes()), DOMParser, options: { delayMs: 0 } });
  return c.scan({ refId: fx.COURSE_REF, type: 'crs', title: 'HCI' });
}

/**
 * Fake-NotebookLM mit echter Quellenbuchhaltung: getNotebook liefert, was hochgeladen
 * (und nicht gelöscht) wurde – so wie das echte rLM1Ne. Unbekannte Notebooks → Code 5.
 */
function fakeNlm({ quotaAfter = Infinity, notebooks = [] } = {}) {
  const calls = [];
  let n = 0;
  let seq = 0;
  const perNotebook = {};
  const sources = new Map(); // nbId → [{ id, title, url, status }]
  for (const nb of notebooks) sources.set(nb.id, (nb.sources || []).map((s) => ({ status: 2, ...s })));
  const count = (nbId) => { perNotebook[nbId] = (perNotebook[nbId] || 0) + 1; if (perNotebook[nbId] > quotaAfter) { perNotebook[nbId] -= 1; throw new RpcError('quota', { code: 8 }); } };
  const put = (nbId, src) => { if (!sources.has(nbId)) sources.set(nbId, []); sources.get(nbId).push({ status: 2, ...src }); return src; };
  const nlm = {
    calls,
    sources,
    notebooks: [...notebooks],
    async createNotebook(title) { n += 1; const id = `nb-${n}`; this.notebooks.push({ id, title }); sources.set(id, []); calls.push(['create', title]); return { id, title }; },
    async getNotebook(nbId) {
      calls.push(['get', nbId]);
      if (!sources.has(nbId)) throw new RpcError('not found', { code: 5 });
      return { id: nbId, title: '', sources: sources.get(nbId).map((s) => ({ type: null, driveDocId: null, url: null, ...s })) };
    },
    async uploadFile(nbId, filename, blob) {
      count(nbId);
      calls.push(['upload', nbId, filename, blob.size]);
      return put(nbId, { id: `src-${filename}-${++seq}`, title: filename });
    },
    async addTextSource(nbId, title, text) { count(nbId); calls.push(['text', nbId, title, text.length]); return put(nbId, { id: `txt-${title}-${++seq}`, title }); },
    async addUrlSources(nbId, urls) { calls.push(['urls', nbId, urls]); return urls.map((u) => put(nbId, { id: `url-${u}-${++seq}`, title: `Seite ${u}`, url: u })); },
    async addDriveSource(nbId, docId, mime, title) { calls.push(['drive-source', nbId, docId, mime, title]); return put(nbId, { id: `drv-${docId}-${++seq}`, title, driveDocId: docId }); },
    async deleteSources(ids) { calls.push(['delete', ids]); for (const list of sources.values()) for (const id of ids) { const i = list.findIndex((s) => s.id === id); if (i >= 0) list.splice(i, 1); } },
    async waitForSources(nbId, ids) { calls.push(['wait', nbId, ids.length]); return Object.fromEntries(ids.map((id) => [id, { status: 2 }])); },
    notebookUrl(id) { return `https://notebook.google.com/notebook/${id}`; },
  };
  return nlm;
}

const uploadsOf = (nlm) => nlm.calls.filter((c) => c[0] === 'upload' || c[0] === 'text' || c[0] === 'urls');

function fileFetch(map) {
  return async (url) => {
    const entry = map[url];
    if (!entry) return { ok: false, status: 404, url, headers: new Map(), text: async () => '', blob: async () => new Blob([]) };
    const headers = new Map(Object.entries(entry.headers || { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${entry.name}"` }));
    return { ok: true, status: 200, url, headers, text: async () => (entry.text || ''), blob: async () => entry.blob };
  };
}

async function makeZip(files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  const data = await zip.generateAsync({ type: 'uint8array' });
  return new Blob([data], { type: 'application/zip' });
}

test('classifyFile maps extensions to actions', () => {
  assert.equal(classifyFile('a.pdf').action, 'direct');
  assert.equal(classifyFile('a.PPTX').action, 'direct');
  assert.equal(classifyFile('a.py').action, 'astext');
  assert.equal(classifyFile('a.zip').action, 'archive');
  assert.equal(classifyFile('a.xlsx').action, 'drive-convert');
  assert.equal(classifyFile('a.exe').action, 'unsupported');
  assert.equal(classifyFile('README').action, 'direct');
});

test('planExport lists files, texts, links and the overview; skips exported and unsupported items', async () => {
  const tree = await scanFixture();
  const plan = planExport({ tree, settings: {} });
  assert.equal(plan.counts.files, 7);
  assert.ok(plan.counts.texts >= 4);
  assert.equal(plan.counts.links, 3);
  assert.equal(plan.jobs.at(-1).kind, 'overview');

  const firstFile = plan.jobs.find((j) => j.kind === 'file' && j.node.refId);
  const state = { items: { [firstFile.key]: { sourceId: 'x', signature: `${firstFile.node.sizeText || ''}|${firstFile.node.modified || ''}` } } };
  const plan2 = planExport({ tree, state, settings: {} });
  assert.equal(plan2.counts.files, 6);
  assert.equal(plan2.skipped[0].reason, PRESENT_REASON);

  const selected = new Set([firstFile.node.id]);
  const plan3 = planExport({ tree, selectedIds: selected, settings: { overviewSource: false } });
  assert.equal(plan3.jobs.length, 1);
  assert.equal(itemKey(firstFile.node), `file:${firstFile.node.refId}`);
});

test('Exporter uploads files, texts, links, records state, expands zips and converts code to txt', async () => {
  const tree = await scanFixture();
  const plan = planExport({ tree, settings: {} });
  const zipBlob = await makeZip({ 'sol/loesung.pdf': 'pdfbytes', 'sol/code.py': 'print(1)', 'sol/__MACOSX/x': 'junk', 'sol/tool.exe': 'bin' });
  const files = {};
  for (const job of plan.jobs.filter((j) => j.kind === 'file')) {
    const name = job.filename.endsWith('Blatt_02 (Lösung)') || job.filename === 'Blatt_02 (Lösung)' ? 'Blatt_02.zip' : job.filename;
    files[job.node.downloadUrl] = { name, blob: name.endsWith('.zip') ? zipBlob : new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }) };
  }
  const nlm = fakeNlm();
  const persisted = [];
  const state = { refId: fx.COURSE_REF, notebooks: [], primaryNotebookId: null, items: {} };
  const exporter = new Exporter({ nlm, fetch: fileFetch(files), JSZip, settings: { delayMs: 0, zip: true, zipOutputType: 'uint8array' }, state, persist: async (s) => persisted.push(JSON.stringify(s)), sleep: async () => {} });
  const result = await exporter.run({ tree, plan, target: { mode: 'new', title: 'HCI SS26' }, courseUrl: 'https://www.studon.fau.de/studon/go/crs/234016' });

  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  assert.equal(nlm.calls[0][0], 'create');
  const uploads = nlm.calls.filter((c) => c[0] === 'upload').map((c) => c[2]);
  assert.ok(uploads.includes('HCI_SS_2026_00_Orga.pdf'));
  assert.ok(uploads.includes('loesung.pdf'));
  assert.ok(uploads.includes('code.py.txt'));
  assert.ok(!uploads.some((u) => /exe|junk|__MACOSX/.test(u)));
  const texts = nlm.calls.filter((c) => c[0] === 'text').map((c) => c[2]);
  assert.ok(texts.includes('Lernmodul – 01_Introduction_to_HCI'));
  assert.ok(texts.includes('HCI – Kursstruktur'));
  const urlCall = nlm.calls.find((c) => c[0] === 'urls');
  assert.equal(urlCall[2].length, 3);
  assert.ok(nlm.calls.some((c) => c[0] === 'wait'));
  assert.equal(state.primaryNotebookId, 'nb-1');
  assert.ok(Object.keys(state.items).length >= plan.jobs.length - 1);
  assert.ok(persisted.length >= plan.jobs.length - plan.counts.links + 2);
  assert.ok(result.zipBlob.length > 100);
  assert.equal(result.notebooks[0].url, 'https://notebook.google.com/notebook/nb-1');

  // second run: everything already exported
  const plan2 = planExport({ tree, state, settings: {} });
  assert.equal(plan2.counts.files, 0);
  assert.equal(plan2.counts.texts, 0);
  assert.equal(plan2.counts.links, 0);
  assert.equal(plan2.jobs.length, 1);
  assert.deepEqual(plan2.jobs[0].replaceSourceIds, [state.items.overview.sourceId]);
});

test('Exporter continues in an overflow notebook when NotebookLM reports quota exhaustion', async () => {
  const tree = await scanFixture();
  const plan = planExport({ tree, settings: { overviewSource: false } });
  const files = {};
  for (const job of plan.jobs.filter((j) => j.kind === 'file')) files[job.node.downloadUrl] = { name: job.filename.endsWith('.pdf') ? job.filename : `${job.filename}.pdf`, blob: new Blob(['x']) };
  const countedJobs = plan.jobs.filter((j) => j.kind === 'file' || j.kind === 'text').length;
  const quotaAfter = Math.ceil(countedJobs / 2);
  const nlm = fakeNlm({ quotaAfter });
  const state = { refId: fx.COURSE_REF, notebooks: [], primaryNotebookId: null, items: {} };
  const exporter = new Exporter({ nlm, fetch: fileFetch(files), JSZip, settings: { delayMs: 0, waitForProcessing: false }, state, sleep: async () => {} });
  const result = await exporter.run({ tree, plan, target: { mode: 'new', title: 'HCI' } });
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  assert.equal(state.notebooks.length, 2);
  assert.equal(state.notebooks[1].title, 'HCI (2)');
  const uploads = nlm.calls.filter((c) => c[0] === 'upload');
  assert.ok(uploads.some((c) => c[1] === 'nb-2'));
});

test('Exporter reports download failures per item and keeps going', async () => {
  const tree = await scanFixture();
  const plan = planExport({ tree, settings: { overviewSource: false } });
  const nlm = fakeNlm();
  const state = { refId: fx.COURSE_REF, notebooks: [], primaryNotebookId: null, items: {} };
  const exporter = new Exporter({ nlm, fetch: fileFetch({}), JSZip, settings: { delayMs: 0, waitForProcessing: false }, state, sleep: async () => {} });
  const result = await exporter.run({ tree, plan, target: { mode: 'new', title: 'HCI' } });
  assert.equal(result.errors.length, plan.counts.files);
  assert.match(result.errors[0].error, /HTTP 404/);
  assert.ok(nlm.calls.some((c) => c[0] === 'text'));
});

test('Exporter uses Drive as source when configured', async () => {
  const tree = await scanFixture();
  const plan = planExport({ tree, settings: { overviewSource: false, driveAsSource: true } });
  const fileJob = plan.jobs.find((j) => j.kind === 'file');
  const files = { [fileJob.node.downloadUrl]: { name: 'Folien.pptx', blob: new Blob(['pptx']) } };
  const nlm = fakeNlm();
  const driveCalls = [];
  const drive = {
    async ensureFolderPath(names) { driveCalls.push(['folder', names]); return 'folder-1'; },
    async uploadFile(name, blob, parent, opts) { driveCalls.push(['upload', name, parent, opts.convertTo]); return { id: 'doc-1', mimeType: opts.convertTo || 'application/pdf', name }; },
  };
  const state = { refId: fx.COURSE_REF, notebooks: [], primaryNotebookId: null, items: {} };
  const exporter = new Exporter({ nlm, drive, fetch: fileFetch(files), JSZip, settings: { delayMs: 0, waitForProcessing: false, driveAsSource: true, driveRootFolder: 'NLM' }, state, sleep: async () => {} });
  const onlyFile = { ...plan, jobs: [fileJob] };
  await exporter.run({ tree, plan: onlyFile, target: { mode: 'new', title: 'HCI' } });
  assert.deepEqual(driveCalls[0], ['folder', ['NLM', ...fileJob.node.path]]);
  assert.equal(driveCalls[1][3], 'application/vnd.google-apps.presentation');
  assert.ok(nlm.calls.some((c) => c[0] === 'drive-source' && c[2] === 'doc-1'));
  assert.equal(state.items[fileJob.key].driveFileId, 'doc-1');
});

/* ---------- Videos als Tonspur ---------- */

function videoTree({ sizeBytes, ext = 'mp4' }) {
  return {
    id: 'root', kind: 'container', title: 'Aufzeichnungen', children: [
      { id: 'v1', kind: 'file', type: 'file', refId: null, title: `Vorlesung_10.06.${ext}`, filename: `Vorlesung_10.06.${ext}`, downloadUrl: 'https://studon/video.mp4', sizeBytes, sizeText: `${Math.round(sizeBytes / 1048576)} MB`, path: ['Aufzeichnungen'], children: [], errors: [] },
    ], errors: [],
  };
}

test('planExport: grosse MP4s werden zur Tonspur statt uebersprungen, andere Riesen-Dateien nicht', () => {
  const big = planExport({ tree: videoTree({ sizeBytes: 273160896 }), settings: { overviewSource: false } });
  assert.equal(big.jobs.length, 1);
  assert.equal(big.jobs[0].action, 'audio');
  assert.equal(big.counts.audio, 1);

  const bigPdf = planExport({ tree: videoTree({ sizeBytes: 273160896, ext: 'pdf' }), settings: { overviewSource: false } });
  assert.equal(bigPdf.jobs.length, 0);
  assert.equal(bigPdf.skipped[0].reason, 'größer als 200 MB');

  const small = planExport({ tree: videoTree({ sizeBytes: 50 * 1048576 }), settings: { videoAsAudio: false, overviewSource: false } });
  assert.equal(small.jobs[0].action, 'direct', 'kleines Video ohne videoAsAudio bleibt Video');
  const smallDefault = planExport({ tree: videoTree({ sizeBytes: 50 * 1048576 }), settings: { overviewSource: false } });
  assert.equal(smallDefault.jobs[0].action, 'audio', 'Standard: auch kleine Videos als Tonspur');
});

test('Exporter loest die Tonspur heraus und laedt eine .m4a hoch', async () => {
  const tree = videoTree({ sizeBytes: 273160896 });
  const plan = planExport({ tree, settings: { overviewSource: false } });
  const nlm = fakeNlm();
  const extracted = [];
  const exporter = new Exporter({
    nlm,
    fetch: fileFetch({ 'https://studon/video.mp4': { name: 'Vorlesung_10.06.mp4', blob: new Blob(['mp4bytes'], { type: 'video/mp4' }), headers: { 'content-type': 'video/mp4', 'content-disposition': 'attachment; filename="Vorlesung_10.06.mp4"' } } }),
    extractAudio: async (blob) => { extracted.push(blob.size); return { blob: new Blob(['aac'], { type: 'audio/mp4' }), info: { durationSeconds: 4980 } }; },
    settings: { delayMs: 0, videoAsAudio: true },
    state: { refId: 'x', notebooks: [], primaryNotebookId: null, items: {} },
    persist: async () => {}, sleep: async () => {},
  });
  const result = await exporter.run({ tree, plan, target: { mode: 'new', title: 'Video' }, courseUrl: 'https://studon/crs' });
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  assert.equal(extracted.length, 1, 'Tonspur einmal extrahiert');
  const upload = nlm.calls.find((c) => c[0] === 'upload');
  assert.equal(upload[2], 'Vorlesung_10.06.m4a');
});

test('Exporter ohne Extraktor meldet einen klaren Fehler statt 261 MB hochzuladen', async () => {
  const tree = videoTree({ sizeBytes: 273160896 });
  const plan = planExport({ tree, settings: { overviewSource: false } });
  const nlm = fakeNlm();
  const exporter = new Exporter({
    nlm,
    fetch: fileFetch({ 'https://studon/video.mp4': { name: 'Vorlesung_10.06.mp4', blob: new Blob(['x']) } }),
    settings: { delayMs: 0 },
    state: { refId: 'x', notebooks: [], primaryNotebookId: null, items: {} },
    persist: async () => {}, sleep: async () => {},
  });
  const result = await exporter.run({ tree, plan, target: { mode: 'new', title: 'Video' }, courseUrl: '' });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error || JSON.stringify(result.errors[0]), /Tonspur-Extraktion nicht verfügbar/);
  assert.equal(nlm.calls.some((c) => c[0] === 'upload'), false);
});

/* ---------- Dubletten-Schutz: Live-Abgleich mit dem Notebook ---------- */

async function exportedCourse({ settings = {} } = {}) {
  const tree = await scanFixture();
  const plan = planExport({ tree, settings: { overviewSource: false } });
  const files = {};
  for (const job of plan.jobs.filter((j) => j.kind === 'file')) files[job.node.downloadUrl] = { name: job.filename.endsWith('.pdf') ? job.filename : `${job.filename}.pdf`, blob: new Blob(['x']) };
  const nlm = fakeNlm();
  const state = { refId: fx.COURSE_REF, notebooks: [], primaryNotebookId: null, items: {} };
  const mk = (st) => new Exporter({ nlm, fetch: fileFetch(files), JSZip, settings: { delayMs: 0, waitForProcessing: false, ...settings }, state: st, sleep: async () => {} });
  const result = await mk(state).run({ tree, plan, target: { mode: 'new', title: 'HCI' } });
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  return { tree, plan, files, nlm, state, mk };
}

test('Abgleich: ohne lokalen Zustand werden vorhandene Quellen per Titel/URL erkannt – nichts wird doppelt hochgeladen', async () => {
  const { tree, plan, nlm, mk } = await exportedCourse();
  const before = uploadsOf(nlm).length;
  const fresh = { refId: fx.COURSE_REF, notebooks: [], primaryNotebookId: null, items: {} };
  const r = await mk(fresh).run({ tree, plan, target: { mode: 'existing', notebookId: 'nb-1', title: 'HCI' } });
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(uploadsOf(nlm).length, before, 'keine neuen Uploads');
  assert.equal(r.added, 0);
  assert.equal(r.present, plan.jobs.length);
  assert.equal(r.reconcile.adopted, plan.jobs.length);
  assert.ok(Object.values(fresh.items).every((i) => i.via === 'adopted' && i.notebookId === 'nb-1'));
  assert.equal(nlm.sources.get('nb-1').length, plan.jobs.length);
  assert.equal(r.reconcile.duplicates.length, 0);
});

test('Abgleich: in NotebookLM gelöschte Quelle wird neu hochgeladen, alles andere nicht', async () => {
  const { tree, plan, nlm, state, mk } = await exportedCourse();
  const fileKey = Object.keys(state.items).find((k) => k.startsWith('file:'));
  await nlm.deleteSources([state.items[fileKey].sourceId]);
  const before = uploadsOf(nlm).length;
  const r = await mk(state).run({ tree, plan, target: { mode: 'auto' } });
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.reconcile.missing, 1);
  assert.equal(r.added, 1);
  assert.equal(uploadsOf(nlm).length, before + 1);
  assert.equal(state.items[fileKey].via, 'upload');
  assert.equal(nlm.sources.get('nb-1').length, plan.jobs.length);
});

test('Zustand gilt pro Notebook: neues Notebook bekommt alles, Rückkehr ins alte lädt nichts doppelt', async () => {
  const { tree, plan, nlm, state, mk } = await exportedCourse();
  const n1 = uploadsOf(nlm).length;
  const r2 = await mk(state).run({ tree, plan, target: { mode: 'new', title: 'HCI Kopie' } });
  assert.equal(r2.errors.length, 0, JSON.stringify(r2.errors));
  assert.equal(r2.added, plan.jobs.length);
  assert.equal(state.primaryNotebookId, 'nb-2');
  assert.equal(uploadsOf(nlm).length, n1 * 2);
  assert.deepEqual(notebookChain(state, 'nb-1'), ['nb-1']);
  assert.deepEqual(notebookChain(state, 'nb-2'), ['nb-2']);

  const r3 = await mk(state).run({ tree, plan, target: { mode: 'existing', notebookId: 'nb-1' } });
  assert.equal(r3.added, 0);
  assert.equal(r3.reconcile.adopted, 0, 'per History wiederhergestellt, nicht per Titel');
  assert.equal(r3.present, plan.jobs.length);
  assert.equal(nlm.sources.get('nb-1').length, plan.jobs.length);
  assert.equal(nlm.sources.get('nb-2').length, plan.jobs.length);
  assert.ok(Object.values(state.items).every((i) => i.notebookId === 'nb-1' && i.history['nb-2']));
});

test('Lange Texte: ein Job mit Teilen, alle Teile vermerkt, beim Ersetzen alle gelöscht', async () => {
  const words = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
  const content = [words, words, words].join('\n\n');
  const tree = { id: 'root', kind: 'container', title: 'K', children: [
    { id: 't1', kind: 'text', type: 'lm', refId: '9', title: 'Skript', filename: 'Skript.md', content, words: 90, path: ['K'], children: [], errors: [] },
  ], errors: [] };
  const settings = { overviewSource: false, maxTextWords: 40 };
  const plan = planExport({ tree, settings });
  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].parts.length, 3);
  const nlm = fakeNlm();
  const state = { refId: 'k', notebooks: [], primaryNotebookId: null, items: {} };
  const ex = () => new Exporter({ nlm, fetch: fileFetch({}), settings: { delayMs: 0, waitForProcessing: false, ...settings }, state, sleep: async () => {} });
  await ex().run({ tree, plan, target: { mode: 'new', title: 'K' } });
  assert.equal(nlm.calls.filter((c) => c[0] === 'text').length, 3);
  const key = 'text:lm:9:Skript.md';
  assert.equal(state.items[key].sourceIds.length, 3);

  const r2 = await ex().run({ tree, plan, target: { mode: 'auto' } });
  assert.equal(r2.added, 0);
  assert.equal(r2.present, 1);

  const ids = state.items[key].sourceIds;
  await nlm.deleteSources([ids[1]]);
  const r3 = await ex().run({ tree, plan, target: { mode: 'auto' } });
  assert.equal(r3.added, 3);
  const del = nlm.calls.filter((c) => c[0] === 'delete').at(-1);
  assert.deepEqual([...del[1]].sort(), [ids[0], ids[2]].sort());
  assert.equal(nlm.sources.get('nb-1').length, 3);
});

test('ZIP: geänderte Datei ersetzt alle entpackten Quellen', async () => {
  const tree = await scanFixture();
  const plan = planExport({ tree, settings: { overviewSource: false } });
  const zipJob = plan.jobs.find((j) => j.kind === 'file' && /Blatt_02/.test(j.filename));
  zipJob.node.sizeText = '12 KB';
  const files = { [zipJob.node.downloadUrl]: { name: 'Blatt_02.zip', blob: await makeZip({ 'a.pdf': 'a', 'b.pdf': 'b' }) } };
  const nlm = fakeNlm();
  const state = { refId: fx.COURSE_REF, notebooks: [], primaryNotebookId: null, items: {} };
  const ex = () => new Exporter({ nlm, fetch: fileFetch(files), JSZip, settings: { delayMs: 0, waitForProcessing: false }, state, sleep: async () => {} });
  const r1 = await ex().run({ tree, plan: { ...plan, jobs: [zipJob], skipped: [] }, target: { mode: 'new', title: 'HCI' } });
  assert.equal(r1.errors.length, 0, JSON.stringify(r1.errors));
  const item = state.items[zipJob.key];
  assert.equal(item.sourceIds.length, 2);

  const r2 = await ex().run({ tree, plan: { ...plan, jobs: [zipJob], skipped: [] }, target: { mode: 'auto' } });
  assert.equal(r2.added, 0, 'unverändertes ZIP wird nicht erneut hochgeladen');

  zipJob.node.modified = '01. Sep 2026, 10:00';
  const plan2 = planExport({ tree, state, settings: { overviewSource: false } });
  const zipJob2 = plan2.jobs.find((j) => j.key === zipJob.key);
  assert.deepEqual(zipJob2.replaceSourceIds, item.sourceIds);
  const r3 = await ex().run({ tree, plan: { ...plan2, jobs: [zipJob2], skipped: [] }, target: { mode: 'auto' } });
  assert.equal(r3.added, 2);
  const del = nlm.calls.filter((c) => c[0] === 'delete').at(-1);
  assert.deepEqual(del[1], item.sourceIds);
  assert.equal(nlm.sources.get('nb-1').length, 2);
});

test('Dubletten im Notebook erkennen und auf Wunsch entfernen; Dateien ohne Endung per Stamm erkennen', async () => {
  const nlm = fakeNlm({ notebooks: [{ id: 'nb-x', title: 'HCI', sources: [
    { id: 's1', title: '02_History.pdf' }, { id: 's2', title: '02_History.pdf' }, { id: 's3', title: '02_History.pdf', status: 1 }, { id: 's4', title: 'Einzeln.pdf' },
  ] }] });
  const tree = { id: 'root', kind: 'container', title: 'HCI', children: [
    { id: 'f1', kind: 'file', type: 'file', refId: '77', title: '02_History', filename: '02_History.pdf', downloadUrl: 'https://studon/f1', sizeText: '1 MB', path: ['HCI'], children: [], errors: [] },
    { id: 'f2', kind: 'file', type: 'file', refId: '78', title: 'Einzeln', filename: '', downloadUrl: 'https://studon/f2', sizeText: '1 MB', path: ['HCI'], children: [], errors: [] },
  ], errors: [] };
  const state = { refId: 'hci', notebooks: [], primaryNotebookId: null, items: {} };
  const rec = await reconcileNotebook({ nlm, state, tree, notebookIds: ['nb-x'] });
  assert.equal(rec.adopted, 2);
  assert.equal(state.items['file:77'].sourceId, 's1');
  assert.equal(state.items['file:78'].sourceId, 's4');
  assert.deepEqual(rec.duplicates, [{ title: '02_History.pdf', notebookId: 'nb-x', keep: 's1', remove: ['s2', 's3'] }]);

  const n = await deleteDuplicateSources(nlm, rec.duplicates, { live: rec.live });
  assert.equal(n, 2);
  assert.deepEqual(nlm.sources.get('nb-x').map((s) => s.id), ['s1', 's4']);
  assert.equal(rec.live.duplicates().length, 0);

  const plan = planExport({ tree, state, settings: { overviewSource: false }, notebookIds: ['nb-x'] });
  assert.equal(plan.jobs.length, 0);
  assert.equal(plan.counts.present, 2);
  const other = planExport({ tree, state, settings: { overviewSource: false }, notebookIds: ['nb-y'] });
  assert.equal(other.jobs.length, 2, 'Zustand eines anderen Notebooks zählt nicht');
});

test('Overflow-Kette: Abgleich über alle Glieder, Nachladen im letzten', async () => {
  const tree = await scanFixture();
  const plan = planExport({ tree, settings: { overviewSource: false } });
  const files = {};
  for (const job of plan.jobs.filter((j) => j.kind === 'file')) files[job.node.downloadUrl] = { name: job.filename.endsWith('.pdf') ? job.filename : `${job.filename}.pdf`, blob: new Blob(['x']) };
  const countedJobs = plan.jobs.filter((j) => j.kind === 'file' || j.kind === 'text').length;
  const nlm = fakeNlm({ quotaAfter: Math.ceil(countedJobs / 2) });
  const state = { refId: fx.COURSE_REF, notebooks: [], primaryNotebookId: null, items: {} };
  const ex = () => new Exporter({ nlm, fetch: fileFetch(files), JSZip, settings: { delayMs: 0, waitForProcessing: false }, state, sleep: async () => {} });
  const r1 = await ex().run({ tree, plan, target: { mode: 'new', title: 'HCI' } });
  assert.equal(r1.errors.length, 0, JSON.stringify(r1.errors));
  assert.deepEqual(notebookChain(state, 'nb-1'), ['nb-1', 'nb-2']);
  assert.equal(r1.notebooks.length, 2);

  const r2 = await ex().run({ tree, plan, target: { mode: 'auto' } });
  assert.equal(r2.added, 0);
  assert.equal(r2.present, plan.jobs.length);

  const inFirst = Object.entries(state.items).find(([k, i]) => k.startsWith('file:') && i.notebookId === 'nb-1');
  await nlm.deleteSources([inFirst[1].sourceId]);
  const before = nlm.calls.length;
  const r3 = await ex().run({ tree, plan, target: { mode: 'existing', notebookId: 'nb-1' } });
  assert.equal(r3.added, 1);
  const upload = nlm.calls.slice(before).find((c) => c[0] === 'upload');
  assert.equal(upload[1], 'nb-2', 'nachgeladen wird ins letzte Glied der Kette');
  assert.equal(state.items[inFirst[0]].notebookId, 'nb-2');
});

test('Bisheriges Notebook gelöscht: auto legt ein neues an, existing meldet einen Fehler', async () => {
  const { tree, plan, nlm, state, mk } = await exportedCourse();
  nlm.sources.delete('nb-1');
  const r = await mk(state).run({ tree, plan, target: { mode: 'auto' } });
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(state.primaryNotebookId, 'nb-2');
  assert.equal(r.added, plan.jobs.length);
  assert.ok(!state.notebooks.some((n) => n.id === 'nb-1'));
  await assert.rejects(mk(state).run({ tree, plan, target: { mode: 'existing', notebookId: 'nb-1' } }), /nicht \(mehr\) erreichbar/);
});

test('Abgleich bricht ab, wenn die Quellenliste nicht lesbar ist (statt blind hochzuladen)', async () => {
  const { tree, plan, nlm, state, mk } = await exportedCourse();
  nlm.getNotebook = async () => { throw new RpcError('kaputt', { code: 13 }); };
  const before = uploadsOf(nlm).length;
  await assert.rejects(mk(state).run({ tree, plan, target: { mode: 'auto' } }), /Quellenliste/);
  assert.equal(uploadsOf(nlm).length, before);
});

test('normUrl/normTitle: YouTube-Varianten, Schrägstriche, Groß-/Kleinschreibung', () => {
  assert.equal(normUrl('https://www.youtube.com/watch?v=abc123&t=5'), 'youtube:abc123');
  assert.equal(normUrl('https://youtu.be/abc123'), 'youtube:abc123');
  assert.equal(normUrl('https://www.youtube.com/embed/abc123'), 'youtube:abc123');
  assert.equal(normUrl('https://Example.com/pfad/'), normUrl('https://example.com/pfad#abschnitt'));
  assert.equal(normTitle('  Lernmodul –  Analysis '), 'lernmodul – analysis');
  assert.equal(normTitle('Ana\u0308lysis'), normTitle('An\u00e4lysis'), 'NFC: kombinierende und vorkomponierte Umlaute sind gleich');
});

test('Links: fehlt die URL in der Quellenliste, wird sie per getSource nachgeschlagen (YouTube) – kein Doppel', async () => {
  const nlm = fakeNlm({ notebooks: [{ id: 'nb-x', title: 'HCI', sources: [
    { id: 'yt-1', title: 'Minority Report Computer  Scene', type: 9 },
    { id: 'web-1', title: 'Interaction Design Foundation', type: 5 },
    { id: 'pdf-1', title: 'Folien.pdf', type: 3 },
  ] }] });
  const detailUrls = { 'yt-1': 'https://www.youtube.com/watch?v=33Raqx9sFbo', 'web-1': 'https://www.interaction-design.org/literature/' };
  const looked = [];
  nlm.getSource = async (id) => { looked.push(id); return { id, title: '', type: null, url: detailUrls[id] || null }; };
  const tree = { id: 'root', kind: 'container', title: 'HCI', children: [
    { id: 'l1', kind: 'link', title: 'Don Norman Talk', href: 'https://youtu.be/33Raqx9sFbo', isYouTube: true, path: ['HCI'], children: [], errors: [] },
    { id: 'l2', kind: 'link', title: 'IxDF Literatur', href: 'https://www.interaction-design.org/literature', path: ['HCI'], children: [], errors: [] },
    { id: 'l3', kind: 'link', title: 'Neu', href: 'https://example.org/neu', path: ['HCI'], children: [], errors: [] },
  ], errors: [] };
  const state = { refId: 'hci', notebooks: [], primaryNotebookId: null, items: {} };
  const rec = await reconcileNotebook({ nlm, state, tree, notebookIds: ['nb-x'] });
  assert.equal(rec.adopted, 2);
  assert.deepEqual(looked.sort(), ['web-1', 'yt-1'], 'nur Web-/YouTube-Quellen werden einzeln gelesen, keine PDFs');
  assert.equal(state.items['link:https://youtu.be/33Raqx9sFbo'].sourceId, 'yt-1');
  assert.equal(state.items['link:https://www.interaction-design.org/literature'].sourceId, 'web-1');
  const plan = planExport({ tree, state, settings: { overviewSource: false }, notebookIds: ['nb-x'] });
  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].url, 'https://example.org/neu');
});

test('Geänderter Text ersetzt die alte Quelle, kleine Schwankungen nicht', () => {
  const node = (words) => ({ id: 't1', kind: 'text', type: 'lm', refId: '7193542', title: 'Lernmodul – Introduction', filename: 'Lernmodul – Introduction.md', content: 'wort '.repeat(words), words, path: ['K'], children: [], errors: [] });
  const tree = (n) => ({ id: 'root', kind: 'container', type: 'crs', refId: '1', title: 'K', path: [], children: [n], errors: [] });
  const key = 'text:lm:7193542:Lernmodul – Introduction.md';
  const settings = { overviewSource: false };
  const state = (signature) => ({ items: { [key]: { sourceId: 'old', sourceIds: ['old'], signature } } });

  const grown = planExport({ tree: tree(node(2292)), state: state('words:88'), settings });
  assert.equal(grown.jobs.length, 1, 'H5P-Inhalt dazugekommen → neu hochladen');
  assert.deepEqual(grown.jobs[0].replaceSourceIds, ['old']);

  const jitter = planExport({ tree: tree(node(2300)), state: state('words:2292'), settings });
  assert.equal(jitter.jobs.length, 0);
  assert.equal(jitter.skipped[0].reason, PRESENT_REASON);

  const legacy = planExport({ tree: tree(node(2292)), state: state('|'), settings });
  assert.deepEqual(legacy.jobs[0].replaceSourceIds, ['old'], 'Eintrag von vor 2.3.0 wird einmal erneuert');
});

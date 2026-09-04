import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DOMParser } from 'linkedom';
import { StudOnCrawler } from '../lib/crawler.js';
import { planExport, classifyFile, Exporter, itemKey } from '../lib/exporter.js';
import { RpcError } from '../lib/nlm-client.js';
import * as fx from './fixtures/studon.js';

await import('../lib/jszip.min.js');
const JSZip = globalThis.JSZip;
void createRequire;

async function scanFixture() {
  const c = new StudOnCrawler({ fetch: fx.fakeFetch(fx.routes()), DOMParser, options: { delayMs: 0 } });
  return c.scan({ refId: fx.COURSE_REF, type: 'crs', title: 'HCI' });
}

function fakeNlm({ quotaAfter = Infinity } = {}) {
  const calls = [];
  let n = 0;
  const perNotebook = {};
  const count = (nbId) => { perNotebook[nbId] = (perNotebook[nbId] || 0) + 1; if (perNotebook[nbId] > quotaAfter) { perNotebook[nbId] -= 1; throw new RpcError('quota', { code: 8 }); } };
  const nlm = {
    calls,
    notebooks: [],
    async createNotebook(title) { n += 1; const id = `nb-${n}`; this.notebooks.push({ id, title }); calls.push(['create', title]); return { id, title }; },
    async uploadFile(nbId, filename, blob) {
      count(nbId);
      calls.push(['upload', nbId, filename, blob.size]);
      return { id: `src-${filename}`, title: filename };
    },
    async addTextSource(nbId, title, text) { count(nbId); calls.push(['text', nbId, title, text.length]); return { id: `txt-${title}`, title }; },
    async addUrlSources(nbId, urls) { calls.push(['urls', nbId, urls]); return urls.map((u) => ({ id: `url-${u}`, title: u, url: u })); },
    async addDriveSource(nbId, docId, mime, title) { calls.push(['drive-source', nbId, docId, mime, title]); return { id: `drv-${docId}`, title }; },
    async deleteSources(ids) { calls.push(['delete', ids]); },
    async waitForSources(nbId, ids) { calls.push(['wait', nbId, ids.length]); return Object.fromEntries(ids.map((id) => [id, { status: 2 }])); },
    notebookUrl(id) { return `https://notebook.google.com/notebook/${id}`; },
  };
  return nlm;
}

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
  assert.equal(plan2.skipped[0].reason, 'bereits exportiert');

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
  assert.equal(plan2.jobs[0].replaceSourceId, 'txt-HCI – Kursstruktur');
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

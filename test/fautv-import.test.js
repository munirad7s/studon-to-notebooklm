import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFauTvSources } from '../lib/fautv-import.js';
import { flatten } from '../lib/crawler.js';
import { itemKey, planExport, reconcileNotebook } from '../lib/exporter.js';
import * as ftv from './fixtures/fautv.js';

const series = 'https://www.fau.tv/series/example';
const clip = (id) => `https://www.fau.tv/clip/id/${id}`;
const root = () => ({ id: 'n1', kind: 'container', title: 'Course', path: [], children: [], errors: [] });

function fakeFetch({ missing = [] } = {}) {
  return async (url, init = {}) => {
    if (url === series) return { ok: true, url, text: async () => '<li><a href="/clip/id/1">A</a></li><li><a href="/clip/id/2">B</a></li>' };
    if (init.method === 'POST') return { ok: true, json: async () => ({ components: [{ effects: { returns: [ftv.SEGMENTS] } }] }) };
    const id = url.match(/\/id\/(\d+)/)?.[1];
    return { ok: true, url, text: async () => ftv.clipPage({ withTranscript: !missing.includes(id) }).replaceAll(ftv.CLIP_ID, id) };
  };
}

test('series and overlapping clips become distinct selectable text jobs with timestamps', async () => {
  const tree = root();
  const updates = [];
  const stats = await appendFauTvSources(tree, [series, clip(1)], { fetch: fakeFetch(), onProgress: (p) => updates.push(p) });
  assert.deepEqual(stats, { containers: 1, files: 0, texts: 2, links: 0, skipped: 0, errors: 0, requests: 5 });
  const texts = flatten(tree).filter((n) => n.kind === 'text');
  assert.equal(new Set(texts.map((n) => n.title)).size, 2);
  assert.equal(new Set(texts.map(itemKey)).size, 2);
  assert.equal(new Set(texts.map((n) => n.filename)).size, 2);
  assert.deepEqual(texts[0].path, ['Course', 'FAU.tv']);
  assert.match(texts[0].content, /\*\*\[00:00\]\*\*/);
  assert.equal(texts[0].url, clip(1));
  const plan = planExport({ tree, selectedIds: new Set([texts[1].id]), settings: { overviewSource: false } });
  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].node.id, texts[1].id);
  assert.equal(updates.at(-1).stats.texts, 2);
  const rerun = await appendFauTvSources(tree, [series], { fetch: fakeFetch() });
  assert.equal(rerun.texts, 0);
  assert.equal(rerun.requests, 1);
});

test('existing StudOn video nodes are deduplicated and failed transcripts remain visible and retryable', async () => {
  const tree = root();
  tree.children.push({ id: 'n2', kind: 'text', video: clip(1), title: 'Existing', children: [] });
  const stats = await appendFauTvSources(tree, [series, 'bad input'], { fetch: fakeFetch({ missing: ['2'] }) });
  assert.equal(stats.texts, 0);
  assert.equal(stats.skipped, 2);
  assert.equal(stats.errors, 2);
  assert.match(flatten(tree).find((n) => n.url === clip(2)).reason, /Transkript/);
  await appendFauTvSources(tree, [clip(2)], { fetch: fakeFetch() });
  assert.equal(flatten(tree).filter((n) => n.url === clip(2)).length, 1);
  assert.equal(flatten(tree).find((n) => n.url === clip(2)).kind, 'text');
});

test('stable identities and titles reconcile imports already in the selected notebook', async () => {
  const first = root();
  const second = root();
  await appendFauTvSources(first, [series], { fetch: fakeFetch() });
  await appendFauTvSources(second, [clip(2), clip(1)], { fetch: fakeFetch() });
  const original = flatten(first).filter((n) => n.kind === 'text');
  assert.deepEqual(flatten(second).filter((n) => n.kind === 'text').map(itemKey).sort(), original.map(itemKey).sort());
  const state = { items: {}, notebooks: [{ id: 'nb' }] };
  await reconcileNotebook({ tree: second, state, notebookIds: ['nb'], nlm: {
    getNotebook: async () => ({ sources: original.map((n, i) => ({ id: `source${i}`, title: n.title })) }),
  } });
  const plan = planExport({ tree: second, state, notebookIds: ['nb'], settings: { overviewSource: false } });
  assert.equal(plan.jobs.length, 0);
  assert.equal(plan.counts.present, 2);
});

test('abort rejects instead of converting cancellation to a skipped transcript', async () => {
  const controller = new AbortController();
  const tree = root();
  await assert.rejects(appendFauTvSources(tree, [clip(1)], {
    signal: controller.signal,
    fetch: async () => { controller.abort(); throw controller.signal.reason; },
  }), { name: 'AbortError' });
  assert.equal(tree.children.length, 0);
});

test('slug and numeric links share the same canonical identity, including existing course transcripts', async () => {
  const tree = root();
  const stats = await appendFauTvSources(tree, [ftv.FINAL_URL, ftv.CLIP_URL], { fetch: ftv.fakeFauTvFetch() });
  assert.equal(stats.texts, 1);
  const text = flatten(tree).find((n) => n.kind === 'text');
  assert.equal(text.refId, ftv.CLIP_URL);
  assert.match(text.title, /42516/);
  const existing = root();
  existing.children.push({ id: 'n2', kind: 'text', video: ftv.FINAL_URL, children: [] });
  const duplicate = await appendFauTvSources(existing, [ftv.CLIP_URL], { fetch: ftv.fakeFauTvFetch() });
  assert.equal(duplicate.texts, 0);
  assert.equal(existing.children.length, 1);
});

test('a unique legacy StudOn transcript title is adopted without another upload', async () => {
  const tree = root();
  await appendFauTvSources(tree, [clip(1)], { fetch: fakeFetch() });
  const state = { items: {}, notebooks: [{ id: 'nb' }] };
  const result = await reconcileNotebook({ tree, state, notebookIds: ['nb'], nlm: {
    getNotebook: async () => ({ sources: [{ id: 'old', title: `Transkript – ${ftv.TITLE}` }] }),
  } });
  assert.equal(result.adopted, 1);
  const plan = planExport({ tree, state, notebookIds: ['nb'], settings: { overviewSource: false } });
  assert.equal(plan.jobs.length, 0);
});

test('legacy title fallback rejects ambiguous clips, ambiguous sources, and multipart transcripts', async () => {
  for (const scenario of ['clips', 'sources', 'multipart']) {
    const tree = root();
    await appendFauTvSources(tree, scenario === 'clips' ? [series] : [clip(1)], { fetch: fakeFetch() });
    const state = { items: {}, notebooks: [{ id: 'nb' }] };
    const source = { id: 'old', title: `Transkript – ${ftv.TITLE}` };
    const result = await reconcileNotebook({ tree, state, notebookIds: ['nb'],
      settings: scenario === 'multipart' ? { maxTextWords: 10 } : {}, nlm: {
        getNotebook: async () => ({ sources: scenario === 'sources' ? [source, { ...source, id: 'other' }] : [source] }),
      },
    });
    assert.equal(result.adopted, 0, scenario);
  }
});

test('current canonical titles take priority over legacy fallback', async () => {
  const tree = root();
  await appendFauTvSources(tree, [clip(1)], { fetch: fakeFetch() });
  const imported = flatten(tree).find((n) => n.kind === 'text');
  const state = { items: {}, notebooks: [{ id: 'nb' }] };
  await reconcileNotebook({ tree, state, notebookIds: ['nb'], nlm: {
    getNotebook: async () => ({ sources: [{ id: 'old', title: imported.legacyTitle }, { id: 'current', title: imported.title }] }),
  } });
  assert.equal(state.items[itemKey(imported)].sourceId, 'current');
});

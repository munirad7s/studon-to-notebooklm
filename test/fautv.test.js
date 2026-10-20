import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipIdFromUrl, decodeEntities, extractSegments, fetchTranscript, FauTvLoginError, formatDuration,
  formatTimestamp, isFauTvUrl, parseFauTvUrl, resolveFauTvLinks, parseClipPage, transcriptToMarkdown, TranscriptUnavailableError,
} from '../lib/fautv.js';
import * as ftv from './fixtures/fautv.js';

test('isFauTvUrl und clipIdFromUrl erkennen Clip- und Serien-URLs, aber nicht die Startseite', () => {
  assert.equal(isFauTvUrl('https://www.fau.tv/clip/id/42516'), true);
  assert.equal(isFauTvUrl('https://fau.tv/clip/id/42516?x=1'), true);
  assert.equal(isFauTvUrl(ftv.FINAL_URL), true);
  assert.equal(isFauTvUrl('https://www.fau.tv'), false);
  assert.equal(isFauTvUrl('https://www.fau.tv/'), false);
  assert.equal(isFauTvUrl('https://www.fau.tv/series/human-computer-interaction-hci-s22'), false);
  assert.equal(isFauTvUrl('https://www.youtube.com/watch?v=x'), false);
  assert.equal(clipIdFromUrl('https://www.fau.tv/clip/id/42516'), '42516');
  assert.equal(clipIdFromUrl(ftv.FINAL_URL), null);
});

test('parseClipPage liest CSRF, Update-URL, Snapshot und Titel aus dem HTML', () => {
  const page = parseClipPage(ftv.clipPage(), ftv.FINAL_URL);
  assert.equal(page.csrf, ftv.CSRF);
  assert.equal(page.updateUrl, ftv.UPDATE_URL);
  assert.equal(page.title, ftv.TITLE, 'ID-Suffix aus og:title entfernt');
  assert.ok(page.snapshot.includes('"name":"clip-transcript"'), 'Snapshot ist wieder gueltiges JSON');
  assert.deepEqual(JSON.parse(page.snapshot).memo.name, 'clip-transcript');
});

test('parseClipPage ohne Transkript-Komponente liefert keinen Snapshot', () => {
  const page = parseClipPage(ftv.clipPage({ withTranscript: false }), ftv.FINAL_URL);
  assert.equal(page.snapshot, null);
  assert.equal(page.csrf, ftv.CSRF);
});

test('fetchTranscript baut den Livewire-Aufruf getEntries nach', async () => {
  const fetch = ftv.fakeFauTvFetch();
  const t = await fetchTranscript(ftv.CLIP_URL, { fetch });

  assert.equal(t.title, ftv.TITLE);
  assert.equal(t.clipId, '42516');
  assert.equal(t.url, ftv.FINAL_URL);
  assert.equal(t.segments.length, ftv.SEGMENTS.length);
  assert.equal(Math.round(t.durationSeconds), 1163);

  const post = fetch.calls.find((c) => c.init.method === 'POST');
  assert.equal(post.url, ftv.UPDATE_URL);
  assert.equal(post.init.credentials, 'include');
  assert.equal(post.init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(post.init.body);
  assert.equal(body._token, ftv.CSRF);
  assert.deepEqual(body.components[0].calls, [{ path: '', method: 'getEntries', params: [] }]);
  assert.equal(JSON.parse(body.components[0].snapshot).memo.name, 'clip-transcript');
});

test('fetchTranscript meldet fehlendes Transkript und Login-Wand als eigene Fehler', async () => {
  await assert.rejects(fetchTranscript(ftv.CLIP_URL, { fetch: ftv.fakeFauTvFetch({ withTranscript: false }) }), TranscriptUnavailableError);
  await assert.rejects(fetchTranscript(ftv.CLIP_URL, { fetch: ftv.fakeFauTvFetch({ loginWall: true }) }), FauTvLoginError);
  await assert.rejects(fetchTranscript(ftv.CLIP_URL, { fetch: ftv.fakeFauTvFetch({ segments: [] }) }), TranscriptUnavailableError);
});

test('extractSegments ist tolerant und filtert Leeres', () => {
  const segs = extractSegments({ components: [{ effects: { returns: [[{ startSeconds: 1, endSeconds: 2, text: ' a ' }, { text: '' }, null]] } }] });
  assert.deepEqual(segs, [{ startSeconds: 1, endSeconds: 2, text: 'a' }]);
  assert.deepEqual(extractSegments({}), []);
});

test('transcriptToMarkdown setzt Kopf und Zeitmarken-Absaetze', () => {
  const md = transcriptToMarkdown({ title: ftv.TITLE, url: ftv.FINAL_URL, segments: ftv.SEGMENTS, durationSeconds: 1163.24 });
  assert.match(md, /^# Transkript – 9 - Human Computer Interaction \(HCI\) - Evaluation 1/);
  assert.match(md, /\*\*Quelle:\*\* https:\/\/www\.fau\.tv\/series\//);
  assert.match(md, /\*\*Dauer:\*\* 19 min · 8 Segmente/);
  assert.match(md, /\*\*\[00:00\]\*\* Dear students, welcome back/);
  assert.match(md, /methods\.\n\n\*\*\[00:58\]\*\* So let's start/, 'Sprechpause (30 s Luecke) beginnt neuen Absatz');
  assert.match(md, /\*\*\[19:12\]\*\* And as said we are going to delve deeper/, 'grosse Luecke beginnt neuen Absatz');
  assert.equal((md.match(/\*\*\[\d\d:\d\d\]\*\*/g) || []).length, 3, 'drei Absaetze');
  assert.equal(md.includes('startSeconds'), false);
});

test('Zeit- und Dauerformat', () => {
  assert.equal(formatTimestamp(0), '00:00');
  assert.equal(formatTimestamp(61.9), '01:01');
  assert.equal(formatTimestamp(3725), '1:02:05');
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(1163), '19 min');
  assert.equal(formatDuration(5400), '1 h 30 min');
  assert.equal(decodeEntities('a &quot;b&quot; &amp; &#039;c&#039; &lt;d&gt;'), 'a "b" & \'c\' <d>');
});


test('parseFauTvUrl normalizes video and series routes and rejects other hosts/routes', () => {
  assert.deepEqual(parseFauTvUrl('http://fau.tv/series/course/?page=2#x'), { url: 'https://www.fau.tv/series/course', kind: 'series', id: 'course' });
  assert.equal(parseFauTvUrl(ftv.FINAL_URL).kind, 'clip');
  for (const url of ['https://fau.tv.evil/series/course', 'https://evil@fau.tv/series/course', 'ftp://fau.tv/series/course', 'https://fau.tv:8080/series/course', 'https://fau.tv/clip/id/1/extra', 'https://fau.tv/series/%zz']) {
    assert.equal(parseFauTvUrl(url), null, url);
  }
});

test('resolveFauTvLinks resolves mobile/desktop duplicates, titles, pagination and pasted videos', async () => {
  const series = 'https://www.fau.tv/series/course';
  const calls = [];
  const controller = new AbortController();
  const fetch = async (url, init) => {
    calls.push(url);
    assert.equal(init.credentials, 'include');
    assert.equal(init.signal, controller.signal);
    return { ok: true, url, text: async () => url.includes('page=2')
      ? '<li><a href="/series/course/second">Video</a><div class="line-clamp-2">Second lecture</div></li><a href="?page=2">2</a>'
      : '<li><a href="/series/course/first">preview</a><div class="line-clamp-2 font-bold">First &amp; lecture</div><a href="/series/course/first">preview</a></li><a href="?page=2">2</a><a href="https://evil.test/?page=3">Next</a>' };
  };
  const result = await resolveFauTvLinks([series, series, `${series}/first?x=1`, ftv.CLIP_URL], { fetch, signal: controller.signal });
  assert.deepEqual(result.errors, []);
  assert.equal(result.clips.length, 3);
  assert.equal(result.clips[0].title, 'First & lecture');
  assert.equal(result.clips[1].title, 'Second lecture');
  assert.deepEqual(calls, [series, `${series}?page=2`]);
});

test('resolveFauTvLinks reports invalid, login, and empty series while retaining valid videos', async () => {
  const fetch = async (url) => ({ ok: true, url: url.endsWith('/locked') ? 'https://www.fau.tv/login' : url, text: async () => '<h1>No clips</h1>' });
  const result = await resolveFauTvLinks(['https://evil.test', 'https://www.fau.tv/series/locked', 'https://www.fau.tv/series/empty', ftv.CLIP_URL], { fetch });
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[1].message, /Anmeldung/);
  assert.match(result.errors[2].message, /Keine Videos/);
  assert.equal(result.clips.length, 1);
});

test('FAU.tv cancellation propagates and transcript requests carry the signal', async () => {
  const controller = new AbortController();
  const fetch = ftv.fakeFauTvFetch();
  await fetchTranscript(ftv.CLIP_URL, { fetch, signal: controller.signal });
  assert.ok(fetch.calls.every((call) => call.init.signal === controller.signal));
  controller.abort();
  await assert.rejects(resolveFauTvLinks([ftv.CLIP_URL], { fetch, signal: controller.signal }), { name: 'AbortError' });
});


test('fetchTranscript recovers numeric clip ID from metadata for slug inputs', async () => {
  const result = await fetchTranscript(ftv.FINAL_URL, { fetch: ftv.fakeFauTvFetch() });
  assert.equal(result.clipId, ftv.CLIP_ID);
});

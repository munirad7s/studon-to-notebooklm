import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipIdFromUrl, decodeEntities, extractSegments, fetchTranscript, FauTvLoginError, formatDuration,
  formatTimestamp, isFauTvUrl, parseClipPage, transcriptToMarkdown, TranscriptUnavailableError,
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { StudOnCrawler, SessionExpiredError, collectItems, flatten, treeToOverview, collectMediaLinks, collectExternalLinks } from '../lib/crawler.js';
import * as fx from './fixtures/studon.js';

function crawler(extra = {}, fetchOpts = {}) {
  const fetch = fx.fakeFetch(fx.routes(), fetchOpts);
  const c = new StudOnCrawler({ fetch, DOMParser, options: { delayMs: 0, forum: false, ...extra } });
  return { c, fetch };
}

test('collectItems reads ILIAS 9 standard items with type, section and properties', () => {
  const doc = new DOMParser().parseFromString(fx.coursePage, 'text/html');
  const items = collectItems(doc);
  assert.equal(items.length, 10);
  const file = items.find((i) => i.refId === '7000001');
  assert.equal(file.type, 'file');
  assert.equal(file.title, 'HCI_SS_2026_00_Orga.pdf');
  assert.equal(file.section, 'Vorlesung');
  assert.equal(file.sizeText, '1,20 MB');
  assert.equal(file.sizeBytes, Math.round(1.2 * 1024 * 1024));
  assert.equal(file.modified, 'Gestern, 14:11');
  assert.equal(items.find((i) => i.refId === '6071389').section, 'Übungen');
  assert.equal(items.find((i) => i.refId === '7000005').type, 'tst');
});

test('scan walks folders, sessions, exercises, learning modules, pages and links', async () => {
  const { c } = crawler();
  const root = await c.scan({ refId: fx.COURSE_REF, type: 'crs', title: 'HCI' });
  const all = flatten(root);
  const byTitle = (t) => all.find((n) => n.title === t);

  // nested folders
  const folder = byTitle('Übungsblätter');
  assert.equal(folder.kind, 'container');
  assert.deepEqual(folder.children.map((n) => n.title), ['Blatt_01.pdf', 'Blatt_02 (Lösung)', 'Alt']);
  const nested = byTitle('Alt');
  assert.equal(nested.children[0].title, 'Blatt_2024.pdf');
  assert.deepEqual(nested.children[0].path, ['HCI', 'Übungsblätter', 'Alt']);
  assert.equal(nested.children[0].downloadUrl, 'https://www.studon.fau.de/studon/goto.php?target=file_7000013_download');

  // session materials
  assert.equal(byTitle('Kickoff_Slides.pdf').kind, 'file');

  // exercise: text + assignment file, but not "own submissions"
  const exc = byTitle('Übung 1: Bedürfnisse');
  const excText = exc.children.find((n) => n.kind === 'text');
  assert.match(excText.content, /Task-Artifact-Cycle/);
  assert.deepEqual(exc.children.filter((n) => n.kind === 'file').map((n) => n.filename), ['Aufgabenblatt_1.pdf']);

  // learning module: one merged text, deduplicated file, youtube link
  const lm = byTitle('01_Introduction_to_HCI');
  const lmText = lm.children.find((n) => n.kind === 'text');
  assert.match(lmText.content, /^# 01_Introduction_to_HCI/);
  assert.match(lmText.content, /## Motivation[\s\S]*## Definitionen/);
  assert.match(lmText.content, /\| Usability \| Gebrauchstauglichkeit \|/);
  assert.equal(lmText.pages, 2);
  const lmFiles = lm.children.filter((n) => n.kind === 'file');
  assert.equal(lmFiles.length, 1);
  assert.equal(lmFiles[0].filename, 'HCI_SS_2026_01_Introduction_1.pdf');
  const yt = lm.children.find((n) => n.kind === 'link');
  assert.equal(yt.href, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(yt.isYouTube, true);

  // content page
  assert.match(byTitle('FAQ').children[0].content, /Wann ist die Klausur\?/);

  // weblinks: external + youtube, hidden callLink reported
  const webr = byTitle('Weiterführende Links');
  assert.deepEqual(webr.children.map((n) => n.href), ['https://www.interaction-design.org/literature', 'https://www.youtube.com/watch?v=abc123def45']);
  assert.match(webr.errors[0], /Versteckter Link/);

  // skipped types are listed with reasons; item groups are ignored
  const tst = byTitle('Probeklausur');
  assert.equal(tst.kind, 'skipped');
  assert.equal(byTitle('Gruppe A'), undefined);
  const forum = byTitle('Forum');
  assert.equal(forum.kind, 'skipped');
  assert.match(forum.reason, /deaktiviert/);

  // course info text first
  assert.equal(root.children[0].kind, 'text');
  assert.match(root.children[0].content, /Mensch-Computer-Interaktion/);

  assert.equal(c.stats.files, 7);
  assert.ok(c.stats.errors === 0, `errors: ${JSON.stringify(all.flatMap((n) => n.errors))}`);
});

test('scan never fetches the same object twice and respects the info option', async () => {
  const { c, fetch } = crawler({ courseInfo: false });
  await c.scan({ refId: fx.COURSE_REF, type: 'crs', title: 'HCI' });
  const unique = new Set(fetch.calls);
  assert.equal(unique.size, fetch.calls.length);
  assert.ok(!fetch.calls.some((u) => u.includes('infoScreen')));
});

test('scan aborts with SessionExpiredError when StudOn redirects to SSO', async () => {
  const { c } = crawler({}, { loginFor: ['ref_id=6071389'] });
  await assert.rejects(c.scan({ refId: fx.COURSE_REF, type: 'crs', title: 'HCI' }), SessionExpiredError);
});

test('scan tolerates missing objects and records errors instead of failing', async () => {
  const routes = fx.routes();
  delete routes['https://www.studon.fau.de/studon/go/copa/7000004'];
  const fetch = fx.fakeFetch(routes);
  const c = new StudOnCrawler({ fetch, DOMParser, options: { delayMs: 0 } });
  const root = await c.scan({ refId: fx.COURSE_REF, type: 'crs', title: 'HCI' });
  const faq = flatten(root).find((n) => n.title === 'FAQ');
  assert.match(faq.errors[0], /HTTP 404/);
  assert.equal(c.stats.errors, 1);
});

test('treeToOverview renders the structure as markdown', async () => {
  const { c } = crawler();
  const root = await c.scan({ refId: fx.COURSE_REF, type: 'crs', title: 'HCI' });
  const md = treeToOverview(root, { courseUrl: 'https://www.studon.fau.de/studon/go/crs/234016' });
  assert.match(md, /^# HCI – Kursstruktur/);
  assert.match(md, /- 📁 Übungsblätter \(Abschnitt: Übungen\)\n  - 📄 Blatt_01.pdf \(226,41 KB\)/);
  assert.match(md, /⏭ Probeklausur/);
});

test('collectItems reads tile decks and legacy rows on the same page (HCI course, ref 6748584)', () => {
  const doc = new DOMParser().parseFromString(fx.mixedPage, 'text/html');
  const items = collectItems(doc);
  assert.equal(items.length, 7, 'legacy rows and cards are both collected');

  const analysis = items.find((i) => i.refId === '6815140');
  assert.ok(analysis, 'card from the tile deck is found');
  assert.equal(analysis.type, 'lm');
  assert.equal(analysis.title, 'Analysis', 'title link wins over the empty image link');
  assert.equal(analysis.section, 'Lecture Content');
  assert.match(analysis.description, /June 2nd/);

  const faq = items.find((i) => i.refId === '6815126');
  assert.equal(faq.type, 'copa');
  assert.equal(faq.title, 'FAQ HCI-Lecture and Exercise');
  assert.equal(faq.section, "FAQ's and additive Informations");
  assert.equal(faq.description, 'Frequently asked questions');

  assert.equal(items.filter((i) => i.type === 'lm').length, 3);
});

/* ---------- fau.tv ---------- */

import * as ftv from './fixtures/fautv.js';

const LM_PAGE_102 = 'https://www.studon.fau.de/studon/ilias.php?baseClass=ilLMPresentationGUI&ref_id=6815119&obj_id=102';
const FAUTV_LINK = '<p class="ilc_Paragraph ilc_text_block_Standard"><a class="ilc_link_ExtLink" rel="noopener" target="_blank" href="https://www.fau.tv/clip/id/42516">https://www.fau.tv/clip/id/42516</a></p>';

function crawlerWithFauTv(fauTvOpts = {}, scanOpts = {}) {
  const routes = { ...fx.routes(), [LM_PAGE_102]: fx.lmPage('Definitionen', FAUTV_LINK) };
  const studon = fx.fakeFetch(routes);
  const fautv = ftv.fakeFauTvFetch(fauTvOpts);
  const fetch = (url, init) => (/fau\.tv/.test(url) ? fautv(url, init) : studon(url, init));
  const c = new StudOnCrawler({ fetch, DOMParser, options: { delayMs: 0, forum: false, ...scanOpts } });
  return { c, fautv };
}

test('fau.tv-Link im Lernmodul wird zum Transkript-Text, nicht zum Link', async () => {
  const { c, fautv } = crawlerWithFauTv();
  const root = await c.scan({ refId: fx.COURSE_REF, type: 'crs', title: 'HCI' });
  const lm = flatten(root).find((n) => n.kind === 'container' && n.type === 'lm');

  const transcript = lm.children.find((n) => n.kind === 'text' && /^Transkript – /.test(n.title));
  assert.ok(transcript, 'Transkript-Knoten unter dem Lernmodul');
  assert.equal(transcript.title, `Transkript – ${ftv.TITLE}`);
  assert.equal(transcript.video, ftv.FINAL_URL);
  assert.equal(transcript.segments, ftv.SEGMENTS.length);
  assert.match(transcript.content, /\*\*\[00:00\]\*\* Dear students/);
  assert.ok(transcript.words > 20);

  assert.equal(lm.children.some((n) => n.kind === 'link' && /fau\.tv/.test(n.href)), false, 'kein Link-Knoten fuer fau.tv');
  assert.equal(fautv.calls.filter((x) => x.init.method === 'POST').length, 1, 'ein Livewire-Aufruf pro Clip');
});

test('fau.tv ohne Transkript wird als Fehler am Knoten vermerkt, Scan laeuft weiter', async () => {
  const { c } = crawlerWithFauTv({ withTranscript: false });
  const root = await c.scan({ refId: fx.COURSE_REF, type: 'crs', title: 'HCI' });
  const lm = flatten(root).find((n) => n.kind === 'container' && n.type === 'lm');
  assert.equal(lm.children.some((n) => /^Transkript – /.test(n.title || '')), false);
  assert.ok(lm.errors.some((e) => /fau\.tv 42516/.test(e)), JSON.stringify(lm.errors));
  assert.ok(lm.children.some((n) => n.kind === 'text'), 'Lernmodul-Text selbst ist trotzdem da');
});

test('Option fauTv=false laesst fau.tv-Links unangetastet', async () => {
  const { c, fautv } = crawlerWithFauTv({}, { fauTv: false });
  const root = await c.scan({ refId: fx.COURSE_REF, type: 'crs', title: 'HCI' });
  const lm = flatten(root).find((n) => n.kind === 'container' && n.type === 'lm');
  assert.equal(lm.children.some((n) => /^Transkript – /.test(n.title || '')), false);
  assert.equal(fautv.calls.length, 0, 'fau.tv wird nicht kontaktiert');
});

/* ---------- Video-Objekte, Legacy-Eigenschaften, News ---------- */

test('Legacy-Zeilen: keine Dubletten, Endung/Groesse/Datum aus den Eigenschaften, News ignoriert', () => {
  const doc = new DOMParser().parseFromString(fx.videoCoursePage, 'text/html');
  const items = collectItems(doc);
  assert.equal(items.length, 4, 'vier Objekte, kein News-Eintrag, keine Outer/Inner-Dublette');
  assert.equal(items.filter((i) => !i.type).length, 0, 'jedes Objekt hat einen Typ (Icon der Outer-Zeile)');

  const zip = items.find((i) => i.refId === '6148564');
  assert.equal(zip.type, 'file');
  assert.equal(zip.ext, 'zip');
  assert.equal(zip.sizeText, '1,20 MB');
  assert.equal(zip.modified, '12. Mär 2026, 10:05');

  const pdf = items.find((i) => i.refId === '6148565');
  assert.equal(pdf.ext, 'pdf');
  assert.equal(pdf.modified, 'Gestern, 14:11');
  assert.equal(items.find((i) => i.refId === fx.HTLM_REF).type, 'htlm');
  assert.equal(items.find((i) => i.refId === fx.XVID_REF).type, 'xvid');
});

test('HTML-Lernmodul mit MP4 als Startdatei wird zur Videodatei mit Groesse - ohne den Body zu lesen', async () => {
  const fetch = fx.videoFetch(fx.videoRoutes());
  const c = new StudOnCrawler({ fetch, DOMParser, options: { delayMs: 0 } });
  const root = await c.scan({ refId: fx.VIDEO_COURSE_REF, type: 'fold', title: 'Aufzeichnungen' });
  const htlm = root.children.find((n) => n.refId === fx.HTLM_REF);
  assert.ok(htlm, 'htlm-Knoten');
  const video = htlm.children.find((n) => n.kind === 'file');
  assert.ok(video, 'Videodatei unter dem Lernmodul');
  assert.equal(video.filename, 'Vorlesung_Marketing_10.06.2026.mp4');
  assert.equal(video.downloadUrl, fx.HTLM_VIDEO_URL);
  assert.equal(video.sizeBytes, 273160896);
  assert.equal(video.contentType, 'video/mp4');
  assert.equal(htlm.errors.length, 0, JSON.stringify(htlm.errors));
});

test('Interaktives Video (xvid) liefert das eingebettete MP4 mit WAC-Token und die Beschreibung', async () => {
  const fetch = fx.videoFetch(fx.videoRoutes());
  const c = new StudOnCrawler({ fetch, DOMParser, options: { delayMs: 0 } });
  const root = await c.scan({ refId: fx.VIDEO_COURSE_REF, type: 'fold', title: 'Aufzeichnungen' });
  const xvid = root.children.find((n) => n.refId === fx.XVID_REF);
  assert.ok(xvid, 'xvid-Knoten');
  assert.equal(xvid.kind, 'container');
  const video = xvid.children.find((n) => n.kind === 'file');
  assert.ok(video, 'Videodatei');
  assert.equal(video.downloadUrl, fx.XVID_VIDEO_URL);
  assert.match(video.filename, /\.mp4$/);
  assert.ok(xvid.children.some((n) => n.kind === 'text' && /^Video – /.test(n.title)), 'Beschreibung als Text');
});

test('Dateien ohne Endung im Titel bekommen die Endung aus den Eigenschaften', async () => {
  const fetch = fx.videoFetch(fx.videoRoutes());
  const c = new StudOnCrawler({ fetch, DOMParser, options: { delayMs: 0 } });
  const root = await c.scan({ refId: fx.VIDEO_COURSE_REF, type: 'fold', title: 'Aufzeichnungen' });
  const zip = root.children.find((n) => n.refId === '6148564');
  assert.equal(zip.kind, 'file');
  assert.equal(zip.filename, 'Cover Templates.zip');
  assert.equal(zip.sizeBytes, Math.round(1.2 * 1024 * 1024));
  const skipped = root.children.filter((n) => n.kind === 'skipped');
  assert.equal(skipped.length, 0, 'keine "unbekannter Typ"-Knoten aus News oder Dubletten');
});

test('media=false laesst Videos aus HTML-Lernmodul und xvid aus', async () => {
  const fetch = fx.videoFetch(fx.videoRoutes());
  const c = new StudOnCrawler({ fetch, DOMParser, options: { delayMs: 0, media: false } });
  const root = await c.scan({ refId: fx.VIDEO_COURSE_REF, type: 'fold', title: 'Aufzeichnungen' });
  const xvid = root.children.find((n) => n.refId === fx.XVID_REF);
  assert.equal(xvid.kind, 'skipped');
  const htlm = root.children.find((n) => n.refId === fx.HTLM_REF);
  assert.ok(htlm.children.some((n) => n.kind === 'file'), 'htlm-Video bleibt (Lernmodul-Option), nur Plugin-Videos haengen an media');
});

test('YouTube/fau.tv in <video src> sind Links, keine Downloads (sonst „watch: Failed to fetch“)', () => {
  const html = `<div>
    <video src="https://www.youtube.com/watch?v=abc123def45" title="Vorlesung 3"></video>
    <video><source src="https://www.fau.tv/clip/id/42516" type="video/mp4"></video>
    <video><source src="./data/StudOn/mobs/mm_1/PLB_VL1.mp4?il_wac_token=abc" type="video/mp4"></video>
    <iframe src="https://www.fau.tv/clip/id/777"></iframe>
  </div>`;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = 'https://www.studon.fau.de/studon/ilias.php?x=1';
  const media = collectMediaLinks(doc, base);
  assert.deepEqual(media.map((m) => m.title), ['PLB_VL1.mp4'], 'nur die lokale MP4 ist ein Download');
  const links = collectExternalLinks(doc, base);
  const yt = links.find((l) => l.isYouTube);
  assert.ok(yt && yt.href === 'https://www.youtube.com/watch?v=abc123def45' && yt.title === 'Vorlesung 3');
  assert.deepEqual(links.filter((l) => l.isFauTv).map((l) => l.href).sort(), ['https://www.fau.tv/clip/id/42516', 'https://www.fau.tv/clip/id/777']);
});

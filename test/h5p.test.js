import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { extractH5PContents, inlineH5P, h5pToHtml } from '../lib/h5p.js';
import { elementToMarkdown } from '../lib/text.js';
import { StudOnCrawler, flatten, collectMediaLinks } from '../lib/crawler.js';
import * as fx from './fixtures/studon.js';
import * as h5p from './fixtures/h5p.js';

const PAGE_URL = 'https://www.studon.fau.de/studon/ilias.php?baseClass=ilLMPresentationGUI&ref_id=7193542&obj_id=2198877';

function render(contents) {
  const html = h5p.h5pLmPage('Welcome to the Course', contents);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const count = inlineH5P(doc, html, PAGE_URL);
  const container = doc.querySelector('.ilc_page_cont_PageContainer');
  return { doc, count, md: elementToMarkdown(container) };
}

test('extractH5PContents liest initContent-Aufrufe inkl. UTF-8', () => {
  const html = h5p.h5pLmPage('X', [h5p.WELCOME, h5p.VIDEO]);
  const contents = extractH5PContents(html);
  assert.equal(contents.length, 2);
  assert.equal(contents[0].elementId, 'il_ui_fw_0');
  assert.equal(contents[0].contentId, '187903');
  assert.equal(contents[0].library, 'H5P.Column 1.18');
  assert.match(contents[0].params.content[0].content.params.text, /We’re glad you’re here – über Wertschöpfung/);
});

test('inlineH5P ersetzt den Platzhalter durch den Text', () => {
  const { count, md } = render([h5p.WELCOME]);
  assert.equal(count, 1);
  assert.doesNotMatch(md, /Bitte warten Sie/);
  assert.match(md, /Welcome!/);
  assert.match(md, /We’re glad you’re here – über Wertschöpfung\./);
});

test('H5P-Video wird zum <video> mit absoluter Datei-URL und sprechendem Titel', () => {
  const { doc, md } = render([h5p.VIDEO]);
  assert.match(md, /\[Video: Überblick: Kapitel 1\.mp4\]/);
  const media = collectMediaLinks(doc.body, PAGE_URL);
  assert.equal(media.length, 1);
  assert.equal(media[0].href, h5p.VIDEO_URL);
  assert.match(media[0].title, /^Überblick.*Kapitel 1\.mp4$/);
});

test('Selbsttests kommen mit Loesungen, ohne UI-Texte', () => {
  const { md } = render([h5p.QUIZ]);
  assert.match(md, /Match the features of Netflix/);
  assert.match(md, /fixed price: \*\*Value Proposition\*\*/);
  assert.match(md, /Subscription plans: \*\*Value Capture\*\*/, 'Tipp nach dem Doppelpunkt faellt weg');
  assert.match(md, /✔ \(richtig\) Only the business model determines value capture\./);
  assert.match(md, /✘ Products are easy to imitate\./);
  assert.match(md, /Longer range is a business model innovation\.[\s\S]*Lösung: falsch/);
  assert.match(md, /low \*\*marginal costs\*\*/);
  assert.match(md, /\*\*network effects \/ network effect\*\*/);
  assert.doesNotMatch(md, /\bCheck\b|\bRetry\b|Start Quiz/);
});

test('HTML-Entities in Antworten werden nicht doppelt kodiert', () => {
  const out = h5pToHtml({
    contentId: '1', library: 'H5P.MultiChoice 1.16', title: 't',
    params: { question: '<p>Wer?</p>', answers: [{ correct: true, text: '<div>Osterwalder &amp; Pigneur&#039;s &lt;Canvas&gt;</div>' }] },
  }, PAGE_URL);
  const doc = new DOMParser().parseFromString(`<div>${out}</div>`, 'text/html');
  assert.match(elementToMarkdown(doc.querySelector('div')), /✔ \(richtig\) Osterwalder & Pigneur's <Canvas>/);
});

test('Unbekannter Inhaltstyp: inhaltliche Felder ja, l10n/UI nein', () => {
  const out = h5pToHtml({
    contentId: '1', library: 'H5P.SomethingNew 1.0', title: 't',
    params: { l10n: { text: 'UI-Text' }, panels: [{ header: 'Kopf', text: '<p>Inhalt</p>' }], checkButtonText: 'Prüfen' },
  }, PAGE_URL);
  assert.match(out, /Kopf/);
  assert.match(out, /Inhalt/);
  assert.doesNotMatch(out, /UI-Text|Prüfen/);
});

test('Seite ohne H5P bleibt unveraendert', () => {
  const html = fx.lmPage('Motivation');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  assert.equal(inlineH5P(doc, html, PAGE_URL), 0);
});

test('Lernmodul mit H5P: nur Seiten (keine Kapitel-Dubletten), H5P-Text und Video im Export', async () => {
  const app = 'https://www.studon.fau.de/studon';
  const ref = '7193542';
  const lm = `${app}/ilias.php?baseClass=ilLMPresentationGUI&ref_id=${ref}`;
  const routes = {
    [`${app}/ilias.php?baseClass=ilrepositorygui&ref_id=7193538`]: fx.page('Digital Business Model Strategy', `
      <div class="ilContainerItemsContainer"><ul>${fx.item({ type: 'lm', refId: ref, title: 'Introduction' })}</ul></div>`),
    [`${lm}&cmd=showPrintViewSelection`]: h5p.explorerSelection({
      id: '1', type: 'lm', title: 'Introduction', children: [
        { id: '2198876', type: 'st', title: '1 Welcome', children: [{ id: '2198877', type: 'pg', title: 'Welcome to the Course' }] },
        { id: '2198878', type: 'st', title: '2 Self-Check', children: [{ id: '2198879', type: 'pg', title: 'Self-Check' }] },
      ],
    }),
    [`${lm}&obj_id=2198877`]: h5p.h5pLmPage('Welcome to the Course', [h5p.WELCOME, h5p.VIDEO]),
    [`${lm}&obj_id=2198879`]: h5p.h5pLmPage('Self-Check', [h5p.QUIZ]),
  };
  const fetch = fx.fakeFetch(routes);
  const c = new StudOnCrawler({ fetch, DOMParser, options: { delayMs: 0, courseInfo: false } });
  const root = await c.scan({ refId: '7193538', type: 'crs', title: 'DBMS' });
  const module = flatten(root).find((n) => n.kind === 'container' && n.type === 'lm');

  const pageCalls = fetch.calls.filter((u) => /obj_id=/.test(u));
  assert.deepEqual(pageCalls, [`${lm}&obj_id=2198877`, `${lm}&obj_id=2198879`], 'Kapitel und Lernmodul-Wurzel werden nicht abgerufen');

  const text = module.children.find((n) => n.kind === 'text');
  assert.equal(text.pages, 2);
  assert.doesNotMatch(text.content, /Bitte warten Sie/);
  assert.match(text.content, /## Welcome to the Course[\s\S]*Welcome!/);
  assert.match(text.content, /## Self-Check[\s\S]*✔ \(richtig\)/);

  const video = module.children.find((n) => n.kind === 'file');
  assert.ok(video, 'H5P-Video als Datei unter dem Lernmodul');
  assert.equal(video.downloadUrl, h5p.VIDEO_URL);
  assert.match(video.filename, /\.mp4$/);
});

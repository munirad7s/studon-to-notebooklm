import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { elementToMarkdown, splitByWords, wordCount } from '../lib/text.js';

function parse(html) {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
}

test('elementToMarkdown renders headings, paragraphs, lists and emphasis', () => {
  const doc = parse(`
    <div class="ilc_page_cont_PageContainer">
      <h1>Einführung</h1>
      <p>Erster <b>Absatz</b> mit <a href="https://example.org/x">Link</a>.</p>
      <ul><li>Punkt eins</li><li>Punkt <i>zwei</i><ul><li>verschachtelt</li></ul></li></ul>
      <ol><li>A</li><li>B</li></ol>
      <div class="ilTabs">NAVIGATION SOLL WEG</div>
      <script>var x = 1;</script>
    </div>`);
  const md = elementToMarkdown(doc.querySelector('.ilc_page_cont_PageContainer'));
  assert.match(md, /^## Einführung/);
  assert.match(md, /Erster \*\*Absatz\*\* mit Link \(https:\/\/example\.org\/x\)\./);
  assert.match(md, /- Punkt eins\n- Punkt \*zwei\*\n  - verschachtelt/);
  assert.match(md, /1\. A\n2\. B/);
  assert.doesNotMatch(md, /NAVIGATION/);
  assert.doesNotMatch(md, /var x/);
});

test('elementToMarkdown renders tables as pipe tables', () => {
  const doc = parse('<table><tr><th>Begriff</th><th>Definition</th></tr><tr><td>HCI</td><td>Human | Computer</td></tr></table>');
  const md = elementToMarkdown(doc.body);
  assert.equal(md, '| Begriff | Definition |\n| --- | --- |\n| HCI | Human / Computer |');
});

test('elementToMarkdown skips hidden elements and keeps line breaks', () => {
  const doc = parse('<p>Zeile 1<br>Zeile 2</p><p style="display:none">unsichtbar</p><p aria-hidden="true">auch</p>');
  const md = elementToMarkdown(doc.body);
  assert.equal(md, 'Zeile 1\nZeile 2');
});

test('splitByWords keeps paragraphs together', () => {
  const text = Array.from({ length: 10 }, (_, i) => `para ${i} ${'w '.repeat(50)}`).join('\n\n');
  const parts = splitByWords(text, 120);
  assert.ok(parts.length >= 4);
  assert.equal(parts.join('\n\n'), text);
  for (const p of parts) assert.ok(wordCount(p) <= 120);
  assert.deepEqual(splitByWords('short', 100), ['short']);
});

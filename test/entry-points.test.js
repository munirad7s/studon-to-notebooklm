import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

test('FAU.tv content entry follows series, video and unsupported navigation', async () => {
  const { document, window } = parseHTML('<html><head><title>Lecture series</title></head><body></body></html>');
  let shadow;
  const create = document.createElement.bind(document);
  document.createElement = (...args) => {
    const el = create(...args);
    if (args[0] === 'div') {
      const attach = el.attachShadow.bind(el);
      el.attachShadow = (options) => (shadow = attach(options));
    }
    return el;
  };
  const location = new URL('https://www.fau.tv/series/test');
  const messages = [];
  let update;
  const context = vm.createContext({ document, window, location, URL,
    setInterval(fn) { update = fn; },
    chrome: { runtime: { async sendMessage(message) { messages.push(message); return { ok: true }; } } },
  });
  vm.runInContext(await readFile(new URL('../content/fautv.js', import.meta.url), 'utf8'), context);
  const host = document.getElementById('studon-notebooklm-fautv');
  assert.equal(host.hidden, false);
  shadow.querySelector('button').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages[0].source, 'fautv');
  assert.equal(messages[0].ref, 'fautv:https://www.fau.tv/series/test');
  location.pathname = '/series/test/lecture-one';
  update();
  assert.equal(host.hidden, false);
  location.pathname = '/clip/id/42516';
  update();
  assert.equal(host.hidden, false);
  location.pathname = '/';
  update();
  assert.equal(host.hidden, true);
});

test('service worker normalizes FAU.tv series and reuses matching exporter', async () => {
  let listener;
  let existing = [];
  const created = [];
  const updated = [];
  globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}`,
      onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    tabs: { async query() { return existing; }, async create(tab) { created.push(tab); return { id: 7 }; },
      async update(id, value) { updated.push({ id, ...value }); } },
    windows: { async update() {} },
  };
  try {
    await import('../background/service_worker.js');
    const send = message => new Promise(resolve => listener(message, {}, resolve));
    const response = await send({ type: 'open-exporter', source: 'fautv', url: 'https://fau.tv/series/example/?x=1' });
    assert.equal(response.ok, true);
    const target = new URL(created[0].url);
    assert.equal(target.searchParams.get('source'), 'fautv');
    assert.equal(target.searchParams.get('ref'), 'fautv:https://www.fau.tv/series/example');
    existing = [{ id: 7, windowId: 1, url: target.href }];
    await send({ type: 'open-exporter', source: 'fautv', url: 'https://www.fau.tv/series/example' });
    assert.equal(created.length, 1);
    assert.equal(updated[0].id, 7);
    const invalid = await send({ type: 'open-exporter', source: 'fautv', url: 'https://example.com/series/example' });
    assert.equal(invalid.ok, false);
    assert.equal(created.length, 1);
  } finally { delete globalThis.chrome; }
});

test('popup accepts a pasted series link from a page outside StudOn', async () => {
  const { document, window } = parseHTML(await readFile(new URL('../popup/popup.html', import.meta.url), 'utf8'));
  const messages = [];
  globalThis.document = document;
  globalThis.window = { close() {} };
  globalThis.chrome = {
    tabs: { async query() { return [{ url: 'https://example.com', title: 'Other page' }]; } },
    runtime: { async sendMessage(message) { messages.push(message); return { ok: true }; } },
  };
  try {
    await import('../popup/popup.js');
    await new Promise(resolve => setImmediate(resolve));
    const form = document.getElementById('fautv-form');
    document.getElementById('fautv-url').value = 'https://example.com/series/test';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.match(document.getElementById('launch-error').textContent, /FAU.tv-Link/);
    assert.equal(messages.length, 0);
    document.getElementById('fautv-url').value = 'https://fau.tv/series/theoretische-informatik-fur-wirtschaftsinformatik-und-lehramt-s26';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages[0].source, 'fautv');
    assert.equal(messages[0].url, 'https://www.fau.tv/series/theoretische-informatik-fur-wirtschaftsinformatik-und-lehramt-s26');
  } finally {
    delete globalThis.chrome;
    delete globalThis.document;
    delete globalThis.window;
  }
});

test('Export aus einem StudOn-Tab merkt sich diesen Tab für die StudOn-Abrufe', async () => {
  let listener;
  const created = [];
  globalThis.chrome = {
    runtime: { getURL: path => `chrome-extension://test/${path}`,
      onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    tabs: { async query() { return []; }, async create(tab) { created.push(tab); return { id: 9 }; }, async update() {} },
    windows: { async update() {} },
  };
  try {
    await import('../background/service_worker.js?studon-tab');
    const send = (message, sender) => new Promise(resolve => listener(message, sender, resolve));
    await send({ type: 'open-exporter', ref: '7139011', objType: 'crs', title: 'Implementing Innovation', mode: 'new' }, { tab: { id: 654 } });
    assert.equal(new URL(created[0].url).searchParams.get('tab'), '654');
    await send({ type: 'open-exporter', ref: '7139012', objType: 'crs', title: 'Ohne Tab', mode: 'new' }, {});
    assert.equal(new URL(created[1].url).searchParams.has('tab'), false);
  } finally { delete globalThis.chrome; }
});

test('Manifest lädt die StudOn-Brücke in jeden StudOn-Tab, vor dem Dialog-Skript', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const studon = manifest.content_scripts.find((entry) => entry.matches.some((m) => m.includes('studon.fau.de')));
  assert.deepEqual(studon.js, ['content/bridge.js', 'content/content.js']);
});

/** Lädt content/content.js auf einer Kursseite und öffnet den Dialog; `course` ist der gespeicherte Kurszustand. */
async function openDialog({ course, notebooks }) {
  const { document, window } = parseHTML('<html><head><title>Inhalt: Implementing Innovation: StudOn</title></head><body><div class="il-page-content-header"><h1>Implementing Innovation</h1></div><div id="il_head_action"><div id="tttt"></div></div></body></html>');
  let root;
  const create = document.createElement.bind(document);
  document.createElement = (...args) => {
    const el = create(...args);
    if (args[0] === 'div') {
      const attach = el.attachShadow.bind(el);
      el.attachShadow = (options) => {
        root = attach(options);
        if (!root.getElementById) root.getElementById = (id) => root.querySelector(`#${id}`);
        return root;
      };
    }
    return el;
  };
  window.top = window;
  // linkedom merkt sich select.value nicht. Wie im Browser: gewählt ist, was gesetzt wurde, sonst die erste Option.
  const chosen = new WeakMap();
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return chosen.get(this) ?? this.querySelector('option')?.getAttribute('value') ?? ''; },
    set(value) { chosen.set(this, value); },
  });
  const context = vm.createContext({
    document, window, URLSearchParams,
    location: new URL('https://www.studon.fau.de/studon/ilias.php?baseClass=ilrepositorygui&ref_id=7139011'),
    setTimeout: () => {}, // nur Einblend-Animation und Textmarkierung
    chrome: {
      runtime: {
        getURL: (path) => `chrome-extension://test/${path}`,
        sendMessage(message, respond) { respond(message.type === 'list-notebooks' ? { ok: true, email: 'student@example.org', notebooks } : { ok: true }); },
      },
      storage: { local: { get(keys, respond) { respond({ 'course:7139011': course }); } } },
    },
  });
  vm.runInContext(await readFile(new URL('../content/content.js', import.meta.url), 'utf8'), context);
  document.querySelector('#s2n-trigger button').click();
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return {
    mode: root.querySelector('.seg[aria-checked="true"]').dataset.mode,
    selected: root.getElementById('nb-existing').value,
  };
}

const REAL = { id: 'nb-real', title: 'Implementing Innovation', emoji: '', sourceCount: 18 };
const OTHER = { id: 'nb-other', title: 'Digital Business Model Strategy', emoji: '', sourceCount: 34 };
const courseState = { refId: '7139011', items: {}, primaryNotebookId: 'nb-test', notebooks: [{ id: 'nb-real', title: 'Implementing Innovation' }, { id: 'nb-test', title: 'Implementing Innovation – Test' }] };

test('Dialog: das zuletzt verwendete Notebook ist vorausgewählt', async () => {
  const state = await openDialog({ course: courseState, notebooks: [OTHER, { id: 'nb-test', title: 'Implementing Innovation – Test', emoji: '', sourceCount: 16 }, REAL] });
  assert.deepEqual(state, { mode: 'existing', selected: 'nb-test' });
});

test('Dialog: ist das zuletzt verwendete Notebook gelöscht, steht das frühere Notebook dieses Kurses da – nicht irgendeines', async () => {
  const state = await openDialog({ course: courseState, notebooks: [OTHER, REAL] });
  assert.deepEqual(state, { mode: 'existing', selected: 'nb-real' });
});

test('Dialog: gibt es kein Notebook dieses Kurses mehr, wird ein neues vorgeschlagen', async () => {
  const state = await openDialog({ course: courseState, notebooks: [OTHER] });
  assert.equal(state.mode, 'new');
});

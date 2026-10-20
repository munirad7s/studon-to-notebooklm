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

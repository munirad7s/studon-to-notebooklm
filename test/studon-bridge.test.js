import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StudOnBridge, StudOnTabError, createStudOnFetch } from '../lib/studon-bridge.js';
import { loadContentBridge } from './helpers/content-bridge.js';

const COURSE = 'https://www.studon.fau.de/studon/ilias.php?baseClass=ilrepositorygui&ref_id=7139011';
const FILE = 'https://www.studon.fau.de/studon/goto.php?target=file_7196122_download';

function bytesOf(n) {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) bytes[i] = (i * 13 + 5) % 256;
  return bytes;
}

/** StudOn, wie es ein Tab mit bestandener Prüfung sieht. */
function studon(routes = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (!route) return new Response('nicht gefunden', { status: 404, headers: { 'Content-Type': 'text/html' } });
    return new Response(route.body, { status: 200, headers: route.headers || { 'Content-Type': 'text/html; charset=utf-8' } });
  };
  fetch.calls = calls;
  return fetch;
}

/**
 * chrome.tabs mit echten Brücken-Skripten: jeder Tab mit `fetch` hat content/bridge.js geladen.
 * `tab.send` lässt sich überschreiben, um Navigation oder geschlossene Tabs nachzustellen.
 */
function fakeTabs(initial = []) {
  const tabs = new Map();
  let nextId = 100;
  const add = (tab) => {
    const full = { url: COURSE, active: false, lastAccessed: 0, ...tab };
    if (full.fetch && !full.send) full.send = loadContentBridge({ fetch: full.fetch, botCheck: !!full.botCheck }).send;
    tabs.set(full.id, full);
    return full;
  };
  initial.forEach(add);
  const api = {
    tabs,
    created: [],
    removed: [],
    onCreate: null,
    async query() { return [...tabs.values()].map(({ id, url, active, lastAccessed, status = 'complete' }) => ({ id, url, active, lastAccessed, status })); },
    async sendMessage(tabId, message) {
      const tab = tabs.get(tabId);
      if (!tab || !tab.send) throw new Error('Could not establish connection. Receiving end does not exist.');
      return tab.send(message);
    },
    async create(props) {
      nextId += 1;
      const tab = add({ id: nextId, url: props.url, active: !!props.active });
      api.created.push({ id: tab.id, ...props });
      if (api.onCreate) api.onCreate(tab);
      return { id: tab.id };
    },
    async remove(tabId) { api.removed.push(tabId); tabs.delete(tabId); },
  };
  return api;
}

function bridgeFor(tabs, extra = {}) {
  return new StudOnBridge({ tabs, openUrl: COURSE, sleep: async () => {}, ...extra });
}

test('Seite wird über den StudOn-Tab geholt, aus dem der Export gestartet wurde', async () => {
  const preferred = studon({ [COURSE]: { body: '<div class="ilCLI">Group allocation</div>' } });
  const other = studon({});
  const tabs = fakeTabs([{ id: 1, fetch: other, active: true }, { id: 2, fetch: preferred }]);
  const bridge = bridgeFor(tabs, { preferredTabId: 2 });

  const res = await bridge.fetch(COURSE);
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.url, COURSE);
  assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('x-fehlt'), null);
  assert.equal(await res.text(), '<div class="ilCLI">Group allocation</div>');
  assert.deepEqual(preferred.calls, [COURSE]);
  assert.deepEqual(other.calls, []);
});

test('HTTP-Fehler von StudOn kommen als Antwort mit ok=false an', async () => {
  const tabs = fakeTabs([{ id: 1, fetch: studon({}) }]);
  const res = await bridgeFor(tabs).fetch(COURSE);
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
});

test('Datei kommt Byte für Byte als Blob mit ihrem Typ an', async () => {
  const original = bytesOf(2_300_000);
  const tabs = fakeTabs([{ id: 1, fetch: studon({ [FILE]: { body: original, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Group allocation.pdf"' } } }) }]);
  const res = await bridgeFor(tabs).fetch(FILE);
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="Group allocation.pdf"');
  const blob = await res.blob();
  assert.equal(blob.type, 'application/pdf');
  assert.equal(blob.size, original.length);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), original);
});

test('arrayBuffer liefert dieselben Bytes wie blob', async () => {
  const original = bytesOf(5000);
  const tabs = fakeTabs([{ id: 1, fetch: studon({ [FILE]: { body: original, headers: { 'Content-Type': 'application/zip' } } }) }]);
  const res = await bridgeFor(tabs).fetch(FILE);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), original);
});

test('body.cancel beendet den Download im Tab, ohne ihn zu lesen', async () => {
  let cancelled = false;
  const stream = () => new ReadableStream({ pull(controller) { controller.enqueue(bytesOf(4096)); }, cancel() { cancelled = true; } });
  const tabs = fakeTabs([{ id: 1, fetch: async () => new Response(stream(), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '272629760' } }) }]);
  const res = await bridgeFor(tabs).fetch(FILE);
  assert.equal(res.headers.get('content-length'), '272629760');
  await res.body.cancel();
  assert.equal(cancelled, true);
});

test('Antwortet der Start-Tab nicht, übernimmt ein anderer StudOn-Tab', async () => {
  const working = studon({ [COURSE]: { body: 'ok' } });
  const tabs = fakeTabs([{ id: 1 }, { id: 2, fetch: working, lastAccessed: 5 }]);
  const res = await bridgeFor(tabs, { preferredTabId: 1 }).fetch(COURSE);
  assert.equal(await res.text(), 'ok');
});

test('Ein Tab, der gerade die Bot-Prüfung zeigt, wird übergangen', async () => {
  const challenged = studon({ [COURSE]: { body: 'falsch' } });
  const passed = studon({ [COURSE]: { body: 'richtig' } });
  const tabs = fakeTabs([{ id: 1, fetch: challenged, botCheck: true, active: true }, { id: 2, fetch: passed }]);
  const res = await bridgeFor(tabs, { preferredTabId: 1 }).fetch(COURSE);
  assert.equal(await res.text(), 'richtig');
  assert.deepEqual(challenged.calls, []);
});

test('Ohne erreichbaren StudOn-Tab öffnet die Brücke einen eigenen im Hintergrund und schließt ihn wieder', async () => {
  const tabs = fakeTabs([{ id: 1, url: 'https://www.studon.fau.de/studon/login.php' }]);
  let pings = 0;
  tabs.onCreate = (tab) => {
    // Der neue Tab lädt erst: zwei Anfragen lang antwortet noch kein Skript.
    const ready = loadContentBridge({ fetch: studon({ [COURSE]: { body: 'aus eigenem Tab' } }) }).send;
    tab.send = async (message) => {
      pings += 1;
      if (pings <= 2) throw new Error('Could not establish connection. Receiving end does not exist.');
      return ready(message);
    };
  };
  const notes = [];
  const bridge = bridgeFor(tabs, { preferredTabId: 1, log: (m) => notes.push(m) });
  const res = await bridge.fetch(COURSE);
  assert.equal(await res.text(), 'aus eigenem Tab');
  assert.equal(tabs.created.length, 1);
  assert.equal(tabs.created[0].url, COURSE);
  assert.equal(tabs.created[0].active, false);

  await bridge.close();
  assert.deepEqual(tabs.removed, [tabs.created[0].id]);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /Hintergrund-Tab/);
  assert.match(notes[1], /geschlossen/);
});

test('Lädt der StudOn-Tab gerade neu, wartet die Brücke auf ihn statt einen eigenen zu öffnen', async () => {
  const tabs = fakeTabs([{ id: 1, status: 'loading' }]);
  const tab = tabs.tabs.get(1);
  const ready = loadContentBridge({ fetch: studon({ [COURSE]: { body: 'nach dem Laden' } }) }).send;
  let asked = 0;
  tab.send = async (message) => {
    asked += 1;
    if (asked <= 3) throw new Error('Could not establish connection. Receiving end does not exist.');
    tab.status = 'complete';
    return ready(message);
  };
  const res = await bridgeFor(tabs, { preferredTabId: 1 }).fetch(COURSE);
  assert.equal(await res.text(), 'nach dem Laden');
  assert.equal(tabs.created.length, 0);
});

test('close lässt Tabs des Nutzers offen', async () => {
  const tabs = fakeTabs([{ id: 1, fetch: studon({ [COURSE]: { body: 'ok' } }) }]);
  const bridge = bridgeFor(tabs, { preferredTabId: 1 });
  await (await bridge.fetch(COURSE)).text();
  await bridge.close();
  assert.deepEqual(tabs.removed, []);
});

test('Navigiert der Tab zwischen Kopf und Inhalt weg, wird die Seite erneut geholt', async () => {
  const site = studon({ [COURSE]: { body: 'vollständige Seite' } });
  const tabs = fakeTabs([{ id: 1, fetch: site }]);
  const bridge = bridgeFor(tabs, { preferredTabId: 1 });
  const res = await bridge.fetch(COURSE);
  // Navigation: das alte Skript ist weg, das neue kennt die offene Antwort nicht.
  tabs.tabs.get(1).send = loadContentBridge({ fetch: site }).send;
  assert.equal(await res.text(), 'vollständige Seite');
  assert.deepEqual(site.calls, [COURSE, COURSE]);
});

test('Wird der Tab mitten im Download geschlossen, läuft der Download über einen anderen Tab neu', async () => {
  const original = bytesOf(2_300_000);
  const route = { [FILE]: { body: original, headers: { 'Content-Type': 'application/pdf' } } };
  const tabs = fakeTabs([{ id: 1, fetch: studon(route) }, { id: 2, fetch: studon(route) }]);
  const first = tabs.tabs.get(1);
  const realSend = first.send;
  let reads = 0;
  first.send = async (message) => {
    if (message.type === 's2n-read') {
      reads += 1;
      if (reads === 2) { tabs.tabs.delete(1); throw new Error('The message port closed before a response was received.'); }
    }
    return realSend(message);
  };
  const res = await bridgeFor(tabs, { preferredTabId: 1 }).fetch(FILE);
  const blob = await res.blob();
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), original);
});

test('Ist kein StudOn-Tab erreichbar und auch der eigene lädt nicht, gibt es eine klare Fehlermeldung', async () => {
  const tabs = fakeTabs([]);
  const bridge = bridgeFor(tabs, { readyAttempts: 3 });
  await assert.rejects(bridge.fetch(COURSE), (err) => {
    assert.ok(err instanceof StudOnTabError);
    assert.match(err.message, /StudOn/);
    return true;
  });
});

test('Ein Abruffehler im Tab (z. B. Netz weg) kommt als Fehler an, nicht als Tab-Problem', async () => {
  const tabs = fakeTabs([{ id: 1, fetch: async () => { throw new TypeError('Failed to fetch'); } }]);
  await assert.rejects(bridgeFor(tabs).fetch(COURSE), (err) => {
    assert.equal(err.name, 'TypeError');
    assert.match(err.message, /Failed to fetch/);
    assert.equal(tabs.created.length, 0);
    return true;
  });
});

test('createStudOnFetch schickt nur StudOn-Adressen über die Brücke', async () => {
  const direct = [];
  const viaBridge = [];
  const fetch = createStudOnFetch({
    bridge: { fetch: async (url) => { viaBridge.push(url); return 'bridge'; } },
    fetch: async (url, init) => { direct.push([url, init]); return 'direct'; },
  });
  assert.equal(await fetch(COURSE, { credentials: 'include' }), 'bridge');
  assert.equal(await fetch('https://www.fau.tv/clip/id/42516', { credentials: 'include' }), 'direct');
  assert.equal(await fetch('https://notebook.google.com/', { method: 'POST' }), 'direct');
  assert.deepEqual(viaBridge, [COURSE]);
  assert.deepEqual(direct, [['https://www.fau.tv/clip/id/42516', { credentials: 'include' }], ['https://notebook.google.com/', { method: 'POST' }]]);
});

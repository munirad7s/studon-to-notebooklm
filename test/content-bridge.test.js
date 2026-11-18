import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentBridge } from './helpers/content-bridge.js';

const PAGE = 'https://www.studon.fau.de/studon/ilias.php?baseClass=ilrepositorygui&ref_id=7139011';

function bytesOf(n) {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) bytes[i] = (i * 31 + 7) % 256;
  return bytes;
}

test('Ping meldet eine geladene StudOn-Seite und erkennt die Bot-Prüfseite', async () => {
  const normal = loadContentBridge({ fetch: async () => new Response('') });
  const pong = await normal.send({ type: 's2n-ping' });
  assert.equal(pong.ok, true);
  assert.equal(pong.botCheck, false);
  assert.equal(typeof pong.protocol, 'number');

  const challenged = loadContentBridge({ fetch: async () => new Response(''), botCheck: true });
  assert.equal((await challenged.send({ type: 's2n-ping' })).botCheck, true);
});

test('Abruf läuft im Tab mit Cookies und liefert Status, Ziel-URL, Kopfzeilen und Text', async () => {
  const calls = [];
  const { send } = loadContentBridge({
    fetch: async (url, init) => {
      calls.push([url, init]);
      const res = new Response('<html><div class="ilCLI">Übung</div></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      Object.defineProperty(res, 'url', { value: `${PAGE}&redirected=1` });
      return res;
    },
  });
  const head = await send({ type: 's2n-fetch', url: PAGE });
  assert.equal(head.ok, true);
  assert.equal(head.status, 200);
  assert.equal(head.url, `${PAGE}&redirected=1`);
  assert.equal(head.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(calls[0][0], PAGE);
  assert.equal(calls[0][1].credentials, 'include');
  assert.equal(calls[0][1].redirect, 'follow');

  const body = await send({ type: 's2n-text', id: head.id });
  assert.equal(body.ok, true);
  assert.equal(body.text, '<html><div class="ilCLI">Übung</div></html>');
});

test('Binärdaten kommen in Base64-Stücken an und ergeben wieder dieselben Bytes', async () => {
  const original = bytesOf(2_600_000);
  const { send } = loadContentBridge({ fetch: async () => new Response(original, { headers: { 'Content-Type': 'application/pdf' } }) });
  const head = await send({ type: 's2n-fetch', url: 'https://www.studon.fau.de/studon/goto.php?target=file_1_download' });
  const parts = [];
  let reads = 0;
  for (;;) {
    const chunk = await send({ type: 's2n-read', id: head.id });
    assert.equal(chunk.ok, true);
    reads += 1;
    parts.push(Buffer.from(chunk.b64, 'base64'));
    if (chunk.done) break;
    assert.ok(reads < 50, 'Lesen endet nicht');
  }
  assert.ok(reads >= 3, `erwartet mehrere Stücke, waren ${reads}`);
  assert.deepEqual(new Uint8Array(Buffer.concat(parts)), original);
  const after = await send({ type: 's2n-read', id: head.id });
  assert.equal(after.ok, false);
  assert.equal(after.gone, true);
});

test('Abbrechen beendet den Download im Tab', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(bytesOf(1000)); }, cancel() { cancelled = true; } });
  const { send } = loadContentBridge({ fetch: async () => new Response(stream, { headers: { 'Content-Type': 'video/mp4' } }) });
  const head = await send({ type: 's2n-fetch', url: 'https://www.studon.fau.de/studon/data/StudOn/video.mp4' });
  assert.equal((await send({ type: 's2n-cancel', id: head.id })).ok, true);
  assert.equal(cancelled, true);
  assert.equal((await send({ type: 's2n-read', id: head.id })).gone, true);
});

test('Fremde Adressen werden nicht abgerufen', async () => {
  let called = false;
  const { send } = loadContentBridge({ fetch: async () => { called = true; return new Response(''); } });
  for (const url of ['https://example.com/', 'https://www.fau.tv/clip/id/1', 'https://studon.fau.de.evil.example/studon/']) {
    const res = await send({ type: 's2n-fetch', url });
    assert.equal(res.ok, false);
  }
  assert.equal(called, false);
});

test('Fehler beim Abruf werden als Antwort gemeldet statt verschluckt', async () => {
  const { send } = loadContentBridge({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  const res = await send({ type: 's2n-fetch', url: PAGE });
  assert.equal(res.ok, false);
  assert.match(res.error, /Failed to fetch/);
  assert.equal(res.name, 'TypeError');
});

test('Nachrichten anderer Art und anderer Erweiterungen bleiben unbeantwortet', async () => {
  const { send } = loadContentBridge({ fetch: async () => new Response('') });
  await assert.rejects(send({ type: 'list-notebooks' }), /Receiving end/);
  await assert.rejects(send({ type: 's2n-ping' }, { id: 'andere-erweiterung' }), /Receiving end/);
});

/**
 * StudOn-Brücke: führt die Abrufe des Export-Tabs hier im StudOn-Tab aus.
 *
 * Seit November 2026 steht der Bot-Schutz Anubis vor StudOn. Sein Durchlass-Cookie ist an
 * Tabs von fau.de gebunden (partitioniert); ein Abruf aus der Erweiterungsseite trägt es
 * nicht und bekommt nur die Prüfseite. Dieser Tab hat die Prüfung im normalen Betrieb
 * bestanden – Abrufe von hier sind Abrufe des eingeloggten Browsers, wie jeder Klick.
 *
 * Protokoll (lib/studon-bridge.js ist die Gegenseite):
 *   s2n-ping              → { ok, protocol, botCheck }
 *   s2n-fetch { url }     → { ok, id, status, statusText, url, redirected, headers }
 *   s2n-text { id }       → { ok, text }
 *   s2n-read { id }       → { ok, done, b64 }   (bis zu CHUNK_BYTES je Aufruf)
 *   s2n-cancel { id }     → { ok }
 */
(function studonBridge() {
  if (window.top !== window) return;

  const PROTOCOL = 1;
  const CHUNK_BYTES = 1024 * 1024;
  const IDLE_MS = 120000;
  const MAX_OPEN = 6;

  const AWAKE_MS = 60000;
  const AWAKE_LOCK = 'studon-to-notebooklm:bridge';

  /** Offene Antworten, deren Inhalt der Export-Tab noch abholt: id → { res, reader, rest, used }. */
  const open = new Map();
  let seq = 0;
  let awake = false;
  let awakeUntil = 0;

  /**
   * Chrome friert Tabs ein, die einige Minuten im Hintergrund liegen (gemessen: drei bis fünf) –
   * mitten im Export bliebe die Antwort dann aus. Ein Tab, der eine Web-Sperre hält, wird nicht eingefroren. Die Sperre gilt
   * nur, solange Abrufe laufen, und endet eine Minute nach dem letzten.
   */
  function keepAwake() {
    awakeUntil = Date.now() + AWAKE_MS;
    if (awake || !navigator.locks) return;
    awake = true;
    const untilIdle = () => new Promise((resolve) => {
      const check = () => {
        if (Date.now() >= awakeUntil) { awake = false; resolve(); } else setTimeout(check, 10000);
      };
      setTimeout(check, 10000);
    });
    navigator.locks.request(AWAKE_LOCK, { mode: 'shared' }, untilIdle).catch(() => { awake = false; });
  }

  function drop(id) {
    const entry = open.get(id);
    if (!entry) return;
    open.delete(id);
    const cancelling = entry.reader ? entry.reader.cancel() : entry.res.body && entry.res.body.cancel();
    if (cancelling && cancelling.catch) cancelling.catch(() => {});
  }

  /** Vergessene Antworten schließen – ohne Timer, die in Hintergrund-Tabs gedrosselt würden. */
  function sweep() {
    const now = Date.now();
    for (const [id, entry] of open) if (now - entry.used > IDLE_MS) drop(id);
    while (open.size >= MAX_OPEN) drop(open.keys().next().value);
  }

  function isStudOn(url) {
    try {
      return new URL(url).origin === location.origin;
    } catch {
      return false;
    }
  }

  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  async function readChunk(entry) {
    entry.reader ||= entry.res.body.getReader();
    const parts = [];
    let size = 0;
    let done = false;
    while (size < CHUNK_BYTES) {
      let value = entry.rest;
      entry.rest = null;
      if (!value) {
        const step = await entry.reader.read();
        if (step.done) { done = true; break; }
        value = step.value;
      }
      // Ein Stück des Streams kann größer sein als eine Nachricht sein soll – den Rest aufheben.
      const room = CHUNK_BYTES - size;
      if (value.length > room) {
        entry.rest = value.subarray(room);
        value = value.subarray(0, room);
      }
      parts.push(value);
      size += value.length;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return { done, bytes };
  }

  const gone = () => ({ ok: false, gone: true, error: 'Antwort nicht mehr vorhanden' });

  async function handle(message) {
    if (message.type === 's2n-ping') {
      return { ok: true, protocol: PROTOCOL, botCheck: !!document.getElementById('anubis_challenge') };
    }
    keepAwake();
    if (message.type === 's2n-fetch') {
      if (!isStudOn(message.url)) return { ok: false, error: 'Nur StudOn-Adressen werden abgerufen' };
      sweep();
      const res = await fetch(message.url, { credentials: 'include', redirect: 'follow' });
      const headers = {};
      res.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });
      seq += 1;
      const id = `r${seq}`;
      open.set(id, { res, reader: null, rest: null, used: Date.now() });
      return { ok: true, id, status: res.status, statusText: res.statusText, url: res.url || message.url, redirected: res.redirected, headers };
    }
    if (message.type === 's2n-cancel') {
      drop(message.id);
      return { ok: true };
    }
    const entry = open.get(message.id);
    if (!entry) return gone();
    entry.used = Date.now();
    if (message.type === 's2n-text') {
      open.delete(message.id);
      return { ok: true, text: await entry.res.text() };
    }
    if (message.type === 's2n-read') {
      const { done, bytes } = await readChunk(entry);
      if (done) open.delete(message.id);
      return { ok: true, done, b64: toBase64(bytes) };
    }
    return { ok: false, error: `Unbekannte Anfrage ${message.type}` };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string' || !message.type.startsWith('s2n-')) return false;
    if (!sender || sender.id !== chrome.runtime.id) return false;
    handle(message).then(sendResponse, (err) => {
      if (message.id) open.delete(message.id);
      sendResponse({ ok: false, error: String((err && err.message) || err), name: (err && err.name) || 'Error' });
    });
    return true;
  });
})();

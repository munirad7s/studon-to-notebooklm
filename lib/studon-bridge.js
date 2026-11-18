/**
 * StudOn-Brücke, Seite des Export-Tabs.
 *
 * StudOn steht hinter dem Bot-Schutz Anubis. Dessen Durchlass-Cookie gilt nur in Tabs von
 * fau.de; ein `fetch` aus der Erweiterungsseite bekommt die Prüfseite statt des Inhalts.
 * Deshalb führt ein StudOn-Tab die Abrufe aus (content/bridge.js) und diese Klasse reicht
 * sie als `fetch`-ähnliche Antwort an Crawler und Exporter weiter.
 *
 * `tabs` ist chrome.tabs (query, sendMessage, create, remove) – injiziert, damit die Brücke
 * in Node gegen das echte Content-Skript getestet werden kann.
 */

import { STUDON_ORIGIN, isStudOnUrl } from './ilias.js';

const TAB_MATCH = `${STUDON_ORIGIN}/*`;
const POLL_MS = 500;

/** Kein StudOn-Tab erreichbar – der Nutzer muss StudOn öffnen bzw. einloggen. */
export class StudOnTabError extends Error {
  constructor(message = 'StudOn ist in keinem Tab erreichbar. Bitte StudOn öffnen, einloggen und warten, bis die Seite geladen ist – dann erneut starten.') {
    super(message);
    this.name = 'StudOnTabError';
  }
}

/** Der Tab hat nicht geantwortet (geschlossen, navigiert, Skript neu geladen) – anderswo wiederholen. */
class TabLostError extends Error {}

const pageTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Was Crawler und Exporter von einer `fetch`-Antwort brauchen – Inhalt wird erst auf Abruf geholt. */
class BridgeResponse {
  constructor(bridge, requestUrl, tabId, head, retries) {
    this.bridge = bridge;
    this.requestUrl = requestUrl;
    this.tabId = tabId;
    this.id = head.id;
    this.retries = retries;
    this.status = head.status;
    this.statusText = head.statusText || '';
    this.ok = head.status >= 200 && head.status < 300;
    this.url = head.url || requestUrl;
    this.redirected = !!head.redirected;
    const headers = head.headers || {};
    this.headers = { get: (name) => headers[String(name).toLowerCase()] ?? null };
    this.body = { cancel: () => this.cancel() };
  }

  async text() {
    try {
      return (await this.bridge.send(this.tabId, { type: 's2n-text', id: this.id })).text;
    } catch (err) {
      return this.again(err, (res) => res.text());
    }
  }

  async blob() {
    try {
      const parts = [];
      for (;;) {
        const chunk = await this.bridge.send(this.tabId, { type: 's2n-read', id: this.id });
        if (chunk.b64) parts.push(base64ToBytes(chunk.b64));
        if (chunk.done) break;
      }
      return new Blob(parts, { type: this.headers.get('content-type') || '' });
    } catch (err) {
      return this.again(err, (res) => res.blob());
    }
  }

  async arrayBuffer() {
    return (await this.blob()).arrayBuffer();
  }

  async cancel() {
    try {
      await this.bridge.send(this.tabId, { type: 's2n-cancel', id: this.id });
    } catch { /* Tab weg: dort läuft ohnehin nichts mehr */ }
  }

  /** Ging der Tab mitten in der Antwort verloren, den Abruf (GET, also wiederholbar) neu stellen. */
  async again(err, consume) {
    if (!(err instanceof TabLostError)) throw err;
    if (this.retries <= 0) throw new StudOnTabError();
    this.bridge.forget(this.tabId);
    return consume(await this.bridge.fetch(this.requestUrl, this.retries - 1));
  }
}

export class StudOnBridge {
  constructor({ tabs, preferredTabId = null, openUrl = `${STUDON_ORIGIN}/studon/`, log = () => {}, sleep, timers = pageTimers, pingTimeoutMs = 2500, watchdogMs = 8000, requestTimeoutMs = 90000, settleAttempts = 16, readyAttempts = 120 }) {
    if (!tabs) throw new Error('StudOnBridge needs tabs');
    this.tabs = tabs;
    this.preferredTabId = preferredTabId;
    this.openUrl = openUrl;
    this.log = log;
    this.timers = timers;
    this.sleep = sleep || ((ms) => new Promise((r) => { timers.setTimeout(r, ms); }));
    this.pingTimeoutMs = pingTimeoutMs;
    this.watchdogMs = watchdogMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.settleAttempts = settleAttempts;
    this.readyAttempts = readyAttempts;
    this.tabId = null;
    this.ownTabId = null;
    this.ownWasReady = false;
    this.finding = null;
  }

  /** GET einer StudOn-Adresse über einen StudOn-Tab. */
  async fetch(url, retries = 2) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const tabId = await this.ensureTab();
      try {
        const head = await this.send(tabId, { type: 's2n-fetch', url: String(url) });
        return new BridgeResponse(this, String(url), tabId, head, retries);
      } catch (err) {
        if (!(err instanceof TabLostError)) throw err;
        this.forget(tabId);
      }
    }
    throw new StudOnTabError();
  }

  async send(tabId, message) {
    const res = await this.guarded(tabId, this.tabs.sendMessage(tabId, message));
    if (!res || res.gone) throw new TabLostError('Antwort im StudOn-Tab nicht mehr vorhanden');
    if (!res.ok) {
      const error = new Error(res.error || 'Abruf im StudOn-Tab fehlgeschlagen');
      error.name = res.name || 'Error';
      throw error;
    }
    return res;
  }

  /**
   * Wartet auf die Antwort eines Tabs und fragt zwischendurch nach einem Lebenszeichen. Ein Tab,
   * den Chrome eingefroren hat, nimmt Nachrichten an und antwortet nie – ohne diese Prüfung hinge
   * der Export bis zur vollen Zeitgrenze. Ein wacher Tab antwortet auf den Ping, auch während
   * sein Abruf noch läuft; dann liegt es an StudOn und die Zeitgrenze gilt.
   */
  guarded(tabId, answer) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let misses = 0;
      let watch = null;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        this.timers.clearTimeout(watch);
        this.timers.clearTimeout(limit);
        fn(value);
      };
      const check = async () => {
        if (settled) return;
        misses = (await this.ping(tabId)) ? 0 : misses + 1;
        if (misses >= 2) settle(reject, new TabLostError('StudOn-Tab antwortet nicht mehr'));
        else if (!settled) watch = this.timers.setTimeout(check, this.watchdogMs);
      };
      watch = this.timers.setTimeout(check, this.watchdogMs);
      const limit = this.timers.setTimeout(() => settle(reject, new Error('Zeitüberschreitung: StudOn antwortet nicht')), this.requestTimeoutMs);
      answer.then((value) => settle(resolve, value), (err) => settle(reject, new TabLostError(err.message)));
    });
  }

  /** Antwort des Brücken-Skripts auf einen Ping – oder null, wenn der Tab nicht (rechtzeitig) antwortet. */
  ping(tabId) {
    return new Promise((resolve) => {
      const giveUp = this.timers.setTimeout(() => resolve(null), this.pingTimeoutMs);
      const done = (pong) => { this.timers.clearTimeout(giveUp); resolve(pong && pong.ok ? pong : null); };
      this.tabs.sendMessage(tabId, { type: 's2n-ping' }).then(done, () => done(null));
    });
  }

  forget(tabId) {
    if (this.tabId === tabId) this.tabId = null;
  }

  async ensureTab() {
    if (this.tabId != null) return this.tabId;
    this.finding ||= this.findTab().finally(() => { this.finding = null; });
    return this.finding;
  }

  /** Geladene StudOn-Seite mit Brücken-Skript, die nicht gerade die Bot-Prüfung zeigt. */
  async usable(tabId) {
    const pong = await this.ping(tabId);
    return !!(pong && !pong.botCheck);
  }

  /** Offene StudOn-Tabs: zuerst der, aus dem der Export gestartet wurde, dann der zuletzt benutzte. */
  async candidates() {
    const rank = (tab) => (tab.id === this.preferredTabId ? Infinity : (tab.active ? 1e15 : 0) + (tab.lastAccessed || 0));
    const list = (await this.tabs.query({ url: TAB_MATCH })).filter((tab) => tab.id !== this.ownTabId);
    return list.sort((a, b) => rank(b) - rank(a));
  }

  async findTab() {
    for (let attempt = 0; attempt <= this.settleAttempts; attempt += 1) {
      const list = await this.candidates();
      for (const tab of list) {
        if (await this.usable(tab.id)) {
          this.tabId = tab.id;
          return tab.id;
        }
      }
      // Ein Tab, der gerade lädt (der Nutzer klickt in StudOn weiter), meldet sich gleich wieder.
      if (!list.some((tab) => tab.status === 'loading')) break;
      await this.sleep(POLL_MS);
    }
    return this.openOwnTab();
  }

  async openOwnTab() {
    if (this.ownTabId != null && this.ownWasReady) await this.close();
    if (this.ownTabId == null) {
      this.log('Kein geladener StudOn-Tab gefunden – öffne StudOn in einem Hintergrund-Tab …');
      const tab = await this.tabs.create({ url: this.openUrl, active: false });
      this.ownTabId = tab.id;
    }
    for (let attempt = 0; attempt < this.readyAttempts; attempt += 1) {
      if (await this.usable(this.ownTabId)) {
        this.ownWasReady = true;
        this.tabId = this.ownTabId;
        return this.tabId;
      }
      await this.sleep(POLL_MS);
    }
    await this.close();
    throw new StudOnTabError();
  }

  /** Schließt den Tab, den die Brücke selbst geöffnet hat – Tabs des Nutzers bleiben offen. */
  async close() {
    const id = this.ownTabId;
    this.ownTabId = null;
    this.ownWasReady = false;
    if (id == null) return;
    this.forget(id);
    try {
      await this.tabs.remove(id);
      this.log('Hintergrund-Tab wieder geschlossen.');
    } catch { /* schon geschlossen */ }
  }
}

/** `fetch` für Crawler und Exporter: StudOn über die Brücke, alles andere (FAU.tv, Google) direkt. */
export function createStudOnFetch({ bridge, fetch }) {
  return (url, init) => (isStudOnUrl(String(url)) ? bridge.fetch(String(url)) : fetch(url, init));
}

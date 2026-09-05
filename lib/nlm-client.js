/**
 * NotebookLM client for the browser (extension page context).
 *
 * Talks to the same internal endpoints the NotebookLM web app uses
 * (batchexecute RPCs + resumable upload). Protocol details: docs/FINDINGS.md.
 * fetch is injected so the client can be unit-tested with a fake.
 */

export const RPC = {
  LIST_NOTEBOOKS: 'wXbhsf',
  GET_NOTEBOOK: 'rLM1Ne',
  CREATE_NOTEBOOK: 'CCqFvf',
  RENAME_NOTEBOOK: 's0tc2d',
  DELETE_NOTEBOOK: 'WWINqb',
  ADD_SOURCE: 'izAoDd',
  ADD_SOURCE_V2: 'ozz5Z',
  ADD_SOURCE_FILE: 'o4cbdc',
  GET_SOURCE: 'hizoJc',
  DELETE_SOURCE: 'tGMBJ',
  RENAME_SOURCE: 'b7Wfje',
  CHECK_FRESHNESS: 'yR9Yof',
  SYNC_DRIVE: 'FLmJqe',
};

export const SOURCE_STATUS = { PROCESSING: 1, READY: 2, ERROR: 3, PREPARING: 5 };

const OPTS = [1, null, null, null, null, null, null, null, null, null, [1]];

export class NotLoggedInError extends Error {
  constructor(msg = 'Nicht bei NotebookLM angemeldet. Bitte notebooklm.google.com in diesem Chrome-Profil öffnen und anmelden.') {
    super(msg);
    this.name = 'NotLoggedInError';
  }
}

export class RpcError extends Error {
  constructor(message, { code = null, detailType = '', detail = null, rpcId = '' } = {}) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.detailType = detailType;
    this.detail = detail;
    this.rpcId = rpcId;
  }
  get isQuota() { return this.code === 8; }
  get isAuth() { return this.code === 16; }
}

export function parseBatchResponse(text) {
  let body = String(text || '');
  if (body.startsWith(")]}'")) body = body.slice(4);
  const chunks = [];
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i += 1; continue; }
    if (/^\d+$/.test(line)) {
      i += 1;
      if (i < lines.length) {
        try { chunks.push(JSON.parse(lines[i])); } catch { /* not JSON */ }
      }
      i += 1;
      continue;
    }
    try { chunks.push(JSON.parse(line)); } catch { /* ignore */ }
    i += 1;
  }
  return chunks;
}

function userMessageFrom(detail, depth = 0) {
  if (depth > 6 || detail == null) return '';
  if (typeof detail === 'string') return detail.length > 3 && /[a-zäöü ]/i.test(detail) ? detail : '';
  if (Array.isArray(detail)) {
    for (const d of detail) {
      const m = userMessageFrom(d, depth + 1);
      if (m) return m;
    }
  }
  return '';
}

export function extractRpcResult(chunks, rpcId) {
  const present = [];
  for (const chunk of chunks) {
    if (!Array.isArray(chunk)) continue;
    for (const item of chunk) {
      if (!Array.isArray(item) || item.length < 3 || item[0] !== 'wrb.fr') continue;
      if (typeof item[1] === 'string') present.push(item[1]);
      if (item[1] !== rpcId) continue;
      const err = item[5];
      if (Array.isArray(err) && err.length && typeof err[0] === 'number') {
        const code = err[0];
        let detailType = '';
        let detail = null;
        if (Array.isArray(err[2])) {
          for (const d of err[2]) {
            if (Array.isArray(d) && d.length) {
              detailType = typeof d[0] === 'string' ? d[0] : '';
              detail = d.length > 1 ? d[1] : null;
              break;
            }
          }
        }
        const names = { 3: 'INVALID_ARGUMENT', 5: 'NOT_FOUND', 7: 'PERMISSION_DENIED', 8: 'RESOURCE_EXHAUSTED', 9: 'FAILED_PRECONDITION', 16: 'UNAUTHENTICATED' };
        let msg = `NotebookLM-Fehler (Code ${code}): ${detailType || names[code] || 'unbekannt'}`;
        if (/UserDisplayableError/.test(detailType)) {
          const um = userMessageFrom(detail);
          if (um) msg = `NotebookLM-Fehler (Code ${code}): ${um}`;
        }
        throw new RpcError(msg, { code, detailType, detail, rpcId });
      }
      const result = item[2];
      if (typeof result === 'string') {
        try { return JSON.parse(result); } catch { return result; }
      }
      return result;
    }
  }
  if (present.length && !present.includes(rpcId)) {
    throw new RpcError(`RPC ${rpcId} fehlt in der Antwort (vorhanden: ${present.join(', ')}) – Google hat die Methode evtl. rotiert.`, { rpcId });
  }
  return null;
}

function firstString(data) {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) {
    for (const d of data) {
      const s = firstString(d);
      if (s) return s;
    }
  }
  return null;
}

/** Quellentypen in den Metadaten (meta[4]). */
export const SOURCE_TYPE = { GOOGLE_DOCS: 1, GOOGLE_OTHER: 2, PDF: 3, PASTED_TEXT: 4, WEB_PAGE: 5, GENERATED_TEXT: 8, YOUTUBE: 9, AUDIO: 10, UPLOADED_FILE: 11, IMAGE: 13, WORD_DOC: 14 };

function urlFrom(v) {
  return Array.isArray(v) && typeof v[0] === 'string' && /^https?:\/\//i.test(v[0]) ? v[0] : null;
}

/**
 * Ein Quellen-Eintrag `[[id], title, meta, [null, status]]` (gleiche Form in rLM1Ne und hizoJc).
 * URL: Webseiten in meta[7][0]; YouTube in meta[5] = [url, videoId, channel] (live beobachtet, 2026-09).
 */
export function parseSourceEntry(src) {
  if (!Array.isArray(src) || src.length < 2) return null;
  const id = Array.isArray(src[0]) ? src[0][0] : src[0];
  if (!id) return null;
  const meta = Array.isArray(src[2]) ? src[2] : [];
  let status = SOURCE_STATUS.READY;
  if (Array.isArray(src[3]) && typeof src[3][1] === 'number') status = src[3][1];
  return {
    id,
    title: typeof src[1] === 'string' ? src[1] : 'Untitled',
    type: typeof meta[4] === 'number' ? meta[4] : null,
    status,
    driveDocId: Array.isArray(meta[0]) ? meta[0][0] : null,
    url: urlFrom(meta[7]) || urlFrom(meta[5]),
  };
}

export function parseSourceList(notebookData) {
  const nb = Array.isArray(notebookData) && Array.isArray(notebookData[0]) ? notebookData[0] : notebookData;
  const sources = [];
  const list = nb && Array.isArray(nb[1]) ? nb[1] : [];
  for (const src of list) {
    const entry = parseSourceEntry(src);
    if (entry) sources.push(entry);
  }
  return { id: nb ? nb[2] : null, title: nb && typeof nb[0] === 'string' ? nb[0] : '', sources };
}

export class NotebookLMClient {
  constructor({ fetch, authuser = 0, hl = 'en', log = () => {}, sleep } = {}) {
    if (!fetch) throw new Error('NotebookLMClient needs fetch');
    this.fetch = fetch;
    this.authuser = Number(authuser) || 0;
    this.hl = hl;
    this.log = log;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.base = 'https://notebooklm.google.com';
    this.at = null;
    this.bl = null;
    this.sid = null;
    this.email = null;
    this.reqid = Math.floor(Math.random() * 90000) + 10000;
    this.urlSourceVersion = null;
  }

  get authQuery() {
    return this.authuser ? `&authuser=${this.authuser}` : '';
  }

  async init() {
    const url = `${this.base}/${this.authuser ? `?authuser=${this.authuser}` : ''}`;
    const res = await this.fetch(url, { credentials: 'include', redirect: 'follow' });
    const finalUrl = res.url || url;
    if (/accounts\.google\.com|ServiceLogin|signin/i.test(finalUrl)) throw new NotLoggedInError();
    const html = await res.text();
    if (!res.ok) throw new Error(`NotebookLM antwortet mit HTTP ${res.status}`);
    try { this.base = new URL(finalUrl).origin; } catch { /* keep */ }
    const pick = (key) => {
      const m = html.match(new RegExp(`"${key}":"([^"]+)"`));
      return m ? m[1] : null;
    };
    this.at = pick('SNlM0e');
    this.bl = pick('cfb2h');
    this.sid = pick('FdrFJe');
    this.email = pick('oPEP7c');
    if (!this.at) {
      const alt = html.match(/[?&"]at=([^&"]+)/);
      this.at = alt ? alt[1] : null;
    }
    if (!this.at) throw new NotLoggedInError('NotebookLM-Seite ohne Sitzungs-Token – bitte anmelden und neu laden.');
    this.log(`NotebookLM verbunden (${this.email || 'Account unbekannt'}, ${this.base})`);
    return { base: this.base, email: this.email };
  }

  buildUrl(rpcId, sourcePath = '/') {
    this.reqid += 100000;
    const q = new URLSearchParams({ rpcids: rpcId, 'source-path': sourcePath, bl: this.bl || '', hl: this.hl, rt: 'c', _reqid: String(this.reqid) });
    if (this.sid) q.set('f.sid', this.sid);
    if (this.authuser) q.set('authuser', String(this.authuser));
    return `${this.base}/_/LabsTailwindUi/data/batchexecute?${q.toString()}`;
  }

  buildBody(rpcId, params) {
    const freq = JSON.stringify([[[rpcId, JSON.stringify(params), null, 'generic']]]);
    return `f.req=${encodeURIComponent(freq)}&at=${encodeURIComponent(this.at || '')}&`;
  }

  async rpc(rpcId, params, sourcePath = '/', { retry = true } = {}) {
    if (!this.at) await this.init();
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-Same-Domain': '1',
    };
    if (this.authuser) headers['x-goog-authuser'] = String(this.authuser);
    let res;
    try {
      res = await this.fetch(this.buildUrl(rpcId, sourcePath), {
        method: 'POST',
        credentials: 'include',
        headers,
        body: this.buildBody(rpcId, params),
      });
    } catch (err) {
      if (retry) { await this.sleep(1500); return this.rpc(rpcId, params, sourcePath, { retry: false }); }
      throw err;
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      if (retry) {
        await this.init();
        return this.rpc(rpcId, params, sourcePath, { retry: false });
      }
      throw new RpcError(`NotebookLM HTTP ${res.status} bei ${rpcId}`, { rpcId, code: res.status === 400 ? 3 : 16 });
    }
    if (res.status === 429 || res.status >= 500) {
      if (retry) { await this.sleep(3000); return this.rpc(rpcId, params, sourcePath, { retry: false }); }
      throw new RpcError(`NotebookLM HTTP ${res.status} bei ${rpcId}`, { rpcId, code: res.status === 429 ? 8 : null });
    }
    try {
      return extractRpcResult(parseBatchResponse(text), rpcId);
    } catch (err) {
      if (err instanceof RpcError && err.isAuth && retry) {
        await this.init();
        return this.rpc(rpcId, params, sourcePath, { retry: false });
      }
      throw err;
    }
  }

  async listNotebooks() {
    const result = await this.rpc(RPC.LIST_NOTEBOOKS, [null, 1, null, [2]]);
    const list = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
    const notebooks = [];
    for (const nb of list) {
      if (!Array.isArray(nb) || nb.length < 3 || !nb[2]) continue;
      const meta = Array.isArray(nb[5]) ? nb[5] : [];
      notebooks.push({
        id: nb[2],
        title: typeof nb[0] === 'string' ? nb[0] : 'Untitled',
        emoji: typeof nb[3] === 'string' ? nb[3] : '',
        sourceCount: Array.isArray(nb[1]) ? nb[1].length : 0,
        owned: meta[0] == null || meta[0] === 1,
        modifiedAt: Array.isArray(meta[5]) && typeof meta[5][0] === 'number' ? new Date(meta[5][0] * 1000) : null,
      });
    }
    return notebooks;
  }

  async createNotebook(title) {
    const result = await this.rpc(RPC.CREATE_NOTEBOOK, [title, null, null, [2], OPTS]);
    const id = Array.isArray(result) ? result[2] : null;
    if (!id) throw new Error('Notebook konnte nicht angelegt werden (keine ID in der Antwort).');
    return { id, title };
  }

  async getNotebook(notebookId) {
    const result = await this.rpc(RPC.GET_NOTEBOOK, [notebookId, null, [2], null, 0], `/notebook/${notebookId}`);
    return parseSourceList(result);
  }

  /** Einzelne Quelle lesen (hizoJc) – liefert u. a. die URL von Web-/YouTube-Quellen. */
  async getSource(sourceId) {
    const result = await this.rpc(RPC.GET_SOURCE, [[sourceId], [2], [2]]);
    const entry = Array.isArray(result) ? parseSourceEntry(result[0]) : null;
    if (!entry) throw new Error(`Quelle ${sourceId} konnte nicht gelesen werden.`);
    return entry;
  }

  async renameNotebook(notebookId, title) {
    await this.rpc(RPC.RENAME_NOTEBOOK, [notebookId, [[null, null, null, [null, title]]]], `/notebook/${notebookId}`);
  }

  parseAddedSources(result) {
    const out = [];
    const list = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
    for (const src of list) {
      if (!Array.isArray(src) || !src.length) continue;
      const id = Array.isArray(src[0]) ? src[0][0] : src[0];
      if (id) out.push({ id, title: typeof src[1] === 'string' ? src[1] : '' });
    }
    return out;
  }

  async addTextSource(notebookId, title, text) {
    const sourceData = [null, [title, text], null, 2, null, null, null, null, null, null, 1];
    const params = [[sourceData], notebookId, [2], OPTS];
    try {
      const result = await this.rpc(RPC.ADD_SOURCE, params, `/notebook/${notebookId}`);
      const added = this.parseAddedSources(result);
      if (added.length) return added[0];
    } catch (err) {
      if (!(err instanceof RpcError) || !(err.code === 3 || err.code === 9)) throw err;
    }
    const found = await this.reconcile(notebookId, (s) => s.title.trim() === title.trim());
    if (found) return found;
    throw new Error(`Textquelle „${title}“ wurde nicht angelegt.`);
  }

  async addUrlSources(notebookId, urls) {
    if (!urls.length) return [];
    const path = `/notebook/${notebookId}`;
    const v1 = () => this.rpc(RPC.ADD_SOURCE, [
      urls.map((url) => (/youtube\.com|youtu\.be/i.test(url)
        ? [null, null, null, null, null, null, null, [url], null, null, 1]
        : [null, null, [url], null, null, null, null, null, null, null, 1])),
      notebookId, [2], OPTS,
    ], path);
    const v2 = () => this.rpc(RPC.ADD_SOURCE_V2, [
      urls.map((url) => [[null, url, 627], [null, null, null, null, null, null, null, null, null, [null, null, 1]], 1]),
    ], path);
    const order = this.urlSourceVersion === 'v2' ? [['v2', v2], ['v1', v1]] : [['v1', v1], ['v2', v2]];
    let lastErr = null;
    for (const [name, fn] of order) {
      try {
        const result = await fn();
        const added = this.parseAddedSources(result);
        if (added.length || result != null) {
          this.urlSourceVersion = name;
          return added;
        }
      } catch (err) {
        lastErr = err;
        if (err instanceof RpcError && (err.code === 3 || err.code === 9)) {
          const found = await this.reconcile(notebookId, (s) => urls.includes(s.url));
          if (found) return [found];
        }
        if (err instanceof RpcError && err.isQuota) throw err;
      }
    }
    if (lastErr) throw lastErr;
    return [];
  }

  async addDriveSource(notebookId, documentId, mimeType, title) {
    const sourceData = [[documentId, mimeType, 1, title], null, null, null, null, null, null, null, null, null, 1];
    const params = [[sourceData], notebookId, [2], OPTS];
    try {
      const result = await this.rpc(RPC.ADD_SOURCE, params, `/notebook/${notebookId}`);
      const added = this.parseAddedSources(result);
      if (added.length) return added[0];
    } catch (err) {
      if (!(err instanceof RpcError) || !(err.code === 3 || err.code === 9)) throw err;
    }
    const found = await this.reconcile(notebookId, (s) => s.driveDocId === documentId);
    if (found) return found;
    throw new Error(`Drive-Quelle „${title}“ wurde nicht angelegt.`);
  }

  async reconcile(notebookId, match, attempts = 3) {
    for (let i = 0; i < attempts; i += 1) {
      if (i) await this.sleep(Math.min(1000 * 2 ** (i - 1), 4000));
      try {
        const nb = await this.getNotebook(notebookId);
        const hit = nb.sources.find(match);
        if (hit) return hit;
      } catch { /* try again */ }
    }
    return null;
  }

  async registerFile(notebookId, filename) {
    const params = [[[filename]], notebookId, [2], OPTS];
    const result = await this.rpc(RPC.ADD_SOURCE_FILE, params, `/notebook/${notebookId}`);
    const sourceId = firstString(result);
    if (!sourceId) throw new Error(`Upload von „${filename}“ konnte nicht registriert werden.`);
    return sourceId;
  }

  async startUpload(notebookId, filename, size, sourceId) {
    const url = `${this.base}/upload/_/?authuser=${this.authuser}`;
    const res = await this.fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-goog-authuser': String(this.authuser),
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(size),
        'x-goog-upload-protocol': 'resumable',
      },
      body: JSON.stringify({ PROJECT_ID: notebookId, SOURCE_NAME: filename, SOURCE_ID: sourceId }),
    });
    if (!res.ok) throw new Error(`Upload-Start fehlgeschlagen (HTTP ${res.status}) für „${filename}“`);
    const uploadUrl = res.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error(`Upload-URL fehlt in der Antwort für „${filename}“`);
    return uploadUrl;
  }

  async uploadBytes(uploadUrl, blob) {
    const res = await this.fetch(uploadUrl, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'x-goog-authuser': String(this.authuser),
        'x-goog-upload-command': 'upload, finalize',
        'x-goog-upload-offset': '0',
      },
      body: blob,
    });
    if (!res.ok) throw new Error(`Upload fehlgeschlagen (HTTP ${res.status})`);
    return true;
  }

  /** Full 3-step resumable upload. Returns { id, title }. */
  async uploadFile(notebookId, filename, blob) {
    const sourceId = await this.registerFile(notebookId, filename);
    const uploadUrl = await this.startUpload(notebookId, filename, blob.size, sourceId);
    await this.uploadBytes(uploadUrl, blob);
    return { id: sourceId, title: filename };
  }

  async deleteSources(sourceIds) {
    if (!sourceIds.length) return;
    await this.rpc(RPC.DELETE_SOURCE, [sourceIds.map((id) => [id]), [2]]);
  }

  async renameSource(notebookId, sourceId, title) {
    await this.rpc(RPC.RENAME_SOURCE, [null, [sourceId], [[[title]]]], `/notebook/${notebookId}`);
  }

  /**
   * Poll until all given source ids are ready (or errored / timed out).
   * Returns map id → { status, title }.
   */
  async waitForSources(notebookId, sourceIds, { timeoutMs = 180000, intervalMs = 4000, onUpdate = () => {} } = {}) {
    const pending = new Set(sourceIds);
    const states = {};
    const started = Date.now();
    while (pending.size && Date.now() - started < timeoutMs) {
      const nb = await this.getNotebook(notebookId);
      for (const s of nb.sources) {
        if (!pending.has(s.id)) continue;
        states[s.id] = { status: s.status, title: s.title, type: s.type };
        if (s.status === SOURCE_STATUS.READY || s.status === SOURCE_STATUS.ERROR) pending.delete(s.id);
      }
      onUpdate({ ...states }, pending.size);
      if (pending.size) await this.sleep(intervalMs);
    }
    for (const id of pending) states[id] = { status: SOURCE_STATUS.PROCESSING, title: '', timedOut: true };
    return states;
  }

  notebookUrl(notebookId) {
    return `${this.base}/notebook/${notebookId}${this.authuser ? `?authuser=${this.authuser}` : ''}`;
  }
}

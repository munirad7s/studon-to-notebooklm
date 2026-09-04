/**
 * Google Drive v3 client for the extension page. Token acquisition is injected
 * (chrome.identity.launchWebAuthFlow lives in the UI layer).
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Office formats that Drive can convert so NotebookLM can read them as Docs/Slides/Sheets. */
export const CONVERSIONS = {
  pptx: 'application/vnd.google-apps.presentation',
  ppt: 'application/vnd.google-apps.presentation',
  odp: 'application/vnd.google-apps.presentation',
  docx: 'application/vnd.google-apps.document',
  doc: 'application/vnd.google-apps.document',
  odt: 'application/vnd.google-apps.document',
  rtf: 'application/vnd.google-apps.document',
  xlsx: 'application/vnd.google-apps.spreadsheet',
  xls: 'application/vnd.google-apps.spreadsheet',
  ods: 'application/vnd.google-apps.spreadsheet',
};

/** MIME types NotebookLM accepts as Drive sources. */
export const NLM_DRIVE_MIMES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.spreadsheet',
  'application/pdf',
]);

export function buildAuthUrl({ clientId, redirectUri, scope = DRIVE_SCOPE, loginHint = '' }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope,
    include_granted_scopes: 'true',
    prompt: 'select_account',
  });
  if (loginHint) q.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

export function parseTokenFromRedirect(url) {
  const hash = String(url || '').split('#')[1] || '';
  const p = new URLSearchParams(hash);
  const token = p.get('access_token');
  if (!token) {
    const err = p.get('error') || new URL(url).searchParams.get('error') || 'kein Token';
    throw new Error(`Google-Anmeldung fehlgeschlagen: ${err}`);
  }
  return { token, expiresAt: Date.now() + (parseInt(p.get('expires_in') || '3600', 10) - 60) * 1000 };
}

export class DriveClient {
  constructor({ fetch, getToken, log = () => {} }) {
    this.fetch = fetch;
    this.getToken = getToken;
    this.log = log;
    this.folderCache = new Map();
  }

  async api(path, { method = 'GET', body, headers = {}, raw = false, retry = true } = {}) {
    const token = await this.getToken();
    const res = await this.fetch(`https://www.googleapis.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...headers },
      body,
    });
    if (res.status === 401 && retry) {
      await this.getToken({ refresh: true });
      return this.api(path, { method, body, headers, raw, retry: false });
    }
    if (res.status === 429 || res.status >= 500) {
      if (retry) {
        await new Promise((r) => setTimeout(r, 2500));
        return this.api(path, { method, body, headers, raw, retry: false });
      }
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch { /* ignore */ }
      throw new Error(`Drive API ${method} ${path.split('?')[0]} → HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return raw ? res : res.json();
  }

  escape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  async findChild(name, parentId, mimeType = null) {
    const parts = [`name = '${this.escape(name)}'`, 'trashed = false', `'${parentId || 'root'}' in parents`];
    if (mimeType) parts.push(`mimeType = '${mimeType}'`);
    const q = new URLSearchParams({ q: parts.join(' and '), fields: 'files(id,name,mimeType,webViewLink)', pageSize: '5', spaces: 'drive' });
    const data = await this.api(`/drive/v3/files?${q.toString()}`);
    return data.files && data.files.length ? data.files[0] : null;
  }

  async ensureFolder(name, parentId = 'root') {
    const key = `${parentId}/${name}`;
    if (this.folderCache.has(key)) return this.folderCache.get(key);
    let folder = await this.findChild(name, parentId, FOLDER_MIME);
    if (!folder) {
      folder = await this.api('/drive/v3/files?fields=id,name,mimeType,webViewLink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      });
    }
    this.folderCache.set(key, folder.id);
    return folder.id;
  }

  async ensureFolderPath(names, rootId = 'root') {
    let parent = rootId;
    for (const name of names.filter(Boolean)) parent = await this.ensureFolder(name, parent);
    return parent;
  }

  /**
   * Upload a blob. Returns { id, name, mimeType, webViewLink }. If convertTo is
   * given, Drive converts the upload into the Google format (pptx → Slides …).
   */
  async uploadFile(name, blob, parentId, { convertTo = null, replaceExisting = true } = {}) {
    const existing = replaceExisting ? await this.findChild(name, parentId) : null;
    const metadata = { name };
    if (!existing) metadata.parents = [parentId];
    if (convertTo) metadata.mimeType = convertTo;
    const boundary = `nlm${Math.random().toString(36).slice(2)}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    const path = existing
      ? `/upload/drive/v3/files/${existing.id}?uploadType=multipart&fields=id,name,mimeType,webViewLink`
      : '/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink';
    return this.api(path, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }
}

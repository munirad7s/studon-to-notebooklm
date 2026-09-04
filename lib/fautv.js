/**
 * FAU.tv (Videoportal der FAU): Transkripte statt Videos.
 *
 * Die Vorlesungsvideos liegen als HLS-Stream (m3u8, signierte URL) vor - fuer
 * NotebookLM zu gross (200 MB pro Datei) und unnoetig, weil fau.tv jeden Clip
 * bereits mit Whisper transkribiert. Das Transkript liefert die Livewire-
 * Komponente "clip-transcript" ueber den Aufruf `getEntries`; dieser Client
 * baut genau diesen Aufruf nach:
 *   1. Clip-Seite laden -> livewireScriptConfig (CSRF, Update-URL) + wire:snapshot
 *   2. POST <uri> { _token, components: [{ snapshot, updates: {}, calls: [{ method: 'getEntries' }] }] }
 *   3. components[0].effects.returns[0] = [{ startSeconds, endSeconds, text }, ...]
 * Verifiziert am 2026-09-04 gegen https://www.fau.tv/clip/id/42516 (225 Segmente, 19 min).
 *
 * Reine Funktionen plus injizierbares `fetch`, damit alles unter `node --test` laeuft.
 */

const CLIP_RE = /^https?:\/\/(?:www\.)?fau\.tv\/(?:clip\/id\/(\d+)|series\/[^/?#]+\/[^/?#]+)(?:[/?#]|$)/i;

export function isFauTvUrl(url) {
  return CLIP_RE.test(String(url || ''));
}

export function clipIdFromUrl(url) {
  const m = String(url || '').match(CLIP_RE);
  return m && m[1] ? m[1] : null;
}

export class TranscriptUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TranscriptUnavailableError';
  }
}

export class FauTvLoginError extends Error {
  constructor() {
    super('fau.tv verlangt eine Anmeldung - bitte in diesem Chrome-Profil bei www.fau.tv einloggen.');
    this.name = 'FauTvLoginError';
  }
}

/**
 * Holt das Transkript eines Clips.
 * @param {string} url  Clip-URL (clip/id/<n> oder series/<serie>/<clip>)
 * @param {{ fetch: typeof fetch }} deps
 * @returns {Promise<{ url: string, clipId: string|null, title: string, segments: object[], durationSeconds: number }>}
 */
export async function fetchTranscript(url, { fetch } = {}) {
  if (!fetch) throw new Error('fetchTranscript needs fetch');

  const res = await fetch(url, { credentials: 'include', redirect: 'follow' });
  const finalUrl = res.url || url;
  if (/sso\.uni-erlangen\.de|idm\.fau\.de|\/login(?:[/?#]|$)|saml/i.test(finalUrl)) throw new FauTvLoginError();
  if (!res.ok) throw new Error(`fau.tv antwortet mit HTTP ${res.status}`);
  const html = await res.text();

  const page = parseClipPage(html, finalUrl);
  if (!page.snapshot) {
    throw new TranscriptUnavailableError('Kein Transkript auf der Clip-Seite (Video ohne Untertitel oder Anmeldung bei fau.tv nötig).');
  }
  if (!page.csrf || !page.updateUrl) {
    throw new TranscriptUnavailableError('Livewire-Konfiguration nicht gefunden - fau.tv hat sein Layout geändert.');
  }

  const body = JSON.stringify({
    _token: page.csrf,
    components: [{ snapshot: page.snapshot, updates: {}, calls: [{ path: '', method: 'getEntries', params: [] }] }],
  });
  const res2 = await fetch(page.updateUrl, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Livewire': '' },
    body,
  });
  if (res2.status === 419) throw new TranscriptUnavailableError('fau.tv lehnt den Aufruf ab (CSRF 419) - Seite neu laden oder neu anmelden.');
  if (!res2.ok) throw new Error(`fau.tv Livewire antwortet mit HTTP ${res2.status}`);

  const json = await res2.json();
  const segments = extractSegments(json);
  if (!segments.length) throw new TranscriptUnavailableError('Transkript ist leer.');

  const last = segments[segments.length - 1];
  return {
    url: finalUrl,
    clipId: clipIdFromUrl(url) || clipIdFromUrl(finalUrl),
    title: page.title,
    segments,
    durationSeconds: Number(last.endSeconds) || Number(last.startSeconds) || 0,
  };
}

/** Liest CSRF-Token, Livewire-Update-URL, Komponenten-Snapshot und Titel aus dem Seiten-HTML. */
export function parseClipPage(html, pageUrl = 'https://www.fau.tv/') {
  const text = String(html || '');

  let cfg = null;
  const cfgMatch = text.match(/livewireScriptConfig\s*=\s*(\{[\s\S]*?\})\s*(?:;|<\/script>)/);
  if (cfgMatch) {
    try { cfg = JSON.parse(cfgMatch[1]); } catch { cfg = null; }
  }

  const csrf = (cfg && cfg.csrf) || metaContent(text, 'name', 'csrf-token');
  let updateUrl = null;
  if (cfg && cfg.uri) {
    try { updateUrl = new URL(cfg.uri, pageUrl).toString(); } catch { updateUrl = null; }
  }

  let snapshot = null;
  for (const m of text.matchAll(/wire:snapshot="([^"]*)"/g)) {
    const decoded = decodeEntities(m[1]);
    if (decoded.includes('clip-transcript')) { snapshot = decoded; break; }
  }

  const title = cleanTitle(metaContent(text, 'property', 'og:title') || (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || pageUrl);
  return { csrf, updateUrl, snapshot, title };
}

/** `components[0].effects.returns[0]` -> Segmentliste; tolerant gegen leichte Formabweichungen. */
export function extractSegments(json) {
  const comp = json && Array.isArray(json.components) ? json.components[0] : null;
  const returns = comp && comp.effects && Array.isArray(comp.effects.returns) ? comp.effects.returns : [];
  let list = returns.find((r) => Array.isArray(r) && r.length && typeof r[0] === 'object') || [];
  if (!list.length && Array.isArray(json)) list = json;
  return list
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .map((s) => ({ startSeconds: Number(s.startSeconds) || 0, endSeconds: Number(s.endSeconds) || 0, text: s.text.trim() }));
}

/**
 * Markdown fuer NotebookLM: Absaetze von ~60 Sekunden bzw. ~90 Woertern mit
 * Zeitmarke, damit Zitate im Notebook auf die Stelle im Video zeigen.
 */
export function transcriptToMarkdown({ title, url, segments, durationSeconds = 0 }) {
  const lines = [
    `# Transkript – ${title}`,
    '',
    `- **Quelle:** ${url}`,
    `- **Dauer:** ${formatDuration(durationSeconds)} · ${segments.length} Segmente`,
    '- **Hinweis:** automatisch erzeugte Untertitel (Whisper, fau.tv) – Ungenauigkeiten möglich',
    '',
  ];

  let para = [];
  let paraStart = 0;
  let paraWords = 0;
  let prevEnd = null;
  const flush = () => {
    if (!para.length) return;
    lines.push(`**[${formatTimestamp(paraStart)}]** ${para.join(' ')}`, '');
    para = [];
    paraWords = 0;
  };
  for (const s of segments) {
    const t = String(s.text || '').trim();
    if (!t) continue;
    const start = Number(s.startSeconds) || 0;
    // Eine Sprechpause (Luecke zwischen den Segmenten) ist ein natuerlicher Absatz.
    if (para.length && prevEnd != null && start - prevEnd >= 2.5) flush();
    if (!para.length) paraStart = start;
    para.push(t);
    paraWords += t.split(/\s+/).length;
    prevEnd = Number(s.endSeconds) || start;
    if (prevEnd - paraStart >= 60 || paraWords >= 90) flush();
  }
  flush();
  return `${lines.join('\n').trim()}\n`;
}

export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

function metaContent(html, attrName, value) {
  const tagRe = new RegExp(`<meta\\b[^>]*\\b${attrName}=["']${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = html.match(tagRe);
  if (!tag) return null;
  const content = tag[0].match(/\bcontent=["']([^"']*)["']/i);
  return content ? decodeEntities(content[1]) : null;
}

function cleanTitle(raw) {
  return decodeEntities(String(raw || ''))
    .replace(/\s*\[ID:\s*\d+\]\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

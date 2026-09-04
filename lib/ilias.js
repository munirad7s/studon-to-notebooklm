/**
 * Pure helpers for StudOn (ILIAS 9) URLs, object types and names.
 * No DOM, no chrome.* — usable in Node tests and in the extension.
 */

export const STUDON_ORIGIN = 'https://www.studon.fau.de';
export const STUDON_APP = `${STUDON_ORIGIN}/studon`;

export const TYPE_LABELS = {
  crs: 'Kurs', fold: 'Ordner', grp: 'Gruppe', cat: 'Kategorie', root: 'Magazin',
  itgr: 'Objektgruppe', sess: 'Sitzung', file: 'Datei', exc: 'Übung', lm: 'Lernmodul',
  htlm: 'HTML-Lernmodul', copa: 'Inhaltsseite', wiki: 'Wiki', frm: 'Forum',
  mcst: 'Mediacast', webr: 'Weblink', glo: 'Glossar', tst: 'Test', svy: 'Umfrage',
  dcl: 'Datensammlung', bibl: 'Literaturliste', book: 'Buchungspool', prtf: 'Portfolio',
  blog: 'Blog', poll: 'Abstimmung', chtr: 'Chat', sahs: 'SCORM-Modul', lso: 'Lernsequenz',
  qpl: 'Fragenpool', spl: 'Fragenpool', mep: 'Medienpool', crsr: 'Kursreferenz',
  catr: 'Kategoriereferenz', grpr: 'Gruppenreferenz', exam: 'Prüfung', cmix: 'cmi5-Objekt',
  lti: 'LTI-Objekt', feed: 'Feed', xxco: 'Plugin-Objekt', iass: 'Bewertung', usr: 'Benutzer',
};

/** Repository objects that list further objects and are crawled recursively. */
export const CONTAINER_TYPES = new Set(['crs', 'fold', 'grp', 'sess', 'cat', 'root']);

/** Objects we open to extract content (files, pages, links). */
export const CONTENT_TYPES = new Set(['file', 'exc', 'lm', 'htlm', 'copa', 'wiki', 'frm', 'mcst', 'webr', 'glo', 'blog']);

/** Objects that are listed but never opened. */
export const SKIPPED_TYPES = new Set(['tst', 'svy', 'dcl', 'bibl', 'book', 'prtf', 'poll', 'chtr', 'qpl', 'spl', 'mep', 'crsr', 'catr', 'grpr', 'exam', 'cmix', 'lti', 'feed', 'xxco', 'iass', 'usr', 'itgr', 'sahs', 'lso']);

const GOTO_PATH = /\/go\/([a-z0-9]+)\/(\d+)(?:[/_?#]|$)/i;
const GOTO_QUERY = /goto(?:_[a-z0-9]+)?\.php\?(?:[^#]*&)?target=([a-z0-9]+)_(\d+)/i;
const GOTO_STATIC = /goto_[a-z0-9]+_([a-z0-9]+)_(\d+)\.html/i;
const REF_ID = /[?&]ref_id=(\d+)/i;

const BASECLASS_TYPES = [
  [/ilLMPresentationGUI/i, 'lm'],
  [/ilHTLMPresentationGUI/i, 'htlm'],
  [/ilExerciseHandlerGUI/i, 'exc'],
  [/ilwikihandlergui/i, 'wiki'],
  [/ilGlossaryPresentationGUI/i, 'glo'],
  [/ilobjforumgui/i, 'frm'],
  [/ilLinkResourceHandlerGUI/i, 'webr'],
  [/ilMediaCastHandlerGUI|ilobjmediacastgui/i, 'mcst'],
  [/ilobjcontentpagegui/i, 'copa'],
  [/ilobjsessiongui/i, 'sess'],
  [/ilobjfoldergui/i, 'fold'],
  [/ilobjcoursegui/i, 'crs'],
  [/ilobjgroupgui/i, 'grp'],
  [/ilobjfilegui/i, 'file'],
  [/ilSAHSPresentationGUI/i, 'sahs'],
  [/ilObjLearningSequenceGUI/i, 'lso'],
];

/**
 * Extract { type, refId } from any StudOn link. type may be null when only a
 * ref_id is present (e.g. ilias.php?baseClass=ilrepositorygui&ref_id=123).
 */
export function parseRepoLink(href) {
  if (!href || typeof href !== 'string') return null;
  const h = href.replace(/&amp;/g, '&');
  let m = h.match(GOTO_PATH) || h.match(GOTO_QUERY) || h.match(GOTO_STATIC);
  if (m) return { type: m[1].toLowerCase(), refId: m[2] };
  m = h.match(REF_ID);
  if (m) {
    let type = null;
    for (const [re, t] of BASECLASS_TYPES) {
      if (re.test(h)) { type = t; break; }
    }
    return { type, refId: m[1] };
  }
  return null;
}

const DOWNLOAD_CMDS = /[?&]cmd=(downloadFile|download|sendfile|sendFile|deliverFile|downloadItem|downloadFeedbackFile|downloadGlobalFeedbackFile|downloadSolutionFile|downloadAssFile|downloadAssignmentFile|getFile|downloadInstructionFile|downloadMob|getMob|downloadItems)(?:&|$)/i;
const DOWNLOAD_EXCLUDE = /cmd=(downloadCertificate|downloadExportFile|downloadSubmissions|downloadAll|downloadExcel|downloadCSV|downloadResultsFile|downloadTutorialFile)/i;
const FOLDER_ZIP = /baseClass=ilrepositorygui&(?:[^#]*&)?cmd=download&ref_id=\d+/i;
const FILE_TARGET = /target=file_(\d+)_download/i;
const DATA_FILE = /\/data\/[a-z0-9_-]+\/(?!.*\.(?:css|js|svg|png|gif|ico|jpe?g|webp)(?:$|\?)).+/i;

/** True if the URL delivers a binary/file directly (not a repository object page). */
export function isDownloadLink(href) {
  if (!href) return false;
  const h = href.replace(/&amp;/g, '&');
  if (/^(javascript:|mailto:|#)/i.test(h)) return false;
  if (DOWNLOAD_EXCLUDE.test(h)) return false;
  if (FILE_TARGET.test(h)) return true;
  if (FOLDER_ZIP.test(h)) return false;
  if (DOWNLOAD_CMDS.test(h)) return true;
  if (/il_wac_token=/i.test(h) && DATA_FILE.test(h)) return true;
  return false;
}

export function fileDownloadUrl(refId) {
  return `${STUDON_APP}/goto.php?target=file_${refId}_download`;
}

export function repoUrl(refId) {
  return `${STUDON_APP}/ilias.php?baseClass=ilrepositorygui&ref_id=${refId}`;
}

export function gotoUrl(type, refId) {
  return `${STUDON_APP}/go/${type}/${refId}`;
}

export function infoUrl(refId) {
  return `${STUDON_APP}/ilias.php?baseClass=ilrepositorygui&cmd=infoScreen&ref_id=${refId}`;
}

export function lmPrintSelectionUrl(refId) {
  return `${STUDON_APP}/ilias.php?baseClass=ilLMPresentationGUI&ref_id=${refId}&cmd=showPrintViewSelection`;
}

export function lmTocUrl(refId) {
  return `${STUDON_APP}/ilias.php?baseClass=ilLMPresentationGUI&ref_id=${refId}&cmd=showTableOfContents`;
}

export function lmPageUrl(refId, objId) {
  return `${STUDON_APP}/ilias.php?baseClass=ilLMPresentationGUI&ref_id=${refId}&obj_id=${objId}`;
}

export function wikiAllPagesUrl(refId) {
  return `${STUDON_APP}/ilias.php?baseClass=ilwikihandlergui&ref_id=${refId}&cmdClass=ilobjwikigui&cmd=allPages`;
}

/**
 * Resolve an href. ILIAS emits app-root-relative links ("ilias.php?…", "./data/…")
 * on every page, including pages reached via /go/<type>/<ref> redirects, so
 * relative links are resolved against the StudOn app root, not the page URL.
 */
export function absolutize(href, base = `${STUDON_APP}/`) {
  if (!href) return null;
  const h = href.replace(/&amp;/g, '&').trim();
  const isRelative = !/^(https?:)?\/\//i.test(h) && !h.startsWith('/') && !/^[a-z]+:/i.test(h);
  try {
    return new URL(h, isRelative ? `${STUDON_APP}/` : base).href;
  } catch {
    return null;
  }
}

/** Stable identity of a download link (same file linked from several LM pages). */
export function downloadKey(href) {
  const h = String(href || '').replace(/&amp;/g, '&');
  const fileTarget = h.match(/target=file_(\d+)_download/i);
  if (fileTarget) return `file:${fileTarget[1]}`;
  const fileId = h.match(/[?&]file_id=(\d+)/i);
  const refId = h.match(/[?&]ref_id=(\d+)/i);
  if (fileId) return `lmfile:${refId ? refId[1] : ''}:${fileId[1]}`;
  return `url:${h.replace(/[?&]obj_id=\d+/i, '')}`;
}

export function isStudOnUrl(href) {
  try {
    return new URL(href).origin === STUDON_ORIGIN;
  } catch {
    return false;
  }
}

/** Type from ILIAS icon markup: src ".../icon_fold.svg" or alt "Ordner". */
export function typeFromIcon(src = '', alt = '') {
  const m = (src || '').match(/icon_([a-z0-9]+)\.(?:svg|png|gif)/i);
  if (m) return m[1].toLowerCase();
  const a = (alt || '').trim().toLowerCase();
  for (const [type, label] of Object.entries(TYPE_LABELS)) {
    if (a === label.toLowerCase()) return type;
  }
  return null;
}

export function typeLabel(type) {
  return TYPE_LABELS[type] || (type ? type.toUpperCase() : 'Objekt');
}

/** Windows/ZIP/Drive safe name; keeps umlauts. */
export function sanitizeName(text, max = 150) {
  let name = String(text ?? '')
    .replace(/\s*\((?:\d+[.,])?\d+\s*(?:Bytes?|[KMGT]i?B)\)\s*$/i, '')
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (name.length > max) name = name.slice(0, max).trim();
  return name || 'untitled';
}

export function extensionOf(name) {
  const m = String(name || '').match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1].toLowerCase() : '';
}

export function filenameFromContentDisposition(cd) {
  if (!cd) return null;
  let m = cd.match(/filename\*=(?:UTF-8|utf-8)''([^;]+)/);
  if (m) {
    try { return decodeURIComponent(m[1].trim()); } catch { return m[1].trim(); }
  }
  m = cd.match(/filename="([^"]+)"/) || cd.match(/filename=([^;]+)/);
  return m ? m[1].trim() : null;
}

/** Parse "2,5 MB" / "450 KB" / "12 Bytes" into bytes (approximate). */
export function parseSize(text) {
  if (!text) return null;
  const m = String(text).match(/([\d.,]+)\s*(Bytes?|B|KB|MB|GB|TB|KiB|MiB|GiB)\b/i);
  if (!m) return null;
  const raw = m[1];
  const normalized = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  const num = parseFloat(normalized);
  if (isNaN(num)) return null;
  const unit = m[2].toUpperCase();
  const mult = unit.startsWith('K') ? 1024 : unit.startsWith('M') ? 1024 ** 2 : unit.startsWith('G') ? 1024 ** 3 : unit.startsWith('T') ? 1024 ** 4 : 1;
  return Math.round(num * mult);
}

export function formatBytes(n) {
  if (n == null || isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function cleanText(s) {
  return String(s ?? '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function isYouTubeUrl(url) {
  return /(?:^|\.|\/\/)(youtube\.com|youtu\.be)\//i.test(String(url || ''));
}

/** Detect whether a fetched StudOn page is actually the SSO login (session expired). */
export function looksLikeLogin(finalUrl, html) {
  if (/sso\.uni-erlangen\.de|\/login\.php|cmd=showLoginPage|saml\.php/i.test(finalUrl || '')) return true;
  return /name="password"[^>]*type="password"|id="usr_password"|Bitte geben Sie Ihren Benutzernamen/i.test(html || '');
}

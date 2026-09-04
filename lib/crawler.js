/**
 * StudOn (ILIAS 9) course crawler.
 *
 * Produces a tree of nodes describing everything inside a course/folder:
 *   container → children (folders, groups, sessions)
 *   file      → { downloadUrl, filename, sizeBytes }
 *   text      → { content (markdown), filename }
 *   link      → { href, isYouTube }
 *   skipped   → { reason }
 *
 * Dependencies are injected so the crawler runs in the extension (window.fetch,
 * DOMParser) and in Node tests (fake fetch, linkedom).
 */

import * as ilias from './ilias.js';
import { elementToMarkdown, wordCount } from './text.js';
import * as fautv from './fautv.js';

export class SessionExpiredError extends Error {
  constructor(url) {
    super(`StudOn-Session abgelaufen (Login-Seite erhalten bei ${url}). Bitte in StudOn neu einloggen.`);
    this.name = 'SessionExpiredError';
  }
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} bei ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Eine Seite, die gar keine ist: Antwort ist z. B. ein MP4 (HTML-Lernmodul mit Video als Startdatei). */
export class NotHtmlError extends Error {
  constructor(url, contentType, size) {
    super(`Keine HTML-Seite, sondern ${contentType || 'unbekannter Inhalt'}${size ? ` (${Math.round(size / 1048576)} MB)` : ''}: ${url}`);
    this.name = 'NotHtmlError';
    this.url = url;
    this.contentType = contentType || '';
    this.size = size || 0;
  }
}

export const DEFAULT_SCAN_OPTIONS = {
  files: true,
  learningModules: true,
  pages: true,
  wiki: true,
  glossary: true,
  exercises: true,
  sessions: true,
  forum: false,
  media: true,
  weblinks: true,
  fauTv: true,
  courseInfo: true,
  maxDepth: 15,
  maxPagesPerObject: 400,
  delayMs: 120,
  concurrency: 3,
};

const MAIN_SELECTORS = ['#il_center_col', '#mainscrolldiv', '.il-layout-page-content', '#mainspacekeeper', 'main', 'body'];
const PAGE_CONTENT_SELECTORS = ['.ilc_page_cont_PageContainer', '.il-copg-page', '#il_center_col', '#mainscrolldiv'];

let nodeCounter = 0;

function makeNode(kind, props) {
  nodeCounter += 1;
  return { id: `n${nodeCounter}`, kind, children: [], errors: [], ...props };
}

function textOf(el) {
  return ilias.cleanText(el ? el.textContent : '');
}

function pickFirst(doc, selectors) {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return doc.body || doc.documentElement;
}

function pageTitle(doc) {
  const h = doc.querySelector('.il-page-content-header, h1.ilHeader, .ilHeader h1, #il_center_col h1, h1');
  let title = textOf(h);
  if (!title) {
    title = textOf(doc.querySelector('title')).replace(/\s*[:\-–]\s*StudOn\s*$/i, '').replace(/^Inhalt\s*[:\-–]\s*/i, '');
  }
  return title;
}

function sectionOf(el) {
  let p = el.parentElement;
  let hops = 0;
  while (p && hops < 12) {
    const cls = p.getAttribute('class') || '';
    if (/\bil-item-group\b/.test(cls)) {
      for (const c of p.children) if (/^H[1-6]$/i.test(c.tagName)) return textOf(c);
      const h = p.querySelector('h1,h2,h3,h4');
      return textOf(h);
    }
    if (/\bilContainerBlock\b/.test(cls) || /\bil-container-block\b/.test(cls)) {
      const h = p.querySelector('.ilContainerBlockHeader h2, .ilContainerBlockHeader h3, .ilContainerBlockHeader .ilHeader, .ilContainerBlockHeader, h2, h3');
      return textOf(h).replace(/\s+/g, ' ');
    }
    if (/\bpanel\b/.test(cls) && !/\bpanel-body\b/.test(cls)) {
      const h = p.querySelector('.panel-heading .panel-title, .panel-heading h2, .panel-heading h3, .il-panel-title');
      if (h) return textOf(h);
    }
    p = p.parentElement;
    hops += 1;
  }
  return '';
}

function propertiesOf(el) {
  const props = {};
  const names = el.querySelectorAll('.il-item-property-name');
  for (const nameEl of names) {
    const valueEl = nameEl.nextElementSibling;
    const name = textOf(nameEl);
    const value = textOf(valueEl && valueEl.classList && valueEl.classList.contains('il-item-property-value') ? valueEl : null);
    if (!value) continue;
    props[name || `_${Object.keys(props).length}`] = value;
  }
  // Klassische Listenzeilen (die Mehrheit der StudOn-Kurse): "pdf · 1,2 MB · 12. Mär 2026, 10:05"
  for (const propEl of el.querySelectorAll('.il_ItemProperty')) {
    const value = textOf(propEl).replace(/\u00a0/g, ' ').trim();
    if (value) props[`_${Object.keys(props).length}`] = value;
  }
  let sizeText = null;
  let modified = null;
  let ext = null;
  for (const [name, value] of Object.entries(props)) {
    if (!sizeText && ilias.parseSize(value) != null && /(B|Bytes)\b/i.test(value)) sizeText = value;
    if (!modified && /zeit|änderung|datum|date|modified|geändert|created|erstellt/i.test(name)) modified = value;
    // "12. Mär 2026, 10:05" - \w kennt keine Umlaute, daher [^\s\d.]+ fuer den Monatsnamen.
    if (!modified && /^\d{1,2}\.\s*[^\s\d.]+\.?\s*\d{4}|^(Heute|Gestern),|^\d{1,2}\.\d{1,2}\.\d{4}/i.test(value)) modified = value;
    if (!ext && /^[a-z0-9]{2,5}$/i.test(value) && !/^\d+$/.test(value)) ext = value.toLowerCase();
  }
  return { props, sizeText, modified, ext };
}

/** Links, die wie Objekte aussehen, aber keine sind (News-Block, Kalender, Aktionen). */
function isNonObjectLink(href) {
  return /ilNewsForContextBlockGUI|cmdClass=ilNews|ilCalendar|cmd=(addToDesk|removeFromDesk|showComments|showNotes|infoScreen)\b/i.test(String(href || '').replace(/&amp;/g, '&'));
}

/** Collect repository items from a container page (ILIAS 9 UI items + legacy fallbacks). */
export function collectItems(doc) {
  const items = [];
  const byRef = new Map();
  const push = (el, a) => {
    const rawHref = a.getAttribute('href') || '';
    if (isNonObjectLink(rawHref)) return;
    const href = ilias.absolutize(rawHref);
    if (!href) return;
    const parsed = ilias.parseRepoLink(href);
    if (!parsed) return;
    const icon = el.querySelector('img.icon, img[src*="icon_"], img.ilListItemIcon');
    const type = parsed.type || ilias.typeFromIcon(icon && icon.getAttribute('src'), icon && icon.getAttribute('alt'));
    // Eine Legacy-Zeile besteht aus Outer (mit Icon) und Inner (ohne) - beide zeigen auf
    // dieselbe ref_id. Der erste Treffer gewinnt, ein spaeter erkannter Typ wird nachgetragen.
    const existing = byRef.get(parsed.refId);
    if (existing) {
      if (!existing.type && type) existing.type = type;
      return;
    }
    const { props, sizeText, modified, ext } = propertiesOf(el);
    const item = {
      title: textOf(a) || `Objekt ${parsed.refId}`,
      href,
      type,
      refId: parsed.refId,
      section: sectionOf(el),
      description: textOf(el.querySelector('.il-item-description, .il_Description, .caption:not(.card-title)')),
      sizeText,
      sizeBytes: ilias.parseSize(sizeText),
      modified,
      ext,
      props,
    };
    byRef.set(parsed.refId, item);
    items.push(item);
  };

  // Eine Seite kann alle drei Darstellungen mischen: ILIAS-9-Items, klassische
  // Listenzeilen und Kacheln (Objektgruppe in Kachelansicht, z. B. "Lecture Content"
  // im HCI-Kurs). Deshalb werden alle drei immer gelesen; `seen` verhindert Dubletten.
  for (const el of doc.querySelectorAll('.il-std-item')) {
    const a = el.querySelector('.il-item-title a[href]') || el.querySelector('h4 a[href], h3 a[href]');
    if (a) push(el, a);
  }
  for (const el of doc.querySelectorAll('.il_ContainerListItem, .ilContainerListItemOuter')) {
    const a = el.querySelector('.il_ContainerItemTitle a[href], a.il_ContainerItemTitle[href], h4 a[href], a[href]');
    if (a) push(el, a);
  }
  for (const el of doc.querySelectorAll('.il-card')) {
    // Erst der Titel-Link: der Bild-Link davor hat keinen Text und kaeme sonst zuerst.
    const a = el.querySelector('.card-title a[href]') || el.querySelector('a[href*="/go/"], a[href*="ref_id="]');
    if (a) push(el, a);
  }
  return items;
}

/** Collect download links (files attached to pages, exercises, sessions, LM pages). */
export function collectDownloadLinks(root, baseUrl) {
  const links = [];
  const seen = new Set();
  for (const a of root.querySelectorAll('a[href]')) {
    const href = ilias.absolutize(a.getAttribute('href'), baseUrl);
    if (!href || !ilias.isDownloadLink(href)) continue;
    const key = ilias.downloadKey(href);
    if (seen.has(key)) continue;
    seen.add(key);
    let name = textOf(a);
    const fileParam = href.match(/[?&]file=([^&]+)/);
    if ((!name || name.length < 3) && fileParam) {
      try { name = decodeURIComponent(fileParam[1]); } catch { name = fileParam[1]; }
    }
    if (!name) name = 'Datei';
    links.push({ href, title: ilias.sanitizeName(name) });
  }
  return links;
}

export function collectMediaLinks(root, baseUrl) {
  const media = [];
  const seen = new Set();
  const add = (href, title) => {
    const abs = ilias.absolutize(href, baseUrl);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);
    media.push({ href: abs, title: ilias.sanitizeName(title || abs.split('/').pop().split('?')[0] || 'Medium') });
  };
  for (const el of root.querySelectorAll('video source[src], audio source[src], video[src], audio[src]')) {
    add(el.getAttribute('src'), el.getAttribute('title') || el.getAttribute('data-title'));
  }
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (/\.(mp4|m4a|mp3|webm|wav|ogg|mov|avi|mpe?g)(\?|$)/i.test(href)) add(href, textOf(a));
  }
  return media;
}

export function collectExternalLinks(root, baseUrl) {
  const out = [];
  const seen = new Set();
  const add = (href, title) => {
    const abs = ilias.absolutize(href, baseUrl);
    if (!abs || seen.has(abs) || !/^https?:/i.test(abs)) return;
    if (ilias.isStudOnUrl(abs)) return;
    seen.add(abs);
    out.push({ href: abs, title: ilias.cleanText(title) || abs, isYouTube: ilias.isYouTubeUrl(abs), isFauTv: fautv.isFauTvUrl(abs) });
  };
  for (const a of root.querySelectorAll('a[href]')) add(a.getAttribute('href'), textOf(a));
  for (const f of root.querySelectorAll('iframe[src]')) {
    const src = f.getAttribute('src') || '';
    const yt = src.match(/youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,})/);
    if (yt) add(`https://www.youtube.com/watch?v=${yt[1]}`, f.getAttribute('title') || 'YouTube-Video');
  }
  return out;
}

export class StudOnCrawler {
  constructor({ fetch, DOMParser, log = () => {}, onProgress = () => {}, options = {} }) {
    if (!fetch || !DOMParser) throw new Error('StudOnCrawler needs fetch and DOMParser');
    this.fetch = fetch;
    this.DOMParser = DOMParser;
    this.log = log;
    this.onProgress = onProgress;
    this.options = { ...DEFAULT_SCAN_OPTIONS, ...options };
    this.visited = new Set();
    this.stats = { requests: 0, containers: 0, files: 0, texts: 0, links: 0, skipped: 0, errors: 0 };
    this._lastRequest = 0;
    this.aborted = false;
  }

  abort() {
    this.aborted = true;
  }

  progress(message) {
    this.log(message);
    this.onProgress({ phase: 'scan', message, stats: { ...this.stats } });
  }

  async throttle() {
    const wait = this._lastRequest + this.options.delayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this._lastRequest = Date.now();
  }

  async fetchPage(url, attempt = 0) {
    if (this.aborted) throw new Error('Scan abgebrochen');
    await this.throttle();
    this.stats.requests += 1;
    let res;
    try {
      res = await this.fetch(url, { credentials: 'include', redirect: 'follow' });
    } catch (err) {
      if (attempt < 2) return this.fetchPage(url, attempt + 1);
      throw err;
    }
    const finalUrl = res.url || url;
    const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
    if (contentType && !/html|xml|text\/plain|json/i.test(contentType)) {
      // Kein HTML (z. B. 260-MB-MP4 hinter einem HTML-Lernmodul): Body verwerfen statt als Text lesen.
      const size = Number(res.headers.get('content-length')) || 0;
      try { if (res.body && res.body.cancel) await res.body.cancel(); } catch { /* egal */ }
      throw new NotHtmlError(finalUrl, contentType.split(';')[0].trim(), size);
    }
    const html = await res.text();
    if (ilias.looksLikeLogin(finalUrl, html)) throw new SessionExpiredError(url);
    if (!res.ok) {
      if (res.status >= 500 && attempt < 2) return this.fetchPage(url, attempt + 1);
      throw new HttpError(res.status, url);
    }
    const doc = new this.DOMParser().parseFromString(html, 'text/html');
    return { doc, html, finalUrl };
  }

  /** Entry point. start = { refId, type?, title?, url? } */
  async scan(start) {
    nodeCounter = 0;
    const type = start.type && start.type !== 'unknown' ? start.type : null;
    const root = makeNode('container', {
      type: type || 'crs',
      refId: String(start.refId),
      title: start.title || '',
      url: start.url || ilias.repoUrl(start.refId),
      path: [],
      section: '',
    });
    this.visited.add(`${root.type}:${root.refId}`);

    if (type && !ilias.CONTAINER_TYPES.has(type) && type !== 'itgr') {
      // Started inside a learning module / exercise / wiki …: scan just that object.
      await this.scanObject(root, type, 0);
      root.kind = 'container';
      return root;
    }

    await this.scanContainer(root, 0);
    if (this.options.courseInfo) await this.addInfoText(root);
    root.title = root.title || `StudOn ${root.refId}`;
    this.progress(`Scan fertig: ${this.stats.containers} Container, ${this.stats.files} Dateien, ${this.stats.texts} Texte, ${this.stats.links} Links, ${this.stats.skipped} übersprungen`);
    return root;
  }

  childPath(node) {
    return [...node.path, node.title].filter(Boolean);
  }

  async scanContainer(node, depth) {
    this.stats.containers += 1;
    let doc;
    try {
      ({ doc } = await this.fetchPage(ilias.repoUrl(node.refId)));
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;
      node.errors.push(err.message);
      this.stats.errors += 1;
      this.log(`Fehler bei ${node.title || node.refId}: ${err.message}`);
      return;
    }
    if (!node.title) node.title = pageTitle(doc) || `StudOn ${node.refId}`;
    const items = collectItems(doc);
    this.progress(`${'  '.repeat(depth)}${ilias.typeLabel(node.type)} „${node.title}“: ${items.length} Einträge`);
    const path = this.childPath(node);

    for (const item of items) {
      if (this.aborted) return;
      const type = item.type;
      const key = `${type || '?'}:${item.refId}`;
      if (item.refId === node.refId) continue;
      if (this.visited.has(key)) continue;
      this.visited.add(key);

      const base = {
        type,
        refId: item.refId,
        title: item.title,
        url: item.href,
        path,
        section: item.section,
        description: item.description,
        modified: item.modified,
      };

      if (type === 'itgr') continue; // item groups are rendered inline on the parent page
      if (type === 'crsr' || type === 'catr' || type === 'grpr') {
        node.children.push(makeNode('skipped', { ...base, reason: 'Referenz auf anderes Objekt' }));
        this.stats.skipped += 1;
        continue;
      }

      if (type && ilias.CONTAINER_TYPES.has(type)) {
        if (type === 'sess' && !this.options.sessions) {
          node.children.push(makeNode('skipped', { ...base, reason: 'Sitzungen deaktiviert' }));
          this.stats.skipped += 1;
          continue;
        }
        const child = makeNode('container', base);
        node.children.push(child);
        if (depth + 1 <= this.options.maxDepth) await this.scanContainer(child, depth + 1);
        continue;
      }

      if (type === 'file') {
        if (!this.options.files) continue;
        node.children.push(makeNode('file', {
          ...base,
          downloadUrl: ilias.fileDownloadUrl(item.refId),
          filename: fileNameFromItem(item),
          sizeText: item.sizeText,
          sizeBytes: item.sizeBytes,
        }));
        this.stats.files += 1;
        continue;
      }

      if (!type) {
        // Unknown type: probe as container; ILIAS renders items for any listing object.
        const child = makeNode('container', { ...base, type: 'unknown' });
        node.children.push(child);
        if (depth + 1 <= this.options.maxDepth) await this.scanContainer(child, depth + 1);
        if (!child.children.length) {
          child.kind = 'skipped';
          child.reason = 'Unbekannter Objekttyp ohne Inhalte';
          this.stats.skipped += 1;
        }
        continue;
      }

      const child = makeNode('container', base);
      node.children.push(child);
      await this.scanObject(child, type, depth + 1);
    }
  }

  /** Scan a non-container repository object into child nodes (texts/files/links). */
  async scanObject(node, type, depth) {
    const o = this.options;
    const enabled = {
      exc: o.exercises, lm: o.learningModules, htlm: o.learningModules, copa: o.pages, blog: o.pages,
      wiki: o.wiki, glo: o.glossary, frm: o.forum, mcst: o.media, webr: o.weblinks, xvid: o.media,
    };
    if (ilias.SKIPPED_TYPES.has(type) || !(type in enabled)) {
      node.kind = 'skipped';
      node.reason = `${ilias.typeLabel(type)} wird nicht exportiert`;
      this.stats.skipped += 1;
      return;
    }
    if (!enabled[type]) {
      node.kind = 'skipped';
      node.reason = `${ilias.typeLabel(type)} in den Optionen deaktiviert`;
      this.stats.skipped += 1;
      return;
    }
    this.progress(`${'  '.repeat(depth)}${ilias.typeLabel(type)} „${node.title}“ …`);
    try {
      switch (type) {
        case 'exc': await this.scanExercise(node); break;
        case 'lm': await this.scanLearningModule(node); break;
        case 'htlm': await this.scanHtmlModule(node); break;
        case 'copa':
        case 'blog': await this.scanContentPage(node); break;
        case 'wiki': await this.scanWiki(node); break;
        case 'glo': await this.scanGlossary(node); break;
        case 'frm': await this.scanForum(node); break;
        case 'mcst': await this.scanMediacast(node); break;
        case 'webr': await this.scanWeblinks(node); break;
        case 'xvid': await this.scanInteractiveVideo(node); break;
        default: break;
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;
      node.errors.push(err.message);
      this.stats.errors += 1;
      this.log(`Fehler bei ${ilias.typeLabel(type)} „${node.title}“: ${err.message}`);
    }
  }

  addText(node, title, content, extra = {}) {
    const md = String(content || '').trim();
    if (wordCount(md) < 3) return null;
    const child = makeNode('text', {
      type: node.type,
      refId: node.refId,
      title,
      url: node.url,
      path: this.childPath(node),
      section: node.section,
      filename: `${ilias.sanitizeName(title, 120)}.md`,
      content: md,
      words: wordCount(md),
      ...extra,
    });
    node.children.push(child);
    this.stats.texts += 1;
    return child;
  }

  addFiles(node, links, subPath = null) {
    for (const link of links) {
      const key = `dl:${ilias.downloadKey(link.href)}`;
      if (this.visited.has(key)) continue;
      this.visited.add(key);
      node.children.push(makeNode('file', {
        type: 'file',
        refId: null,
        title: link.title,
        url: link.href,
        path: subPath || this.childPath(node),
        section: node.section,
        downloadUrl: link.href,
        filename: link.title,
        sizeBytes: link.sizeBytes || null,
        sizeText: link.sizeText || (link.sizeBytes ? ilias.formatBytes(link.sizeBytes) : null),
        contentType: link.contentType || null,
      }));
      this.stats.files += 1;
    }
  }

  /** YouTube-Links werden Quellen-Links, fau.tv-Clips werden zu Transkript-Texten. */
  async addVideoLinks(node, links) {
    if (this.options.weblinks) this.addLinks(node, links.filter((l) => l.isYouTube));
    await this.addFauTvTranscripts(node, links.filter((l) => l.isFauTv));
  }

  /**
   * fau.tv: statt des Videos (HLS, zu gross fuer NotebookLM) das Whisper-Transkript
   * des Portals holen und als Text anlegen. Ein Clip wird nur einmal geholt, auch
   * wenn mehrere Seiten darauf verlinken.
   */
  async addFauTvTranscripts(node, links) {
    if (!this.options.fauTv) return;
    for (const link of links) {
      if (this.aborted) return;
      const clipId = fautv.clipIdFromUrl(link.href) || link.href;
      const key = `fautv:${clipId}`;
      if (this.visited.has(key)) continue;
      this.visited.add(key);
      this.onProgress({ phase: 'scan', message: `fau.tv-Transkript ${clipId} …`, stats: { ...this.stats } });
      try {
        await this.throttle();
        this.stats.requests += 2;
        const transcript = await fautv.fetchTranscript(link.href, { fetch: this.fetch });
        const md = fautv.transcriptToMarkdown(transcript);
        this.addText(node, `Transkript – ${transcript.title}`, md, {
          video: transcript.url,
          durationSeconds: transcript.durationSeconds,
          segments: transcript.segments.length,
        });
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err;
        this.stats.errors += 1;
        node.errors.push(`fau.tv ${clipId}: ${err.message}`);
        this.log(`fau.tv-Transkript ${clipId} fehlgeschlagen: ${err.message}`);
      }
    }
  }

  addLinks(node, links) {
    for (const link of links) {
      const key = `link:${link.href}`;
      if (this.visited.has(key)) continue;
      this.visited.add(key);
      node.children.push(makeNode('link', {
        type: 'webr',
        refId: null,
        title: link.title,
        url: link.href,
        href: link.href,
        isYouTube: !!link.isYouTube,
        path: this.childPath(node),
        section: node.section,
      }));
      this.stats.links += 1;
    }
  }

  async addInfoText(root) {
    try {
      const { doc } = await this.fetchPage(ilias.infoUrl(root.refId));
      const main = pickFirst(doc, MAIN_SELECTORS);
      const md = elementToMarkdown(main);
      if (wordCount(md) > 20) {
        const child = this.addText(root, `Info – ${root.title}`, `# ${root.title} – Info\n\n${md}`);
        if (child) root.children.unshift(root.children.pop());
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;
      this.log(`Info-Seite nicht lesbar: ${err.message}`);
    }
  }

  async scanExercise(node) {
    const { doc, finalUrl } = await this.fetchPage(ilias.gotoUrl('exc', node.refId));
    const main = pickFirst(doc, MAIN_SELECTORS);
    this.addText(node, `Übung – ${node.title}`, `# Übung: ${node.title}\n\n${elementToMarkdown(main)}`);
    this.addFiles(node, collectDownloadLinks(main, finalUrl));
    await this.addVideoLinks(node, collectExternalLinks(main, finalUrl));
  }

  async lmPageIds(refId) {
    const { doc, html } = await this.fetchPage(ilias.lmPrintSelectionUrl(refId));
    const pages = [];
    const seen = new Set();
    for (const input of doc.querySelectorAll('input[name="sel_obj_id[]"]')) {
      const id = input.getAttribute('value');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      let label = '';
      const forLabel = input.getAttribute('id') ? doc.querySelector(`label[for="${input.getAttribute('id')}"]`) : null;
      if (forLabel) label = textOf(forLabel);
      if (!label && input.parentElement) label = textOf(input.parentElement);
      pages.push({ objId: id, title: label });
    }
    if (!pages.length) {
      for (const m of html.matchAll(/name="sel_obj_id\[\]"\s+value="(\d+)"/g)) {
        if (!seen.has(m[1])) { seen.add(m[1]); pages.push({ objId: m[1], title: '' }); }
      }
    }
    if (!pages.length) {
      const toc = await this.fetchPage(ilias.lmTocUrl(refId));
      for (const a of toc.doc.querySelectorAll('a[href*="obj_id="]')) {
        const m = (a.getAttribute('href') || '').match(/obj_id=(\d+)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        pages.push({ objId: m[1], title: textOf(a) });
      }
    }
    return pages.slice(0, this.options.maxPagesPerObject);
  }

  async scanLearningModule(node) {
    const pages = await this.lmPageIds(node.refId);
    if (!pages.length) {
      // No print view: at least grab the start page.
      const { doc, finalUrl } = await this.fetchPage(ilias.gotoUrl('lm', node.refId));
      const content = pickFirst(doc, PAGE_CONTENT_SELECTORS);
      this.addText(node, `Lernmodul – ${node.title}`, `# ${node.title}\n\n${elementToMarkdown(content)}`);
      this.addFiles(node, collectDownloadLinks(doc.body || doc, finalUrl));
      return;
    }
    const sections = [`# ${node.title}`];
    const files = [];
    const links = [];
    let i = 0;
    for (const page of pages) {
      if (this.aborted) return;
      i += 1;
      this.onProgress({ phase: 'scan', message: `Lernmodul „${node.title}“: Seite ${i}/${pages.length}`, stats: { ...this.stats } });
      try {
        const { doc, finalUrl } = await this.fetchPage(ilias.lmPageUrl(node.refId, page.objId));
        const content = pickFirst(doc, PAGE_CONTENT_SELECTORS);
        const titleEl = doc.querySelector('.ilc_page_title_PageTitle, .il-page-content-header, #il_center_col h1, h1.ilHeader');
        const title = textOf(titleEl) || page.title || `Seite ${i}`;
        const md = elementToMarkdown(content);
        if (wordCount(md) > 0) sections.push(`## ${title}\n\n${md}`);
        for (const f of collectDownloadLinks(doc.body || doc, finalUrl)) files.push(f);
        if (this.options.media) for (const m of collectMediaLinks(doc.body || doc, finalUrl)) files.push(m);
        for (const l of collectExternalLinks(content, finalUrl)) if (l.isYouTube || l.isFauTv) links.push(l);
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err;
        node.errors.push(`Seite ${page.objId}: ${err.message}`);
      }
    }
    this.addText(node, `Lernmodul – ${node.title}`, sections.join('\n\n---\n\n'), { pages: pages.length });
    this.addFiles(node, files);
    await this.addVideoLinks(node, links);
  }

  /**
   * HTML-Lernmodul. Haeufiger Sonderfall (z. B. Vorlesungsaufzeichnungen): die
   * "Startdatei" ist direkt ein MP4 - dann ist das Objekt eine Datei, keine Seite.
   */
  async scanHtmlModule(node) {
    let page;
    try {
      page = await this.fetchPage(ilias.htlmUrl(node.refId));
    } catch (err) {
      if (err instanceof NotHtmlError) { this.addDirectFile(node, err); return; }
      throw err;
    }
    const { doc, finalUrl } = page;
    let content = pickFirst(doc, MAIN_SELECTORS);
    const frame = doc.querySelector('iframe[src], frame[src]');
    if (frame) {
      const src = ilias.absolutize(frame.getAttribute('src'), finalUrl);
      if (src && ilias.isStudOnUrl(src)) {
        try {
          const inner = await this.fetchPage(src);
          content = inner.doc.body || inner.doc;
        } catch (err) {
          if (err instanceof SessionExpiredError) throw err;
          if (err instanceof NotHtmlError) { this.addDirectFile(node, err); return; }
          node.errors.push(err.message);
        }
      }
    }
    this.addText(node, `HTML-Lernmodul – ${node.title}`, `# ${node.title}\n\n${elementToMarkdown(content)}`);
    this.addFiles(node, collectDownloadLinks(content, finalUrl));
    if (this.options.media) this.addFiles(node, collectMediaLinks(content, finalUrl));
  }

  /** Objekt, dessen Aufruf direkt eine Datei liefert (Video, PDF, ...): als Datei mit Groesse anlegen. */
  addDirectFile(node, { url, contentType, size }) {
    const fromUrl = filenameFromUrl(url);
    const ext = ilias.extensionOf(fromUrl) || ilias.extensionOf(node.title) || extensionFromMime(contentType);
    let title = ilias.sanitizeName(fromUrl || node.title);
    if (!ilias.extensionOf(title) && ext) title = `${title}.${ext}`;
    this.addFiles(node, [{ href: url, title, sizeBytes: size || null, contentType: contentType || null }]);
  }

  async scanContentPage(node) {
    const { doc, finalUrl } = await this.fetchPage(ilias.gotoUrl(node.type === 'blog' ? 'blog' : 'copa', node.refId));
    const content = pickFirst(doc, PAGE_CONTENT_SELECTORS);
    this.addText(node, `${ilias.typeLabel(node.type)} – ${node.title}`, `# ${node.title}\n\n${elementToMarkdown(content)}`);
    this.addFiles(node, collectDownloadLinks(doc.body || doc, finalUrl));
    if (this.options.media) this.addFiles(node, collectMediaLinks(content, finalUrl));
    await this.addVideoLinks(node, collectExternalLinks(content, finalUrl));
  }

  async scanWiki(node) {
    const sections = [`# Wiki: ${node.title}`];
    const files = [];
    let pages = [];
    try {
      const { doc, finalUrl } = await this.fetchPage(ilias.wikiAllPagesUrl(node.refId));
      const main = pickFirst(doc, MAIN_SELECTORS);
      const seen = new Set();
      for (const a of main.querySelectorAll('a[href]')) {
        const href = ilias.absolutize(a.getAttribute('href'), finalUrl);
        if (!href || seen.has(href)) continue;
        if (!/cmd=viewPage|wpg_id=|[?&]page=|\/go\/wiki\/\d+_/i.test(href)) continue;
        seen.add(href);
        pages.push({ href, title: textOf(a) });
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;
      node.errors.push(`Seitenliste: ${err.message}`);
    }
    if (!pages.length) pages = [{ href: ilias.gotoUrl('wiki', node.refId), title: node.title }];
    pages = pages.slice(0, this.options.maxPagesPerObject);
    let i = 0;
    for (const page of pages) {
      if (this.aborted) return;
      i += 1;
      this.onProgress({ phase: 'scan', message: `Wiki „${node.title}“: Seite ${i}/${pages.length}`, stats: { ...this.stats } });
      try {
        const { doc, finalUrl } = await this.fetchPage(page.href);
        const content = pickFirst(doc, PAGE_CONTENT_SELECTORS);
        const md = elementToMarkdown(content);
        if (wordCount(md) > 0) sections.push(`## ${page.title || textOf(doc.querySelector('h1')) || `Seite ${i}`}\n\n${md}`);
        for (const f of collectDownloadLinks(content, finalUrl)) files.push(f);
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err;
        node.errors.push(`${page.title}: ${err.message}`);
      }
    }
    this.addText(node, `Wiki – ${node.title}`, sections.join('\n\n---\n\n'), { pages: pages.length });
    this.addFiles(node, files);
  }

  async scanGlossary(node) {
    const { doc } = await this.fetchPage(ilias.gotoUrl('glo', node.refId));
    const main = pickFirst(doc, MAIN_SELECTORS);
    this.addText(node, `Glossar – ${node.title}`, `# Glossar: ${node.title}\n\n${elementToMarkdown(main)}`);
  }

  async scanForum(node) {
    const { doc, finalUrl } = await this.fetchPage(ilias.gotoUrl('frm', node.refId));
    const main = pickFirst(doc, MAIN_SELECTORS);
    const threads = [];
    const seen = new Set();
    for (const a of main.querySelectorAll('a[href*="thr_pk="]')) {
      const href = ilias.absolutize(a.getAttribute('href'), finalUrl);
      const m = href && href.match(/thr_pk=(\d+)/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      threads.push({ href, title: textOf(a) });
    }
    const sections = [`# Forum: ${node.title}`];
    let i = 0;
    for (const t of threads.slice(0, Math.min(150, this.options.maxPagesPerObject))) {
      if (this.aborted) return;
      i += 1;
      this.onProgress({ phase: 'scan', message: `Forum „${node.title}“: Thema ${i}/${threads.length}`, stats: { ...this.stats } });
      try {
        const page = await this.fetchPage(t.href);
        const posts = page.doc.querySelectorAll('.ilFrmPostContent, .ilFrmPostBody, .il-forum-post, .ilFrmPost');
        const parts = [];
        for (const p of posts) {
          const md = elementToMarkdown(p);
          if (wordCount(md) > 0) parts.push(md);
        }
        if (!parts.length) {
          const md = elementToMarkdown(pickFirst(page.doc, MAIN_SELECTORS));
          if (wordCount(md) > 0) parts.push(md);
        }
        sections.push(`## ${t.title || `Thema ${i}`}\n\n${parts.join('\n\n---\n\n')}`);
      } catch (err) {
        if (err instanceof SessionExpiredError) throw err;
        node.errors.push(`${t.title}: ${err.message}`);
      }
    }
    this.addText(node, `Forum – ${node.title}`, sections.join('\n\n'), { pages: threads.length });
  }

  async scanMediacast(node) {
    const { doc, finalUrl } = await this.fetchPage(ilias.gotoUrl('mcst', node.refId));
    const main = pickFirst(doc, MAIN_SELECTORS);
    const files = [...collectDownloadLinks(main, finalUrl), ...collectMediaLinks(main, finalUrl)];
    this.addFiles(node, files);
    await this.addVideoLinks(node, collectExternalLinks(main, finalUrl));
    const md = elementToMarkdown(main);
    if (wordCount(md) > 30) this.addText(node, `Mediacast – ${node.title}`, `# Mediacast: ${node.title}\n\n${md}`);
  }

  /**
   * Interaktives Video (Plugin xvid): ein <video> mit lokalem MP4 (URL traegt ein
   * zeitlich begrenztes il_wac_token) oder eine fau.tv-Einbettung, plus Beschreibung.
   */
  async scanInteractiveVideo(node) {
    const { doc, finalUrl } = await this.fetchPage(ilias.pluginUrl(node.refId));
    const main = pickFirst(doc, MAIN_SELECTORS);
    const media = collectMediaLinks(doc.body || doc, finalUrl).map((m) => ({
      ...m,
      title: ilias.extensionOf(m.title) ? m.title : `${ilias.sanitizeName(node.title)}.mp4`,
    }));
    this.addFiles(node, media);
    await this.addVideoLinks(node, collectExternalLinks(main, finalUrl));
    const md = elementToMarkdown(main);
    if (wordCount(md) > 15) this.addText(node, `Video – ${node.title}`, `# ${node.title}\n\n${md}`);
    if (!media.length && !node.children.length) node.errors.push('Kein Video auf der Seite gefunden');
  }

  async scanWeblinks(node) {
    const { doc, finalUrl } = await this.fetchPage(ilias.gotoUrl('webr', node.refId));
    const main = pickFirst(doc, MAIN_SELECTORS);
    const links = collectExternalLinks(main, finalUrl);
    const unresolved = [];
    for (const a of main.querySelectorAll('a[href*="cmd=callLink"], a[href*="link_id="]')) {
      const title = textOf(a);
      if (title && !links.some((l) => l.title === title)) unresolved.push(title);
    }
    this.addLinks(node, links.filter((l) => !l.isFauTv));
    await this.addFauTvTranscripts(node, links.filter((l) => l.isFauTv));
    if (unresolved.length) {
      node.errors.push(`Weblinks ohne sichtbare Ziel-URL: ${unresolved.join(', ')}`);
    }
  }
}

/** Flatten a tree into a list of nodes (depth-first, pre-order). */
export function flatten(root) {
  const out = [];
  const walk = (n) => {
    out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return out;
}

/** Build a markdown overview of the tree (used as a NotebookLM source and README). */
export function treeToOverview(root, { courseUrl } = {}) {
  const lines = [`# ${root.title} – Kursstruktur (StudOn)`, ''];
  if (courseUrl) lines.push(`Quelle: ${courseUrl}`, '');
  const walk = (n, depth) => {
    for (const c of n.children || []) {
      const indent = '  '.repeat(depth);
      if (c.kind === 'container') {
        lines.push(`${indent}- 📁 ${c.title}${c.section ? ` (Abschnitt: ${c.section})` : ''}`);
        walk(c, depth + 1);
      } else if (c.kind === 'file') {
        lines.push(`${indent}- 📄 ${c.filename || c.title}${c.sizeText ? ` (${c.sizeText})` : ''}${c.modified ? ` – ${c.modified}` : ''}`);
      } else if (c.kind === 'text') {
        lines.push(`${indent}- 📝 ${c.title}${c.pages ? ` (${c.pages} Seiten)` : ''}`);
      } else if (c.kind === 'link') {
        lines.push(`${indent}- 🔗 ${c.title}: ${c.href}`);
      } else if (c.kind === 'skipped') {
        lines.push(`${indent}- ⏭ ${c.title} (${c.reason})`);
      }
    }
  };
  walk(root, 0);
  return lines.join('\n');
}

function filenameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

const MIME_EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'application/pdf': 'pdf' };

function extensionFromMime(contentType) {
  return MIME_EXT[String(contentType || '').toLowerCase()] || '';
}

/** Dateiname aus Listeneintrag: Titel plus Endung aus den Eigenschaften, falls der Titel keine hat. */
function fileNameFromItem(item) {
  const name = ilias.sanitizeName(item.title);
  if (ilias.extensionOf(name) || !item.ext) return name;
  return `${name}.${item.ext}`;
}

/**
 * H5P-Inhalte auf StudOn-Seiten (Plugin „H5P“ von sr.solutions).
 *
 * StudOn liefert H5P-Bloecke als leeres Iframe plus Hinweis „Bitte warten Sie, bis der
 * Inhalt geladen werden konnte.“; der eigentliche Inhalt steht base64-kodiert im Aufruf
 *   il.H5P.initContent('<element-id>', <content-id>, `<integration>`, `<parameter>`, …)
 * Hier wird er ohne Rendering gelesen und als HTML an die Stelle des Iframes gesetzt,
 * damit Text, Selbsttests (mit Loesungen) und Videos im normalen Seitenexport landen.
 * Rein: kein chrome.*, funktioniert mit Browser-DOM und linkedom.
 */

const INIT_CALL = 'il.H5P.initContent(';

/** Pfad der H5P-Dateien relativ zu ilias.php: data/<client>/h5p/content/<content-id>/<path>. */
const CONTENT_DIR = 'data/StudOn/h5p/content';

function decodeBase64Utf8(value) {
  const bin = atob(String(value || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Liest die Argumente eines JS-Aufrufs ab `pos` (nur Literale: Strings, Zahlen, null). */
function readArguments(src, pos) {
  const args = [];
  let i = pos;
  while (i < src.length) {
    while (/[\s,]/.test(src[i])) i += 1;
    const ch = src[i];
    if (ch === ')' || ch === undefined) break;
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\') { value += src[j + 1]; j += 2; continue; }
        value += src[j];
        j += 1;
      }
      args.push(value);
      i = j + 1;
    } else {
      const m = src.slice(i).match(/^[^,)\s]+/);
      if (!m) break;
      args.push(m[0] === 'null' ? null : m[0]);
      i += m[0].length;
    }
  }
  return args;
}

/** Alle H5P-Inhalte einer Seite: [{ elementId, contentId, library, title, params }]. */
export function extractH5PContents(html) {
  const out = [];
  const src = String(html || '');
  let at = src.indexOf(INIT_CALL);
  while (at !== -1) {
    const [elementId, contentId, integration64, params64] = readArguments(src, at + INIT_CALL.length);
    try {
      const integration = JSON.parse(decodeBase64Utf8(integration64));
      const params = JSON.parse(decodeBase64Utf8(params64));
      out.push({
        elementId: elementId || '',
        contentId: String(contentId || ''),
        library: integration.library || '',
        title: (integration.metadata && integration.metadata.title) || integration.title || '',
        params,
      });
    } catch {
      // Unlesbarer Block: Platzhalter bleibt stehen, Rest der Seite zaehlt.
    }
    at = src.indexOf(INIT_CALL, at + INIT_CALL.length);
  }
  return out;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Text aus einem HTML-Schnipsel; Entities werden aufgeloest, weil escapeHtml danach wieder kodiert. */
function stripTags(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_TITLES = /^(untitled|unbenannt|video|audio|image|bild|text|column|spalte)\b/i;

function mediaTitle(meta, fallback, path) {
  const ext = (String(path).split('?')[0].match(/\.([a-z0-9]{2,4})$/i) || [])[1] || 'mp4';
  const base = meta && meta.title && !GENERIC_TITLES.test(meta.title) ? meta.title : fallback;
  return `${String(base || 'H5P-Video').replace(/\.[a-z0-9]{2,4}$/i, '')}.${ext}`;
}

/** Ersetzt *Antwort* bzw. *Antwort/Alternative:Tipp* durch die fett gesetzte Loesung. */
function fillBlanks(text) {
  return String(text || '').replace(/\*([^*]+)\*/g, (_, inner) => {
    const answers = inner.split(':')[0].split('/').map((a) => a.trim()).filter(Boolean);
    return answers.length ? `<strong>${escapeHtml(answers.join(' / '))}</strong>` : '';
  });
}

function heading(label) {
  return `<p><strong>${escapeHtml(label)}</strong></p>`;
}

class Renderer {
  constructor({ contentId, baseUrl, title }) {
    this.contentId = contentId;
    this.baseUrl = baseUrl;
    this.title = title;
  }

  fileUrl(path) {
    if (!path) return '';
    if (/^https?:/i.test(path)) return path;
    try {
      return new URL(`${CONTENT_DIR}/${this.contentId}/${path.replace(/^\/+/, '')}`, this.baseUrl).href;
    } catch {
      return '';
    }
  }

  /** Ein Unterinhalt der Form { library: 'H5P.X 1.2', params, metadata }. */
  sub(item) {
    if (!item || typeof item !== 'object' || !item.library) return '';
    return this.render(String(item.library).split(' ')[0], item.params || {}, item.metadata || {});
  }

  media(params) {
    return params && params.media ? this.sub(params.media.type || params.media) : '';
  }

  render(library, p, meta = {}) {
    switch (library) {
      case 'H5P.Column':
        return (p.content || []).map((c) => this.sub(c.content)).join('\n');
      case 'H5P.AdvancedText':
      case 'H5P.Text':
      case 'H5P.ContinuousText':
      case 'H5P.Table':
        return `<div>${p.text || ''}</div>`;
      case 'H5P.Image': {
        const alt = p.alt || p.title || meta.title || '';
        return alt && !p.decorative ? `<p><img alt="${escapeHtml(alt)}"></p>` : '';
      }
      case 'H5P.Video':
        return this.video(p.sources || [], meta);
      case 'H5P.Audio':
        return this.video(p.files || [], meta, 'Audio');
      case 'H5P.Link': {
        const w = p.linkWidget || {};
        const url = w.url ? `${w.protocol && w.protocol !== 'other' ? w.protocol : ''}${w.url}` : '';
        return url ? `<p><a href="${escapeHtml(url)}">${escapeHtml(p.title || url)}</a></p>` : '';
      }
      case 'H5P.Accordion':
        return (p.panels || []).map((panel) => `<h4>${escapeHtml(panel.title)}</h4>\n${this.sub(panel.content)}`).join('\n');
      case 'H5P.MultiChoice':
        return this.multiChoice(p);
      case 'H5P.SingleChoiceSet':
        return (p.choices || []).map((c) => this.multiChoice({
          question: c.question,
          answers: (c.answers || []).map((a, i) => ({ text: a, correct: i === 0 })),
        })).join('\n');
      case 'H5P.TrueFalse':
        return `${heading('Selbsttest (Richtig/Falsch)')}${this.media(p)}<div>${p.question || ''}</div>`
          + `<p>Lösung: ${String(p.correct) === 'true' ? 'richtig' : 'falsch'}</p>`;
      case 'H5P.Blanks':
        return `${heading('Selbsttest (Lückentext, Lösungen fett)')}${this.media(p)}<div>${p.text || ''}</div>`
          + (p.questions || []).map((q) => `<div>${fillBlanks(q)}</div>`).join('\n');
      case 'H5P.DragText':
      case 'H5P.MarkTheWords':
        return `${heading(library === 'H5P.DragText' ? 'Selbsttest (Wörter zuordnen, Lösungen fett)' : 'Selbsttest (Wörter markieren, Lösungen fett)')}`
          + `<div>${p.taskDescription || ''}</div><div>${fillBlanks(String(p.textField || '').replace(/\n/g, '<br>'))}</div>`;
      case 'H5P.GuessTheAnswer':
        return `${heading('Selbsttest (Rate die Antwort)')}<div>${p.taskDescription || ''}</div>${this.media(p)}`
          + (p.solutionText ? `<p>Lösung: ${escapeHtml(stripTags(p.solutionText))}</p>` : '');
      case 'H5P.QuestionSet': {
        const intro = p.introPage && p.introPage.showIntroPage
          ? `${p.introPage.title ? `<h4>${escapeHtml(p.introPage.title)}</h4>` : ''}<div>${p.introPage.introduction || ''}</div>` : '';
        return intro + (p.questions || []).map((q) => this.sub(q)).join('\n');
      }
      case 'H5P.Summary':
        return heading('Selbsttest (Zusammenfassung, jeweils erste Aussage richtig)') + `<div>${p.intro || ''}</div>`
          + (p.summaries || []).map((s) => this.choiceList((s.summary || []).map((t, i) => ({ text: t, correct: i === 0 })))).join('\n');
      case 'H5P.Essay':
        return `${heading('Aufgabe (Freitext)')}<div>${p.taskDescription || ''}</div>`
          + (p.solution && p.solution.sample ? `<p>Musterlösung:</p><div>${p.solution.sample}</div>` : '');
      case 'H5P.Dialogcards':
      case 'H5P.Flashcards':
        return `${p.title ? `<h4>${escapeHtml(stripTags(p.title))}</h4>` : ''}<div>${p.description || ''}</div><ul>`
          + (p.dialogs || p.cards || []).map((c) => `<li>${escapeHtml(stripTags(c.text))} → ${escapeHtml(stripTags(c.answer))}</li>`).join('') + '</ul>';
      case 'H5P.CoursePresentation':
        return ((p.presentation && p.presentation.slides) || []).map((slide, i) => {
          const body = (slide.elements || []).map((el) => this.sub(el.action)).filter(Boolean).join('\n');
          return body ? `<h4>Folie ${i + 1}</h4>\n${body}` : '';
        }).filter(Boolean).join('\n');
      case 'H5P.InteractiveVideo': {
        const iv = p.interactiveVideo || {};
        const video = iv.video || {};
        const start = video.startScreenOptions || {};
        const interactions = ((iv.assets && iv.assets.interactions) || []).map((x) => {
          const at = x.duration && Number.isFinite(x.duration.from) ? `[${formatTime(x.duration.from)}] ` : '';
          const body = this.sub(x.action);
          return body ? `<div><p>${escapeHtml(at + (x.label ? stripTags(x.label) : ''))}</p>${body}</div>` : '';
        }).filter(Boolean);
        return this.video(video.files || [], { title: start.title || meta.title })
          + interactions.join('\n') + (iv.summary && iv.summary.task ? this.sub(iv.summary.task) : '');
      }
      case 'H5P.InteractiveBook':
        return (p.chapters || []).map((ch) => `<h4>${escapeHtml((ch.metadata && ch.metadata.title) || '')}</h4>\n${this.sub(ch)}`).join('\n');
      case 'H5P.ImageHotspots':
        return (p.hotspots || []).map((h) => `${h.header ? `<h4>${escapeHtml(h.header)}</h4>` : ''}${(h.content || []).map((c) => this.sub(c)).join('\n')}`).join('\n');
      case 'H5P.Timeline': {
        const t = p.timeline || {};
        return `${t.headline ? `<h4>${escapeHtml(t.headline)}</h4>` : ''}<div>${t.text || ''}</div><ul>`
          + (t.date || []).map((d) => `<li>${escapeHtml([d.startDate, d.endDate].filter(Boolean).join('–'))}: ${escapeHtml(stripTags(d.headline))} ${escapeHtml(stripTags(d.text))}</li>`).join('') + '</ul>';
      }
      default:
        return this.generic(p);
    }
  }

  video(sources, meta, kind = 'Video') {
    const parts = [];
    for (const s of sources) {
      const url = this.fileUrl(s && s.path);
      if (!url) continue;
      const title = mediaTitle(meta, this.title, url);
      if (/^https?:/i.test(s.path) && !/\.(mp4|m4a|mp3|webm|ogg|wav)(\?|$)/i.test(s.path)) {
        parts.push(`<p>${kind}: <a href="${escapeHtml(url)}">${escapeHtml(meta.title || this.title || url)}</a></p>`);
      } else {
        parts.push(`<p>[${kind}: ${escapeHtml(title)}]</p><video><source src="${escapeHtml(url)}" type="${escapeHtml(s.mime || '')}" title="${escapeHtml(title)}"></video>`);
      }
      break; // eine Quelle reicht – weitere sind dieselbe Aufnahme in anderer Qualitaet
    }
    return parts.join('');
  }

  choiceList(answers) {
    return '<ul>' + answers.map((a) => `<li>${a.correct ? '✔ (richtig) ' : '✘ '}${escapeHtml(stripTags(a.text))}</li>`).join('') + '</ul>';
  }

  multiChoice(p) {
    return `${heading('Selbsttest (Multiple Choice)')}${this.media(p)}<div>${p.question || ''}</div>${this.choiceList(p.answers || [])}`;
  }

  /** Unbekannter Inhaltstyp: Unterinhalte rendern, sonst nur inhaltliche Textfelder (keine UI-Texte). */
  generic(p) {
    const out = [];
    const walk = (value, key, depth) => {
      if (depth > 12 || value == null) return;
      if (Array.isArray(value)) { for (const v of value) walk(v, key, depth + 1); return; }
      if (typeof value === 'object') {
        if (typeof value.library === 'string' && value.params) { out.push(this.sub(value)); return; }
        for (const [k, v] of Object.entries(value)) {
          if (UI_KEYS.test(k)) continue;
          walk(v, k, depth + 1);
        }
        return;
      }
      if (typeof value === 'string' && CONTENT_KEYS.test(key || '') && stripTags(value)) out.push(`<div>${value}</div>`);
    };
    walk(p, '', 0);
    return out.join('\n');
  }
}

const CONTENT_KEYS = /^(text|question|taskDescription|introduction|description|intro|header|headline|summary|answer|solutionText|sample|instructions?)$/;
const UI_KEYS = /^(l10n|i18n|a11y|UI|labels?|texts|behaviou?r|overallFeedback|feedback.*|.*Button.*|.*Label|.*Text(?<!solutionText)|confirm.*|scoreBar.*|metadata|copyright|override|visuals|playback)$/;

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** HTML eines H5P-Inhalts (Text, Selbsttests mit Loesung, <video> fuer Mediendateien). */
export function h5pToHtml(content, baseUrl) {
  const r = new Renderer({ contentId: content.contentId, baseUrl, title: content.title });
  return r.render(String(content.library).split(' ')[0], content.params || {}, { title: content.title });
}

/**
 * Setzt in `doc` an jede H5P-Stelle den gelesenen Inhalt (statt Iframe + „Bitte warten …“).
 * Gibt die Zahl ersetzter Bloecke zurueck.
 */
export function inlineH5P(doc, html, baseUrl) {
  if (!doc || !html || !String(html).includes(INIT_CALL)) return 0;
  let replaced = 0;
  for (const content of extractH5PContents(html)) {
    const wrappers = new Set();
    const byId = content.elementId && doc.getElementById ? doc.getElementById(content.elementId) : null;
    if (byId) wrappers.add(byId);
    for (const frame of doc.querySelectorAll(`iframe[data-content-id="${content.contentId}"]`)) {
      wrappers.add(frame.closest('.h5p-iframe-wrapper') || frame);
    }
    if (!wrappers.size) continue;
    const markup = h5pToHtml(content, baseUrl);
    for (const wrapper of wrappers) {
      const box = doc.createElement('div');
      box.setAttribute('class', 'h5p-export');
      box.setAttribute('data-h5p-content-id', content.contentId);
      box.innerHTML = markup;
      wrapper.replaceWith(box);
      replaced += 1;
    }
  }
  return replaced;
}

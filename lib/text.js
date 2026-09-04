/**
 * DOM → readable Markdown-ish text. Works with the browser DOM and with linkedom.
 */

const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'BLOCKQUOTE', 'PRE', 'ADDRESS', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'FORM', 'FIELDSET', 'DETAILS', 'SUMMARY', 'CENTER']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'BUTTON', 'SELECT', 'OPTION', 'INPUT', 'TEXTAREA', 'NAV', 'IFRAME', 'HEAD', 'TITLE', 'LINK', 'META']);
const SKIP_CLASS = /\b(ilTabs|il-mainbar|il-maincontrols|breadcrumb|ilLocator|il-footer|ilFooter|dropdown-menu|il-item-actions|ilToolbar|il-toolbar|il-print-hidden|ilAccHeadingHidden|sr-only|ilDisplayNone|il-copg-edit|ilc_page_rnav_RightNavigation|ilc_page_lnav_LeftNavigation|ilc_page_tnav_TopNavigation|ilc_page_bnav_BottomNavigation|ilLMNavigation|il-metabar|ilOverlay|modal)\b/;

function isHidden(el) {
  if (!el.getAttribute) return false;
  const cls = el.getAttribute('class') || '';
  if (SKIP_CLASS.test(cls)) return true;
  const style = el.getAttribute('style') || '';
  if (/display\s*:\s*none/i.test(style)) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.hasAttribute && el.hasAttribute('hidden')) return true;
  return false;
}

function tagOf(el) {
  return (el.tagName || '').toUpperCase();
}

/**
 * Convert an element into Markdown-like text.
 * @param {Element} root
 * @param {{keepLinks?: boolean}} opts
 */
export function elementToMarkdown(root, opts = {}) {
  if (!root) return '';

  function inline(node) {
    let s = '';
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) {
        s += child.nodeValue.replace(/\s+/g, ' ');
      } else if (child.nodeType === 1) {
        const tag = tagOf(child);
        if (SKIP.has(tag) || isHidden(child)) continue;
        if (tag === 'BR') { s += '\n'; continue; }
        if (tag === 'IMG') {
          const alt = (child.getAttribute('alt') || '').trim();
          if (alt) s += `[Bild: ${alt}]`;
          continue;
        }
        if (tag === 'A') {
          const text = inline(child).trim();
          const href = child.getAttribute('href') || '';
          if (opts.keepLinks !== false && /^https?:/i.test(href) && text && !/studon\.fau\.de/.test(href) && text !== href) {
            s += `${text} (${href})`;
          } else {
            s += text;
          }
          continue;
        }
        if (tag === 'STRONG' || tag === 'B') { const t = inline(child).trim(); if (t) s += `**${t}**`; continue; }
        if (tag === 'EM' || tag === 'I') { const t = inline(child).trim(); if (t) s += `*${t}*`; continue; }
        if (tag === 'CODE') { const t = inline(child).trim(); if (t) s += `\`${t}\``; continue; }
        if (tag === 'SUP') { s += `^${inline(child).trim()}`; continue; }
        if (tag === 'SUB') { s += `_${inline(child).trim()}`; continue; }
        if (isBlockTag(tag)) {
          s += `\n${blockToText(child, 0)}\n`;
          continue;
        }
        s += inline(child);
      }
    }
    return s;
  }

  function isBlockTag(tag) {
    return BLOCK.has(tag) || /^H[1-6]$/.test(tag) || tag === 'UL' || tag === 'OL' || tag === 'TABLE' || tag === 'HR' || tag === 'LI';
  }

  function blockToText(el, depth) {
    const tag = tagOf(el);
    if (SKIP.has(tag) || isHidden(el)) return '';
    if (/^H[1-6]$/.test(tag)) {
      const level = Math.min(6, parseInt(tag[1], 10) + 1);
      const t = inline(el).replace(/\s+/g, ' ').trim();
      return t ? `\n${'#'.repeat(level)} ${t}\n` : '';
    }
    if (tag === 'UL' || tag === 'OL') {
      let i = 0;
      const items = [];
      for (const li of el.children || []) {
        if (tagOf(li) !== 'LI') continue;
        i += 1;
        const marker = tag === 'OL' ? `${i}.` : '-';
        const body = listItemText(li, depth);
        if (body.trim()) items.push(`${'  '.repeat(depth)}${marker} ${body}`);
      }
      return items.length ? `\n${items.join('\n')}\n` : '';
    }
    if (tag === 'LI') return listItemText(el, depth);
    if (tag === 'TABLE') return tableToText(el);
    if (tag === 'PRE') return `\n\`\`\`\n${(el.textContent || '').trim()}\n\`\`\`\n`;
    if (tag === 'HR') return '\n---\n';
    if (tag === 'BLOCKQUOTE') {
      const t = childrenToText(el, depth).trim();
      return t ? `\n${t.split('\n').map((l) => `> ${l}`).join('\n')}\n` : '';
    }
    if (tag === 'DT') return `\n**${inline(el).trim()}**\n`;
    if (tag === 'DD') return `${inline(el).trim()}\n`;
    return childrenToText(el, depth);
  }

  function listItemText(li, depth) {
    let s = '';
    for (const child of li.childNodes || []) {
      if (child.nodeType === 3) s += child.nodeValue.replace(/\s+/g, ' ');
      else if (child.nodeType === 1) {
        const tag = tagOf(child);
        if (SKIP.has(tag) || isHidden(child)) continue;
        if (tag === 'UL' || tag === 'OL') s += `\n${blockToText(child, depth + 1).replace(/^\n|\n$/g, '')}`;
        else if (isBlockTag(tag)) s += blockToText(child, depth);
        else s += inline({ childNodes: [child] });
      }
    }
    return s
      .split('\n')
      .map((line) => line.replace(/^( *)(.*)$/, (m, lead, rest) => lead + rest.replace(/[ \t]+/g, ' ').trim()))
      .join('\n')
      .trim();
  }

  function childrenToText(el, depth) {
    let s = '';
    let inlineBuf = '';
    const flush = () => {
      const t = inlineBuf.replace(/[ \t]+/g, ' ').replace(/^ +| +$/gm, '').trim();
      if (t) s += `\n${t}\n`;
      inlineBuf = '';
    };
    for (const child of el.childNodes || []) {
      if (child.nodeType === 3) {
        inlineBuf += child.nodeValue.replace(/\s+/g, ' ');
      } else if (child.nodeType === 1) {
        const tag = tagOf(child);
        if (SKIP.has(tag) || isHidden(child)) continue;
        if (isBlockTag(tag) || tag === 'DL') {
          flush();
          s += blockToText(child, depth);
        } else if (tag === 'BR') {
          inlineBuf += '\n';
        } else {
          inlineBuf += inline({ childNodes: [child] });
        }
      }
    }
    flush();
    return s;
  }

  function tableToText(table) {
    const rows = [];
    for (const tr of table.querySelectorAll('tr')) {
      const cells = [];
      for (const cell of tr.children || []) {
        const t = tagOf(cell);
        if (t !== 'TD' && t !== 'TH') continue;
        cells.push(childrenToText(cell, 0).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/').trim());
      }
      if (cells.some(Boolean)) rows.push(cells);
    }
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    const lines = rows.map((r) => `| ${Array.from({ length: width }, (_, i) => r[i] || '').join(' | ')} |`);
    lines.splice(1, 0, `| ${Array.from({ length: width }, () => '---').join(' | ')} |`);
    return `\n${lines.join('\n')}\n`;
  }

  return normalizeMarkdown(blockToText(root, 0));
}

export function normalizeMarkdown(text) {
  return String(text || '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function wordCount(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

/** Split long text into chunks below maxWords, on paragraph boundaries. */
export function splitByWords(text, maxWords = 400000) {
  if (wordCount(text) <= maxWords) return [text];
  const parts = [];
  let current = [];
  let count = 0;
  for (const para of String(text).split(/\n\n+/)) {
    const w = wordCount(para);
    if (count + w > maxWords && current.length) {
      parts.push(current.join('\n\n'));
      current = [];
      count = 0;
    }
    current.push(para);
    count += w;
  }
  if (current.length) parts.push(current.join('\n\n'));
  return parts;
}

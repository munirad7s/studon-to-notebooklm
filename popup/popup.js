import { listCourses, getCourseState } from '../lib/storage.js';
import { parseRepoLink, typeLabel } from '../lib/ilias.js';

const $ = (id) => document.getElementById(id);

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && tab.url ? tab.url : '';
  const parsed = url.includes('studon.fau.de') ? parseRepoLink(url) : null;
  if (parsed && parsed.refId && parsed.refId !== '1') {
    const title = (tab.title || '').replace(/\s*[:\-–]\s*StudOn\s*$/i, '').replace(/^Inhalt\s*[:\-–]\s*/i, '').trim();
    $('cur-title').textContent = title || `StudOn ${parsed.refId}`;
    const state = await getCourseState(parsed.refId);
    $('cur-meta').textContent = `${typeLabel(parsed.type || 'crs')} · ref ${parsed.refId}${state.lastRun ? ` · zuletzt ${new Date(state.lastRun).toLocaleDateString('de-DE')}` : ''}`;
    $('btn-open').disabled = false;
    $('btn-open').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'open-exporter', ref: parsed.refId, type: parsed.type || '', title, url }, () => window.close());
    });
  } else if (url.includes('studon.fau.de')) {
    $('cur-title').textContent = 'StudOn – kein Kursobjekt erkannt';
    $('cur-meta').textContent = 'Öffne einen Kurs, Ordner oder ein Lernmodul.';
  } else {
    $('cur-title').textContent = 'Nicht auf StudOn';
    $('cur-meta').textContent = 'Öffne einen Kurs auf www.studon.fau.de';
  }

  const courses = await listCourses();
  if (courses.length) {
    $('recent-card').hidden = false;
    for (const c of courses.slice(0, 6)) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `../export/export.html?ref=${encodeURIComponent(c.refId)}&title=${encodeURIComponent(c.title || '')}`;
      a.target = '_blank';
      a.textContent = c.title || `StudOn ${c.refId}`;
      const meta = document.createElement('span');
      meta.className = 'muted small';
      meta.textContent = c.lastRun ? `Sync: ${new Date(c.lastRun).toLocaleString('de-DE')}` : '';
      li.append(a, meta);
      if (c.primaryNotebookId) {
        const nb = document.createElement('a');
        nb.href = `https://notebooklm.google.com/notebook/${c.primaryNotebookId}`;
        nb.target = '_blank';
        nb.className = 'small';
        nb.textContent = '📓 Notebook öffnen';
        li.appendChild(nb);
      }
      $('recent').appendChild(li);
    }
  }
}

init();

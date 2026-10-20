import { listCourses, getCourseState } from '../lib/storage.js';
import { parseRepoLink, typeLabel } from '../lib/ilias.js';
import { parseFauTvUrl } from '../lib/fautv.js';

const $ = (id) => document.getElementById(id);

async function launch(params) {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'open-exporter', ...params });
    if (!response?.ok) throw new Error(response?.error || 'Exporter konnte nicht geöffnet werden.');
    window.close();
  } catch (err) {
    $('launch-error').textContent = err.message;
  }
}

function fauTvParams(parsed, title = '') {
  return { source: 'fautv', ref: `fautv:${parsed.url}`, url: parsed.url, title };
}

async function init() {
  $('fautv-form').addEventListener('submit', (event) => {
    event.preventDefault();
    $('launch-error').textContent = '';
    const parsed = parseFauTvUrl($('fautv-url').value.trim());
    if (!parsed) {
      $('launch-error').textContent = 'Bitte einen FAU.tv-Link zu einem Video oder einer Vorlesungsreihe eingeben.';
      return;
    }
    launch(fauTvParams(parsed));
  });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && tab.url ? tab.url : '';
  const parsed = url.includes('studon.fau.de') ? parseRepoLink(url) : null;
  const fauTv = parseFauTvUrl(url);
  if (fauTv) {
    $('cur-title').textContent = tab.title || 'FAU.tv';
    $('cur-meta').textContent = fauTv.kind === 'series' ? 'FAU.tv · Ganze Vorlesungsreihe auswählen' : 'FAU.tv · Einzelnes Video';
    $('btn-open').disabled = false;
    $('btn-open').addEventListener('click', () => launch(fauTvParams(fauTv, tab.title || '')));
  } else if (parsed && parsed.refId && parsed.refId !== '1') {
    const title = (tab.title || '').replace(/\s*[:\-–]\s*StudOn\s*$/i, '').replace(/^Inhalt\s*[:\-–]\s*/i, '').trim();
    $('cur-title').textContent = title || `StudOn ${parsed.refId}`;
    const state = await getCourseState(parsed.refId);
    $('cur-meta').textContent = `${typeLabel(parsed.type || 'crs')} · ref ${parsed.refId}${state.lastRun ? ` · zuletzt ${new Date(state.lastRun).toLocaleDateString('de-DE')}` : ''}`;
    $('btn-open').disabled = false;
    $('btn-open').addEventListener('click', () => {
      launch({ ref: parsed.refId, objType: parsed.type || '', title, url });
    });
  } else if (url.includes('studon.fau.de')) {
    $('cur-title').textContent = 'StudOn – kein Kursobjekt erkannt';
    $('cur-meta').textContent = 'Öffne einen Kurs, Ordner oder ein Lernmodul.';
  } else {
    $('cur-title').textContent = 'StudOn oder FAU.tv öffnen';
    $('cur-meta').textContent = 'Öffne einen Kurs, ein FAU.tv-Video oder eine Vorlesungsreihe.';
  }

  const courses = await listCourses();
  if (courses.length) {
    $('recent-card').hidden = false;
    for (const c of courses.slice(0, 6)) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      const params = { ref: c.refId, title: c.title || '' };
      if (c.source) params.source = c.source;
      if (c.url) params.url = c.url;
      if (c.refId.startsWith('fautv:')) {
        params.source = 'fautv';
        params.url ||= c.refId.slice(6);
      }
      a.href = `../export/export.html?${new URLSearchParams(params)}`;
      a.addEventListener('click', (event) => { event.preventDefault(); launch(params); });
      a.target = '_blank';
      a.textContent = c.title || (params.source === 'fautv' ? 'FAU.tv' : `StudOn ${c.refId}`);
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

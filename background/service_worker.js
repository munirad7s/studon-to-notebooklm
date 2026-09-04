/**
 * Service worker: öffnet den Export-Tab, listet Notebooks für den Dialog auf
 * StudOn und beantwortet kleine Anfragen von Content-Script und Popup.
 * Die eigentliche Arbeit passiert in export/export.html.
 */

import { NotebookLMClient, NotLoggedInError } from '../lib/nlm-client.js';
import { getSettings } from '../lib/storage.js';

const LAUNCH_KEYS = ['ref', 'type', 'title', 'url', 'scan', 'mode', 'notebook', 'nbtitle', 'autostart'];

function exporterUrl(params) {
  const q = new URLSearchParams();
  for (const key of LAUNCH_KEYS) if (params[key]) q.set(key, String(params[key]));
  return chrome.runtime.getURL(`export/export.html?${q.toString()}`);
}

async function openExporter(params) {
  const target = exporterUrl(params);
  const base = target.split('?')[0];
  const existing = await chrome.tabs.query({ url: `${base}*` });
  const same = existing.find((t) => t.url && new URL(t.url).searchParams.get('ref') === String(params.ref || ''));
  if (same) {
    // Mit neuen Startparametern (Dialog) wird der Tab neu geladen, sonst nur nach vorn geholt.
    const relaunch = params.autostart || params.scan || params.mode;
    await chrome.tabs.update(same.id, relaunch ? { active: true, url: target } : { active: true });
    await chrome.windows.update(same.windowId, { focused: true }).catch(() => {});
    return same.id;
  }
  const tab = await chrome.tabs.create({ url: target });
  return tab.id;
}

/* Notebook-Liste für den Dialog; kurz gecacht, damit er sofort aufgeht. */
let notebookCache = { at: 0, data: null };

async function listNotebooks({ force = false } = {}) {
  if (!force && notebookCache.data && Date.now() - notebookCache.at < 60000) return notebookCache.data;
  const settings = await getSettings();
  const nlm = new NotebookLMClient({ fetch: (u, i) => fetch(u, i), authuser: settings.authuser });
  const info = await nlm.init();
  const notebooks = (await nlm.listNotebooks())
    .filter((n) => n.owned)
    .map(({ id, title, emoji, sourceCount }) => ({ id, title, emoji, sourceCount }));
  const data = { ok: true, email: info.email || '', notebooks };
  notebookCache = { at: Date.now(), data };
  return data;
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?welcome=1') });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'open-exporter') {
    // Der Dialog schickt den ILIAS-Objekttyp als objType, weil "type" die Nachricht kennzeichnet.
    const params = { ...message, type: message.objType ?? message.type_ ?? '' };
    if (params.type === 'open-exporter') params.type = '';
    openExporter(params)
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'list-notebooks') {
    listNotebooks({ force: !!message.force })
      .then((data) => sendResponse(data))
      .catch((err) => {
        notebookCache = { at: 0, data: null };
        sendResponse({ ok: false, notLoggedIn: err instanceof NotLoggedInError, error: err.message });
      });
    return true;
  }

  if (message.type === 'open-url') {
    chrome.tabs.create({ url: message.url }).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

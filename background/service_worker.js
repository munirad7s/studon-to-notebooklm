/**
 * Service worker: opens the exporter tab and answers small requests from the
 * content script / popup. All heavy lifting happens in export/export.html.
 */

function exporterUrl({ ref, type, title, url }) {
  const q = new URLSearchParams();
  if (ref) q.set('ref', ref);
  if (type) q.set('type', type);
  if (title) q.set('title', title);
  if (url) q.set('url', url);
  return chrome.runtime.getURL(`export/export.html?${q.toString()}`);
}

async function openExporter(params) {
  const target = exporterUrl(params);
  const base = target.split('?')[0];
  const existing = await chrome.tabs.query({ url: `${base}*` });
  const same = existing.find((t) => t.url && new URL(t.url).searchParams.get('ref') === String(params.ref || ''));
  if (same) {
    await chrome.tabs.update(same.id, { active: true });
    await chrome.windows.update(same.windowId, { focused: true }).catch(() => {});
    return same.id;
  }
  const tab = await chrome.tabs.create({ url: target });
  return tab.id;
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?welcome=1') });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;
  if (message.type === 'open-exporter') {
    openExporter(message).then((tabId) => sendResponse({ ok: true, tabId })).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'open-url') {
    chrome.tabs.create({ url: message.url }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

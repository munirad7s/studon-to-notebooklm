/**
 * Background Service Worker for StudOn to NotebookLM
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('StudOn to NotebookLM Extension installed.');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadZip') {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename,
      saveAs: false
    }, (downloadId) => {
      sendResponse({ success: true, downloadId });
    });
    return true;
  }

  if (request.action === 'openNotebookLM') {
    chrome.tabs.create({ url: 'https://notebooklm.google.com' }, (tab) => {
      sendResponse({ success: true, tabId: tab.id });
    });
    return true;
  }
});

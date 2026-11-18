import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../content/bridge.js', import.meta.url), 'utf8');

/**
 * Lädt content/bridge.js so, wie Chrome es in einen StudOn-Tab lädt, und gibt eine
 * `send`-Funktion zurück, die sich wie `chrome.tabs.sendMessage` für diesen Tab verhält.
 */
export function loadContentBridge({ fetch, botCheck = false, href = 'https://www.studon.fau.de/studon/ilias.php?baseClass=ilrepositorygui&ref_id=1', extensionId = 'ext', globals = {} } = {}) {
  let listener;
  const window = {};
  window.top = window;
  const context = vm.createContext({
    window,
    location: new URL(href),
    URL,
    btoa,
    fetch,
    document: { getElementById: (id) => (botCheck && id === 'anubis_challenge' ? {} : null) },
    chrome: { runtime: { id: extensionId, onMessage: { addListener(fn) { listener = fn; } } } },
    navigator: {},
    setTimeout,
    ...globals,
  });
  vm.runInContext(source, context);
  const send = (message, sender = { id: extensionId }) => new Promise((resolve, reject) => {
    const handled = listener(message, sender, resolve);
    if (handled !== true) reject(new Error('Could not establish connection. Receiving end does not exist.'));
  });
  return { send };
}

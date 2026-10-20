/** Independent FAU.tv entry point; the service worker validates the full URL. */
(() => {
  if (document.getElementById('studon-notebooklm-fautv')) return;
  const host = document.createElement('div');
  host.id = 'studon-notebooklm-fautv';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host { all: initial; position: fixed; right: 24px; bottom: 24px; z-index: 2147483647; }
    :host([hidden]) { display: none; }
    button { border: 0; border-radius: 12px; padding: 14px 18px; background: #1e4d38; color: white;
      font: 600 14px/1.4 system-ui, sans-serif; cursor: pointer; box-shadow: 0 4px 18px #0003; }
    button:focus-visible { outline: 3px solid #77cda4; outline-offset: 3px; }
    button:disabled { opacity: .7; cursor: wait; }
    p { max-width: 280px; border-radius: 8px; padding: 8px; background: white; color: #a02020;
      font: 13px/1.5 system-ui, sans-serif; }
    p:empty { display: none; }
  </style><p role="alert"></p><button type="button">An NotebookLM senden</button>`;
  const button = shadow.querySelector('button');
  const error = shadow.querySelector('p');
  let previousUrl = '';
  function update() {
    if (previousUrl === location.href) return;
    previousUrl = location.href;
    host.hidden = !/^\/(?:clip\/id\/\d+|series\/[^/]+(?:\/[^/]+)?)\/?$/.test(location.pathname);
    error.textContent = '';
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    error.textContent = '';
    try {
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.hostname = 'www.fau.tv';
      url.pathname = url.pathname.replace(/\/$/, '');
      const response = await chrome.runtime.sendMessage({ type: 'open-exporter', source: 'fautv',
        ref: `fautv:${url.href}`, url: url.href, title: document.title });
      if (!response?.ok) throw new Error(response?.error || 'Exporter konnte nicht geöffnet werden.');
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
  document.documentElement.appendChild(host);
  update();
  // pushState does not emit popstate in the isolated content-script world.
  setInterval(update, 1000);
  window.addEventListener('popstate', update);
})();

/**
 * Fixture fuer fau.tv-Clipseiten - Markup und Livewire-Protokoll wie am 2026-09-04
 * live beobachtet (Clip 42516, HCI Evaluation 1). Dropdowns und Player gekuerzt.
 */

export const CLIP_ID = '42516';
export const CLIP_URL = `https://www.fau.tv/clip/id/${CLIP_ID}`;
export const FINAL_URL = 'https://www.fau.tv/series/human-computer-interaction-hci-s22/9-human-computer-interaction-hci-evaluation-1-s22';
export const UPDATE_URL = 'https://www.fau.tv/livewire-61f7c42d/update';
export const CSRF = 'FIXTURE-CSRF-TOKEN-0000';
export const TITLE = '9 - Human Computer Interaction (HCI) - Evaluation 1';

export const SNAPSHOT = JSON.stringify({
  data: { asset_guid: 'c9642217-a82f-4936-8509-129b4b8f57ac' },
  memo: {
    id: 'wMzLyiIl1Pc9RRBWu7xU', name: 'clip-transcript',
    path: 'series/human-computer-interaction-hci-s22/9-human-computer-interaction-hci-evaluation-1-s22',
    method: 'GET', release: 'a-a-a', children: [], scripts: [], assets: [], errors: [], locale: 'de', islands: [],
  },
  checksum: '1c5b8f00366a38224ee2b615b2df4540387f91a7e53c149578db74a4dcab37ce',
});

export const SEGMENTS = [
  { startSeconds: 0, endSeconds: 10.44, text: 'Dear students, welcome back to Human Computer Interaction.' },
  { startSeconds: 10.44, endSeconds: 15.04, text: 'Now in chapter 6 we are going to talk about evaluation.' },
  { startSeconds: 15.04, endSeconds: 21.44, text: 'Evaluation is of course a key topic when you think about your design, you want to test' },
  { startSeconds: 21.44, endSeconds: 27.28, text: 'it, why and how it works and therefore you need to know a little bit about evaluation' },
  { startSeconds: 27.28, endSeconds: 28.64, text: 'methods.' },
  { startSeconds: 58.62, endSeconds: 61.32, text: "So let's start with the experimental design." },
  { startSeconds: 61.32, endSeconds: 64.02, text: 'So what is this all about?' },
  { startSeconds: 1152.8, endSeconds: 1163.24, text: 'And as said we are going to delve deeper into these topics in the next few subchapters.' },
];

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#039;');
}

/** Clip-Seite; `withTranscript: false` = Video ohne Untertitel (keine Komponente im HTML). */
export function clipPage({ withTranscript = true } = {}) {
  const component = withTranscript
    ? `<div wire:snapshot="${escapeAttr(SNAPSHOT)}" wire:effects="[]" wire:id="wMzLyiIl1Pc9RRBWu7xU" wire:name="clip-transcript" class="transcript-container" x-data="transcriptPlayer()">
        <div id="transcript-scroll-container"></div>
      </div>`
    : '';
  return `<!DOCTYPE html><html lang="de"><head>
  <meta charset="utf-8">
  <meta name="csrf-token" content="${CSRF}">
  <meta property="og:title" content="${escapeAttr(TITLE)} [ID:${CLIP_ID}]">
  <meta property="og:url" content="${FINAL_URL}">
  <title>${TITLE} [ID:${CLIP_ID}]</title>
  <script>window.livewireScriptConfig = {"csrf":"${CSRF}","uri":"\\/livewire-61f7c42d\\/update","moduleUrl":"\\/livewire-61f7c42d\\/livewire.min.js","progressBar":"","nonce":""};</script>
</head><body>
  <header><a href="https://www.fau.tv">Das Videoportal der FAU</a> <a href="/logout">Abmelden</a></header>
  <main>
    <h1>${TITLE}</h1>
    <media-player src="https://stream.fau.tv/videoportal_sec/_definst_/videoportal/2022/06/02/FAU_S22_LECPORCR_ClipID_42516/presenter.smil/playlist.m3u8?rrzevphash=x"></media-player>
    ${component}
    <script>function transcriptPlayer() { return { allEntries: [], async init() { this.allEntries = await this.$wire.getEntries(); } }; }</script>
  </main>
</body></html>`;
}

export const LOGIN_URL = 'https://www.sso.uni-erlangen.de/simplesaml/module.php/core/loginuserpass.php';

/**
 * fetch-Ersatz fuer fau.tv: GET der Clip-Seite (mit Redirect auf die Serien-URL) und
 * POST auf den Livewire-Endpunkt. Zeichnet Aufrufe in `calls` auf.
 */
export function fakeFauTvFetch({ withTranscript = true, loginWall = false, segments = SEGMENTS } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (loginWall) {
      return { ok: true, status: 200, url: LOGIN_URL, text: async () => '<form><input name="password"></form>', json: async () => ({}) };
    }
    if (init.method === 'POST' && url === UPDATE_URL) {
      const body = JSON.parse(init.body || '{}');
      const component = body.components && body.components[0];
      if (body._token !== CSRF || !component || !String(component.snapshot).includes('clip-transcript')) {
        return { ok: false, status: 419, url, text: async () => 'CSRF token mismatch', json: async () => ({ message: 'CSRF token mismatch' }) };
      }
      const payload = { components: [{ snapshot: component.snapshot, effects: { returns: [segments], html: null } }] };
      return { ok: true, status: 200, url, text: async () => JSON.stringify(payload), json: async () => payload };
    }
    if (/fau\.tv\/(clip\/id\/\d+|series\/)/.test(url)) {
      const html = clipPage({ withTranscript });
      return { ok: true, status: 200, url: FINAL_URL, text: async () => html, json: async () => ({}) };
    }
    return { ok: false, status: 404, url, text: async () => 'not found', json: async () => ({}) };
  };
  fetch.calls = calls;
  return fetch;
}

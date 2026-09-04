import { getSettings, saveSettings, listCourses, resetCourseState, getDriveToken, saveDriveToken, clearDriveToken } from '../lib/storage.js';
import { buildAuthUrl, parseTokenFromRedirect, DriveClient } from '../lib/drive-client.js';

const $ = (id) => document.getElementById(id);
let settings;

function flashSaved() {
  $('saved').style.opacity = 1;
  setTimeout(() => { $('saved').style.opacity = 0; }, 1200);
}

async function persist(patch) {
  settings = await saveSettings(patch);
  flashSaved();
}

async function renderCourses() {
  const list = $('courses');
  list.innerHTML = '';
  const courses = await listCourses();
  if (!courses.length) {
    list.innerHTML = '<li class="muted small">Noch keine Exporte.</li>';
    return;
  }
  for (const c of courses) {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'grow';
    title.textContent = `${c.title || `StudOn ${c.refId}`} (ref ${c.refId})${c.lastRun ? ` · ${new Date(c.lastRun).toLocaleString('de-DE')}` : ''}`;
    const open = document.createElement('a');
    open.href = `../export/export.html?ref=${encodeURIComponent(c.refId)}&title=${encodeURIComponent(c.title || '')}`;
    open.target = '_blank';
    open.className = 'small';
    open.textContent = 'Exporter';
    const reset = document.createElement('button');
    reset.className = 'small danger';
    reset.textContent = 'Zurücksetzen';
    reset.addEventListener('click', async () => {
      if (!confirm(`Gedächtnis für „${c.title || c.refId}“ löschen? Die Notebooks in NotebookLM bleiben unverändert.`)) return;
      await resetCourseState(c.refId);
      renderCourses();
    });
    li.append(title, open, reset);
    list.appendChild(li);
  }
}

async function driveTest() {
  const status = $('drive-status');
  const clientId = $('driveClientId').value.trim();
  if (!clientId) { status.textContent = 'Bitte zuerst eine Client-ID eintragen.'; return; }
  await persist({ driveClientId: clientId });
  status.textContent = 'Anmeldung läuft …';
  try {
    const url = buildAuthUrl({ clientId, redirectUri: chrome.identity.getRedirectURL() });
    const responseUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    const token = parseTokenFromRedirect(responseUrl);
    await saveDriveToken(token);
    const drive = new DriveClient({ fetch: (u, i) => fetch(u, i), getToken: async () => token.token });
    const about = await drive.api('/drive/v3/about?fields=user(emailAddress)');
    status.textContent = `Verbunden als ${about.user.emailAddress}`;
  } catch (err) {
    status.textContent = `Fehler: ${err.message}`;
  }
}

async function init() {
  settings = await getSettings();
  $('authuser').value = settings.authuser;
  $('maxSources').value = settings.maxSourcesPerNotebook;
  $('driveClientId').value = settings.driveClientId;
  $('driveRootFolder').value = settings.driveRootFolder;
  for (const input of document.querySelectorAll('#scan-defaults input')) input.checked = !!settings.scan[input.dataset.opt];
  $('redirect-uri').textContent = chrome.identity.getRedirectURL();
  $('ext-id').textContent = chrome.runtime.id;
  $('ext-version').textContent = chrome.runtime.getManifest().version;
  if (new URLSearchParams(location.search).get('welcome')) $('welcome').hidden = false;
  const token = await getDriveToken();
  if (token) $('drive-status').textContent = 'Drive-Token vorhanden.';

  $('authuser').addEventListener('change', () => persist({ authuser: parseInt($('authuser').value, 10) || 0 }));
  $('maxSources').addEventListener('change', () => persist({ maxSourcesPerNotebook: parseInt($('maxSources').value, 10) || 300 }));
  $('driveClientId').addEventListener('change', () => persist({ driveClientId: $('driveClientId').value.trim() }));
  $('driveRootFolder').addEventListener('change', () => persist({ driveRootFolder: $('driveRootFolder').value.trim() || 'NotebookLM Import' }));
  for (const input of document.querySelectorAll('#scan-defaults input')) {
    input.addEventListener('change', () => persist({ scan: { [input.dataset.opt]: input.checked } }));
  }
  $('btn-drive-test').addEventListener('click', driveTest);
  $('btn-drive-logout').addEventListener('click', async () => { await clearDriveToken(); $('drive-status').textContent = 'Token verworfen.'; });
  renderCourses();
}

init();

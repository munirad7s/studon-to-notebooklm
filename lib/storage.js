/**
 * Settings and per-course export memory in chrome.storage.local
 * (falls back to an in-memory map outside the extension, e.g. in tests).
 */

export const DEFAULT_SETTINGS = {
  authuser: 0,
  driveClientId: '',
  driveRootFolder: 'NotebookLM Import',
  maxSourcesPerNotebook: 300,
  scan: {
    files: true,
    learningModules: true,
    pages: true,
    wiki: true,
    glossary: true,
    exercises: true,
    sessions: true,
    forum: false,
    media: false,
    weblinks: true,
    fauTv: true,
    courseInfo: true,
  },
  export: {
    target: 'notebooklm',
    driveMirror: false,
    driveAsSource: false,
    zip: false,
    waitForProcessing: true,
    overviewSource: true,
  },
};

const memory = new Map();

function area() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) return chrome.storage.local;
  return {
    get: async (keys) => {
      const out = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (memory.has(k)) out[k] = memory.get(k);
      return out;
    },
    set: async (obj) => { for (const [k, v] of Object.entries(obj)) memory.set(k, v); },
    remove: async (keys) => { for (const k of Array.isArray(keys) ? keys : [keys]) memory.delete(k); },
  };
}

function merge(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] || {}, v) : v;
  }
  return out;
}

export async function getSettings() {
  const { settings } = await area().get('settings');
  return merge(DEFAULT_SETTINGS, settings || {});
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = merge(current, patch);
  await area().set({ settings: next });
  return next;
}

export function courseKey(refId) {
  return `course:${refId}`;
}

/**
 * Course state shape:
 * { refId, title, notebooks: [{ id, title }], primaryNotebookId, driveFolderId,
 *   items: { [itemKey]: { sourceId, notebookId, size, modified, filename, when, driveFileId } },
 *   lastRun, log: [] }
 */
export async function getCourseState(refId) {
  const key = courseKey(refId);
  const data = await area().get(key);
  return data[key] || { refId: String(refId), title: '', notebooks: [], primaryNotebookId: null, driveFolderId: null, items: {}, lastRun: null };
}

export async function saveCourseState(state) {
  await area().set({ [courseKey(state.refId)]: state });
  const { courses } = await area().get('courses');
  const list = Array.isArray(courses) ? courses.filter((c) => c.refId !== state.refId) : [];
  list.unshift({ refId: state.refId, title: state.title, primaryNotebookId: state.primaryNotebookId, lastRun: state.lastRun });
  await area().set({ courses: list.slice(0, 50) });
}

export async function listCourses() {
  const { courses } = await area().get('courses');
  return Array.isArray(courses) ? courses : [];
}

export async function resetCourseState(refId) {
  await area().remove(courseKey(refId));
  const { courses } = await area().get('courses');
  await area().set({ courses: (courses || []).filter((c) => c.refId !== String(refId)) });
}

export async function getDriveToken() {
  const { driveToken } = await area().get('driveToken');
  if (driveToken && driveToken.expiresAt > Date.now()) return driveToken;
  return null;
}

export async function saveDriveToken(token) {
  await area().set({ driveToken: token });
}

export async function clearDriveToken() {
  await area().remove('driveToken');
}

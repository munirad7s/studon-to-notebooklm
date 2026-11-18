import { test } from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage() {
  const data = {};
  return {
    data,
    async get(keys) {
      const list = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
  };
}

test('Protokoll des letzten Laufs wird je Kurs gespeichert und beim Zurücksetzen gelöscht', async () => {
  const local = fakeStorage();
  globalThis.chrome = { storage: { local } };
  try {
    const { saveRunLog, getRunLog, saveCourseState, resetCourseState } = await import('../lib/storage.js');
    assert.equal(await getRunLog('7139011'), null);
    await saveRunLog('7139011', { version: '2.4.0', scan: ['[22:00:00] Kurs „Implementing Innovation“: 17 Einträge'], export: [] });
    const stored = await getRunLog('7139011');
    assert.deepEqual(stored.scan, ['[22:00:00] Kurs „Implementing Innovation“: 17 Einträge']);
    assert.equal(stored.version, '2.4.0');
    assert.match(stored.savedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(await getRunLog('7193538'), null);

    await saveCourseState({ refId: '7139011', title: 'Implementing Innovation', notebooks: [], items: {} });
    await resetCourseState('7139011');
    assert.equal(await getRunLog('7139011'), null);
  } finally { delete globalThis.chrome; }
});

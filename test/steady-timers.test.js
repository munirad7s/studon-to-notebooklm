import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createSteadyTimers } from '../lib/steady-timers.js';

/** Worker, der sich wie lib/timer-worker.js verhält – mit dem echten Skript, nur ohne eigenen Thread. */
async function realWorkerFactory() {
  const source = await readFile(new URL('../lib/timer-worker.js', import.meta.url), 'utf8');
  return () => {
    const worker = { onmessage: null, onerror: null, posted: [] };
    const self = { postMessage: (data) => worker.onmessage && worker.onmessage({ data }) };
    vm.runInContext(source, vm.createContext({ self, setTimeout }));
    worker.postMessage = (data) => { worker.posted.push(data); self.onmessage({ data }); };
    return worker;
  };
}

test('sleep und setTimeout laufen über den Worker, nicht über die Timer der Seite', async () => {
  const pageTimers = [];
  const timers = createSteadyTimers({
    createWorker: await realWorkerFactory(),
    fallback: { setTimeout: (fn, ms) => { pageTimers.push(ms); return setTimeout(fn, ms); }, clearTimeout },
  });
  const order = [];
  timers.setTimeout(() => order.push('später'), 25);
  timers.setTimeout(() => order.push('früher'), 5);
  await timers.sleep(40);
  assert.deepEqual(order, ['früher', 'später']);
  assert.deepEqual(pageTimers, [], 'die gebremsten Seiten-Timer bleiben unbenutzt');
});

test('clearTimeout verhindert den Aufruf', async () => {
  const timers = createSteadyTimers({ createWorker: await realWorkerFactory() });
  let called = false;
  const id = timers.setTimeout(() => { called = true; }, 5);
  timers.clearTimeout(id);
  await timers.sleep(20);
  assert.equal(called, false);
});

test('Lässt sich kein Worker starten, laufen die Timer der Seite', async () => {
  const timers = createSteadyTimers({ createWorker: () => { throw new Error('Worker blockiert'); } });
  let called = false;
  timers.setTimeout(() => { called = true; }, 5);
  await timers.sleep(20);
  assert.equal(called, true);
});

test('Fällt der Worker später aus, gehen wartende Timer nicht verloren', async () => {
  let worker;
  const timers = createSteadyTimers({ createWorker: () => (worker = { postMessage() {}, onmessage: null, onerror: null }) });
  let called = false;
  timers.setTimeout(() => { called = true; }, 5);
  worker.onerror(new Error('Skript nicht ladbar'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(called, true);
  let after = false;
  timers.setTimeout(() => { after = true; }, 5);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(after, true);
});

test('ready meldet, ob der Worker wirklich läuft', async () => {
  assert.equal(await createSteadyTimers({ createWorker: await realWorkerFactory() }).ready, true);
  assert.equal(await createSteadyTimers({ createWorker: () => { throw new Error('blockiert'); } }).ready, false);
  let worker;
  const broken = createSteadyTimers({ createWorker: () => (worker = { postMessage() {}, onmessage: null, onerror: null }) });
  worker.onerror(new Error('Skript nicht ladbar'));
  assert.equal(await broken.ready, false);
});

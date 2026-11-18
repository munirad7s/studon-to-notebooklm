/**
 * Timer, die auch laufen, wenn der Export-Tab im Hintergrund liegt.
 *
 * Chrome bremst die Timer versteckter Seiten: sofort auf höchstens einen Takt pro Sekunde, nach
 * fünf Minuten auf einen pro Minute. Jede Pause zwischen zwei Abrufen (120 ms beim Scan, 350 ms
 * beim Export) würde so zu einer Minute. Timer in einem Worker sind davon ausgenommen – der
 * Worker zählt die Zeit, die Seite bekommt nur die Nachricht.
 *
 * `createWorker` wird injiziert (im Tab: `new Worker(...)` auf lib/timer-worker.js).
 */

const pageTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export function createSteadyTimers({ createWorker, fallback = pageTimers } = {}) {
  /** id → { fn, ms } für Timer, die beim Worker liegen. */
  const pending = new Map();
  let seq = 0;
  let worker = null;

  /** Ohne Worker weiter mit den Timern der Seite – langsamer im Hintergrund, aber nichts geht verloren. */
  const giveUpWorker = () => {
    worker = null;
    for (const [id, { fn, ms }] of pending) {
      pending.delete(id);
      fallback.setTimeout(fn, ms);
    }
  };

  try {
    worker = createWorker();
    worker.onmessage = (event) => {
      const entry = pending.get(event.data);
      if (!entry) return;
      pending.delete(event.data);
      entry.fn();
    };
    worker.onerror = giveUpWorker;
  } catch {
    worker = null;
  }

  const set = (fn, ms) => {
    if (!worker) return { page: fallback.setTimeout(fn, ms) };
    seq += 1;
    pending.set(seq, { fn, ms });
    worker.postMessage({ id: seq, ms });
    return { steady: seq };
  };

  const clear = (handle) => {
    if (!handle) return;
    if ('steady' in handle) pending.delete(handle.steady);
    else fallback.clearTimeout(handle.page);
  };

  return {
    setTimeout: set,
    clearTimeout: clear,
    sleep: (ms) => new Promise((resolve) => { set(resolve, ms); }),
  };
}

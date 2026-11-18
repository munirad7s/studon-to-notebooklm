// Worker für lib/steady-timers.js: meldet { id, ms } nach ms Millisekunden mit der id zurück.
self.onmessage = (event) => {
  const { id, ms } = event.data;
  setTimeout(() => self.postMessage(id), ms);
};

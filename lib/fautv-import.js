import { clipIdFromUrl, fetchTranscript, resolveFauTvLinks, transcriptToMarkdown } from './fautv.js';
import { sanitizeName } from './ilias.js';
import { wordCount } from './text.js';

function canonical(url) {
  const id = clipIdFromUrl(url);
  if (id) return `https://www.fau.tv/clip/id/${id}`;
  const parsed = new URL(url);
  parsed.protocol = 'https:';
  parsed.hostname = 'www.fau.tv';
  parsed.search = '';
  parsed.hash = '';
  return parsed.href.replace(/\/+$/, '');
}

/** Add manually supplied FAU.tv clips/series to an existing crawler tree. */
export async function appendFauTvSources(tree, urls, { fetch, signal, onProgress = () => {} } = {}) {
  if (!tree || !Array.isArray(tree.children)) throw new Error('FAU.tv import needs a tree with children');
  if (!fetch) throw new Error('FAU.tv import needs fetch');
  const stats = { containers: 0, files: 0, texts: 0, links: 0, skipped: 0, errors: 0, requests: 0 };
  const checkAbort = () => {
    if (signal?.aborted) throw signal.reason || new DOMException('Import abgebrochen', 'AbortError');
  };
  const progress = (message) => onProgress({ message, stats: { ...stats } });
  const countedFetch = async (...args) => {
    checkAbort();
    stats.requests += 1;
    return fetch(...args);
  };
  const seen = new Set();
  const visit = (node) => {
    if (node.kind === 'text') {
      for (const url of [node.video, node.type === 'fautv' && node.url]) {
        if (url) seen.add(canonical(url));
      }
    }
    for (const child of node.children || []) visit(child);
  };
  visit(tree);
  checkAbort();
  progress('FAU.tv-Links und Serien werden gelesen …');
  const resolved = await resolveFauTvLinks(urls, { fetch: countedFetch, signal });
  checkAbort();
  let container = tree.children.find((node) => node.id === 'fautv-imports');
  const append = (node) => {
    if (!container) {
      container = { id: 'fautv-imports', kind: 'container', type: 'fautv', title: 'FAU.tv',
        path: [...(tree.path || []), tree.title].filter(Boolean), children: [], errors: [] };
      tree.children.push(container);
      stats.containers += 1;
    }
    node.path = [...container.path, container.title];
    // A retry replaces the prior failure instead of accumulating skipped rows.
    container.children = container.children.filter((child) => child.id !== node.id);
    container.children.push({ children: [], errors: [], ...node });
  };
  const skip = (url, title, message) => {
    append({ id: `fautv:${encodeURIComponent(url)}`, kind: 'skipped', type: 'fautv',
      refId: url, title: title || url, url, reason: message });
    stats.skipped += 1;
    stats.errors += 1;
    progress(`${title || url}: ${message}`);
  };
  for (const error of resolved.errors) skip(error.url, error.url, error.message);
  for (const clip of resolved.clips) {
    checkAbort();
    const inputUrl = canonical(clip.url);
    if (seen.has(inputUrl)) continue;
    progress(`FAU.tv-Transkript: ${clip.title || clip.url} …`);
    try {
      const transcript = await fetchTranscript(clip.url, { fetch: countedFetch, signal });
      checkAbort();
      const video = transcript.clipId
        ? `https://www.fau.tv/clip/id/${transcript.clipId}` : canonical(transcript.url);
      const aliases = [inputUrl, video, canonical(transcript.url)];
      const duplicate = aliases.some((url) => seen.has(url));
      aliases.forEach((url) => seen.add(url));
      if (duplicate) continue;
      const identity = transcript.clipId || new URL(video).pathname.slice(1);
      const title = `Transkript – ${transcript.title || clip.title} [FAU.tv ${identity}]`;
      const content = transcriptToMarkdown({ ...transcript, url: video });
      // Reserve suffix space, so long titles cannot truncate away the identity.
      const filename = `${sanitizeName(transcript.title || clip.title || 'Transkript', 90)} – ${sanitizeName(identity, 160)}.md`;
      if (container) container.children = container.children.filter((child) => child.id !== `fautv:${encodeURIComponent(inputUrl)}`);
      append({ id: `fautv:${encodeURIComponent(video)}`, kind: 'text', type: 'fautv',
        refId: video, title, legacyTitle: `Transkript – ${transcript.title || clip.title}`,
        filename, video, url: video, content, words: wordCount(content),
        durationSeconds: transcript.durationSeconds, segments: transcript.segments.length });
      stats.texts += 1;
      progress(`FAU.tv-Transkript hinzugefügt: ${transcript.title}`);
    } catch (error) {
      checkAbort();
      if (error.name === 'AbortError') throw error;
      skip(inputUrl, clip.title, error.message);
    }
  }
  progress(`FAU.tv: ${stats.texts} Transkripte hinzugefügt, ${stats.skipped} übersprungen`);
  return stats;
}

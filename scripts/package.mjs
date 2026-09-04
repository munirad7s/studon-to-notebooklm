// Builds dist/studon-to-notebooklm-<version>.zip for "Load unpacked" on another machine.
import { readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

await import('../lib/jszip.min.js');
const JSZip = globalThis.JSZip;

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const include = ['manifest.json', 'background', 'content', 'export', 'icons', 'lib', 'options', 'popup', 'ui'];
const zip = new JSZip();

function addDir(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(root, full).replace(/\\/g, '/');
    if (statSync(full).isDirectory()) addDir(full);
    else zip.file(rel, readFileSync(full));
  }
}

for (const item of include) {
  const full = join(root, item);
  if (statSync(full).isDirectory()) addDir(full);
  else zip.file(item, readFileSync(full));
}

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', `studon-to-notebooklm-${manifest.version}.zip`);
writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`written ${out}`);

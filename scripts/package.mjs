// Builds dist/studon-to-notebooklm-<version>.zip for "Load unpacked" on another machine.
import { readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

await import('../lib/jszip.min.js');
const JSZip = globalThis.JSZip;

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const include = ['manifest.json', 'background', 'content', 'export', 'icons', 'lib', 'options', 'popup', 'ui'];
const zip = new JSZip();

// --- Verweise pruefen, bevor gepackt wird ----------------------------------
// Die v1 war unbrauchbar, weil das Manifest auf eine geloeschte Datei zeigte.
// Chrome meldet das erst beim Laden - hier faellt es sofort auf.

const exists = (rel) => { try { statSync(join(root, rel)); return true; } catch { return false; } };

function manifestReferences(m) {
  const refs = new Set();
  const add = (v) => v && refs.add(v);
  add(m.background?.service_worker);
  add(m.action?.default_popup);
  add(m.options_page);
  Object.values(m.icons || {}).forEach(add);
  Object.values(m.action?.default_icon || {}).forEach(add);
  for (const script of m.content_scripts || []) {
    (script.js || []).forEach(add);
    (script.css || []).forEach(add);
  }
  for (const entry of m.web_accessible_resources || []) {
    for (const resource of entry.resources || []) if (!resource.includes('*')) add(resource);
  }
  return [...refs];
}

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) collectFiles(rel, out);
    else out.push(rel);
  }
  return out;
}

const problems = [];
for (const ref of manifestReferences(manifest)) {
  if (!exists(ref)) problems.push(`Manifest zeigt auf fehlendes ${ref}`);
}

const sourceFiles = include
  .filter((item) => item !== 'manifest.json')
  .filter((item) => exists(item))
  .flatMap((item) => (statSync(join(root, item)).isDirectory() ? collectFiles(item) : [item]));

for (const file of sourceFiles) {
  const text = readFileSync(join(root, file), 'utf8');
  if (file.endsWith('.js') && !file.includes('jszip')) {
    for (const [, spec] of text.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
      const target = relative(root, join(root, file, '..', spec)).replace(/\\/g, '/');
      if (!exists(target)) problems.push(`${file} importiert fehlendes ${spec}`);
    }
  }
  if (file.endsWith('.html')) {
    for (const [, ref] of text.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
      if (/^(https?:|data:|chrome|mailto:)/.test(ref)) continue;
      const target = relative(root, join(root, file, '..', ref.split('?')[0])).replace(/\\/g, '/');
      if (!exists(target)) problems.push(`${file} verweist auf fehlendes ${ref}`);
    }
  }
}

if (problems.length) {
  console.error('Pruefung fehlgeschlagen:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Pruefung ok - ${sourceFiles.length + 1} Dateien, Manifest v${manifest.version}.`);

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

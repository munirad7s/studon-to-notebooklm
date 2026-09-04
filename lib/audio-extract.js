/**
 * Tonspur aus einem MP4 herausloesen - ohne Neukodierung.
 *
 * Vorlesungsaufzeichnungen auf StudOn sind 200-300 MB grosse MP4s; NotebookLM
 * nimmt hoechstens 200 MB pro Datei und wertet ohnehin nur den Ton aus. Die
 * AAC-Spur (typisch 60-90 MB fuer 90 Minuten) reicht also - und laesst sich
 * in Sekunden abtrennen:
 *   1. mp4box.js parst den Container und liefert die Sample-Tabelle der Audiospur
 *      (Offsets/Groessen/Dauern) plus den originalen `mp4a`-Sample-Entry (mit esds).
 *   2. Ein kleiner Muxer schreibt daraus ein reines Audio-MP4 (.m4a):
 *      ftyp + moov (Tabellen stts/stsc/stsz/stco, Sample-Entry byteweise kopiert) + mdat.
 * Der Codec bleibt unangetastet, deshalb funktioniert das fuer AAC-LC, HE-AAC usw.
 *
 * Laeuft im Browser (Export-Tab) und unter Node (Tests) - nur ArrayBuffer/Uint8Array.
 */

import { createFile, MP4BoxBuffer } from './mp4box/mp4box.all.mjs';

export class NoAudioTrackError extends Error {
  constructor(message = 'Keine Audiospur im Video gefunden.') {
    super(message);
    this.name = 'NoAudioTrackError';
  }
}

const MOVIE_TIMESCALE = 1000;
const SAMPLES_PER_CHUNK = 64;

/**
 * @param {ArrayBuffer} arrayBuffer  komplettes MP4
 * @returns {Promise<{ bytes: Uint8Array, info: object }>} .m4a-Daten und Kennzahlen
 */
export async function extractAudioTrack(arrayBuffer) {
  const { file, movie } = parseMp4(arrayBuffer);
  const track = pickAudioTrack(movie);
  if (!track) throw new NoAudioTrackError();

  const samples = file.getTrackSamplesInfo(track.id);
  if (!samples || !samples.length) throw new NoAudioTrackError('Audiospur enthaelt keine Samples.');

  const trak = file.getTrackById(track.id);
  const entry = trak && trak.mdia && trak.mdia.minf.stbl.stsd.entries[0];
  if (!entry || entry.start == null || !entry.size) throw new Error('Sample-Beschreibung der Audiospur nicht lesbar.');
  const sampleEntry = new Uint8Array(arrayBuffer, entry.start, entry.size);

  const bytes = muxAudio({ arrayBuffer, samples, sampleEntry, timescale: track.timescale });
  const durationSeconds = samples.reduce((n, s) => n + (s.duration || 0), 0) / track.timescale;
  return {
    bytes,
    info: {
      codec: track.codec,
      sampleRate: track.audio ? track.audio.sample_rate : null,
      channels: track.audio ? track.audio.channel_count : null,
      durationSeconds,
      samples: samples.length,
      bytes: bytes.byteLength,
      sourceBytes: arrayBuffer.byteLength,
    },
  };
}

/** Bequemer Aufruf fuer den Exporter: Blob rein, Blob raus. */
export async function extractAudioBlob(blob) {
  const { bytes, info } = await extractAudioTrack(await blob.arrayBuffer());
  return { blob: new Blob([bytes], { type: 'audio/mp4' }), info };
}

export function isVideoExtension(ext) {
  return /^(mp4|m4v|mov|3gp|3g2)$/i.test(String(ext || ''));
}

/* ---------- Parsen ---------- */

function parseMp4(arrayBuffer) {
  const file = createFile();
  let movie = null;
  let error = null;
  file.onReady = (info) => { movie = info; };
  file.onError = (module, message) => { error = new Error(`${module}: ${message}`); };
  file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0));
  file.flush();
  if (error) throw new Error(`Kein gueltiges MP4: ${error.message}`);
  if (!movie) throw new Error('Kein gueltiges MP4 (moov nicht gefunden).');
  return { file, movie };
}

function pickAudioTrack(movie) {
  const tracks = (movie.audioTracks || []).filter((t) => t.nb_samples > 0);
  if (!tracks.length) return null;
  // Bei mehreren Spuren die laengste - Kommentarspuren o. ae. sind kuerzer.
  return tracks.sort((a, b) => (b.samples_duration || 0) - (a.samples_duration || 0))[0];
}

/* ---------- Muxen ---------- */

function muxAudio({ arrayBuffer, samples, sampleEntry, timescale }) {
  const totalSampleBytes = samples.reduce((n, s) => n + s.size, 0);
  const trackDuration = samples.reduce((n, s) => n + (s.duration || 0), 0);
  const movieDuration = Math.round((trackDuration / timescale) * MOVIE_TIMESCALE);
  const chunkCount = Math.ceil(samples.length / SAMPLES_PER_CHUNK);

  const ftyp = box('ftyp', [str('M4A '), u32(0), str('M4A '), str('mp42'), str('isom')]);

  // moov zuerst ohne echte Chunk-Offsets bauen, um seine Groesse zu kennen; dann mit Offsets neu.
  const buildMoov = (mdatDataStart) =>
    box('moov', [
      mvhd(movieDuration),
      box('trak', [
        tkhd(movieDuration),
        box('mdia', [
          mdhd(timescale, trackDuration),
          hdlr(),
          box('minf', [
            fullbox('smhd', 0, 0, [u16(0), u16(0)]),
            box('dinf', [fullbox('dref', 0, 0, [u32(1), fullbox('url ', 0, 1, [])])]),
            box('stbl', [
              fullbox('stsd', 0, 0, [u32(1), sampleEntry]),
              stts(samples),
              stsc(samples.length, chunkCount),
              stsz(samples),
              stco(samples, mdatDataStart),
            ]),
          ]),
        ]),
      ]),
    ]);

  const moovSize = buildMoov(0).byteLength;
  const mdatHeader = 8;
  const mdatDataStart = ftyp.byteLength + moovSize + mdatHeader;
  const moov = buildMoov(mdatDataStart);
  if (moov.byteLength !== moovSize) throw new Error('interner Fehler: moov-Groesse instabil');

  const out = new Uint8Array(mdatDataStart + totalSampleBytes);
  out.set(ftyp, 0);
  out.set(moov, ftyp.byteLength);
  out.set(u32(mdatHeader + totalSampleBytes), ftyp.byteLength + moovSize);
  out.set(str('mdat'), ftyp.byteLength + moovSize + 4);
  let pos = mdatDataStart;
  for (const s of samples) {
    out.set(new Uint8Array(arrayBuffer, s.offset, s.size), pos);
    pos += s.size;
  }
  return out;
}

function mvhd(duration) {
  return fullbox('mvhd', 0, 0, [
    u32(0), u32(0),                 // creation, modification
    u32(MOVIE_TIMESCALE), u32(duration),
    u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0),
    matrix(),
    ...Array.from({ length: 6 }, () => u32(0)),
    u32(2),                         // next_track_ID
  ]);
}

function tkhd(duration) {
  return fullbox('tkhd', 0, 3, [
    u32(0), u32(0), u32(1), u32(0), u32(duration),
    u32(0), u32(0), u16(0), u16(0), u16(0x0100), u16(0),
    matrix(),
    u32(0), u32(0),                 // width, height
  ]);
}

function mdhd(timescale, duration) {
  if (duration > 0xffffffff) {
    return fullbox('mdhd', 1, 0, [u64(0), u64(0), u32(timescale), u64(duration), u16(0x55c4), u16(0)]);
  }
  return fullbox('mdhd', 0, 0, [u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)]);
}

function hdlr() {
  return fullbox('hdlr', 0, 0, [u32(0), str('soun'), u32(0), u32(0), u32(0), str('SoundHandler'), u8(0)]);
}

function stts(samples) {
  const runs = [];
  for (const s of samples) {
    const d = s.duration || 0;
    const last = runs[runs.length - 1];
    if (last && last.delta === d) last.count += 1;
    else runs.push({ count: 1, delta: d });
  }
  return fullbox('stts', 0, 0, [u32(runs.length), ...runs.flatMap((r) => [u32(r.count), u32(r.delta)])]);
}

function stsc(sampleCount, chunkCount) {
  const entries = [[1, Math.min(SAMPLES_PER_CHUNK, sampleCount)]];
  const rest = sampleCount % SAMPLES_PER_CHUNK;
  if (chunkCount > 1 && rest) entries.push([chunkCount, rest]);
  return fullbox('stsc', 0, 0, [u32(entries.length), ...entries.flatMap(([first, per]) => [u32(first), u32(per), u32(1)])]);
}

function stsz(samples) {
  return fullbox('stsz', 0, 0, [u32(0), u32(samples.length), ...samples.map((s) => u32(s.size))]);
}

function stco(samples, dataStart) {
  const offsets = [];
  let pos = dataStart;
  samples.forEach((s, i) => {
    if (i % SAMPLES_PER_CHUNK === 0) offsets.push(pos);
    pos += s.size;
  });
  return fullbox('stco', 0, 0, [u32(offsets.length), ...offsets.map((o) => u32(o))]);
}

/* ---------- Byte-Helfer ---------- */

function box(type, parts) {
  const body = concat(parts);
  return concat([u32(8 + body.byteLength), str(type), body]);
}

function fullbox(type, version, flags, parts) {
  return box(type, [u8(version), u8((flags >> 16) & 0xff), u8((flags >> 8) & 0xff), u8(flags & 0xff), ...parts]);
}

function matrix() {
  return concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  return out;
}

function u8(v) { return new Uint8Array([v & 0xff]); }
function u16(v) { return new Uint8Array([(v >> 8) & 0xff, v & 0xff]); }
function u32(v) { return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]); }
function u64(v) { const hi = Math.floor(v / 0x100000000); const lo = v >>> 0; return concat([u32(hi), u32(lo)]); }
function str(s) { return new TextEncoder().encode(s); }

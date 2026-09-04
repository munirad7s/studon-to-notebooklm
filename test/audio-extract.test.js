import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractAudioTrack, isVideoExtension, NoAudioTrackError } from '../lib/audio-extract.js';

const FIXTURE = new URL('./fixtures/sample-av.mp4', import.meta.url);

function fixtureBuffer() {
  const bytes = readFileSync(FIXTURE);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function boxTypes(bytes) {
  const types = [];
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (pos + 8 <= bytes.byteLength) {
    const size = view.getUint32(pos);
    types.push(String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)));
    if (!size) break;
    pos += size;
  }
  return types;
}

function ffprobeAvailable() {
  try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

test('extractAudioTrack liefert ein reines Audio-MP4 mit den Originaldaten', async () => {
  const { bytes, info } = await extractAudioTrack(fixtureBuffer());
  assert.deepEqual(boxTypes(bytes), ['ftyp', 'moov', 'mdat']);
  assert.equal(info.codec, 'mp4a.40.2');
  assert.equal(info.sampleRate, 44100);
  assert.equal(info.channels, 1);
  assert.equal(info.samples, 131);
  assert.ok(Math.abs(info.durationSeconds - 3.04) < 0.1, `Dauer ${info.durationSeconds}`);
  assert.ok(bytes.byteLength < info.sourceBytes, 'kleiner als das Video');
  assert.ok(bytes.byteLength > 12000, 'enthaelt die AAC-Frames');
  // Sample-Entry (mp4a + esds) wurde byteweise uebernommen
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, 4000));
  assert.ok(text.includes('mp4a') && text.includes('esds'), 'mp4a/esds im moov');
  assert.ok(text.includes('soun'), 'Sound-Handler');
});

test('das erzeugte m4a wird von ffprobe als AAC ohne Videospur erkannt', { skip: !ffprobeAvailable() && 'ffprobe nicht installiert' }, async () => {
  const { bytes } = await extractAudioTrack(fixtureBuffer());
  const dir = mkdtempSync(join(tmpdir(), 's2n-audio-'));
  const path = join(dir, 'out.m4a');
  writeFileSync(path, bytes);
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,sample_rate,channels:format=duration', '-of', 'compact', path]).toString();
  assert.match(out, /codec_name=aac\|codec_type=audio\|sample_rate=44100\|channels=1/);
  assert.equal(out.includes('codec_type=video'), false, 'keine Videospur');
  assert.match(out, /duration=3\.0/);
});

test('ohne Audiospur oder bei Nicht-MP4 kommt ein klarer Fehler', async () => {
  await assert.rejects(extractAudioTrack(new Uint8Array(64).buffer), /MP4|moov|Sample/);
  assert.ok(new NoAudioTrackError() instanceof Error);
  assert.equal(isVideoExtension('mp4'), true);
  assert.equal(isVideoExtension('MOV'), true);
  assert.equal(isVideoExtension('mp3'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRepoLink, isDownloadLink, sanitizeName, parseSize, typeFromIcon,
  filenameFromContentDisposition, looksLikeLogin, fileDownloadUrl, isYouTubeUrl, extensionOf,
} from '../lib/ilias.js';

test('parseRepoLink handles ILIAS 9 /go/ links', () => {
  assert.deepEqual(parseRepoLink('https://www.studon.fau.de/studon/go/fold/6071389'), { type: 'fold', refId: '6071389' });
  assert.deepEqual(parseRepoLink('https://www.studon.fau.de/studon/go/crs/234016'), { type: 'crs', refId: '234016' });
  assert.deepEqual(parseRepoLink('https://www.studon.fau.de/studon/go/lm/6815119_12'), { type: 'lm', refId: '6815119' });
});

test('parseRepoLink handles goto.php and ref_id links', () => {
  assert.deepEqual(parseRepoLink('goto.php?target=file_123_download'), { type: 'file', refId: '123' });
  assert.deepEqual(parseRepoLink('https://www.studon.fau.de/studon/goto.php?target=crs_99&client_id=StudOn'), { type: 'crs', refId: '99' });
  assert.deepEqual(parseRepoLink('ilias.php?baseClass=ilrepositorygui&amp;cmd=infoScreen&amp;ref_id=234016'), { type: null, refId: '234016' });
  assert.deepEqual(parseRepoLink('ilias.php?baseClass=ilLMPresentationGUI&ref_id=6815119&obj_id=5'), { type: 'lm', refId: '6815119' });
  assert.equal(parseRepoLink('https://www.fau.tv'), null);
  assert.equal(parseRepoLink('#'), null);
});

test('isDownloadLink recognises file deliveries but not folder zips or certificates', () => {
  assert.equal(isDownloadLink('ilias.php?baseClass=ilLMPresentationGUI&ref_id=1&obj_id=2&cmd=downloadFile&file_id=3'), true);
  assert.equal(isDownloadLink('https://www.studon.fau.de/studon/goto.php?target=file_123_download'), true);
  assert.equal(isDownloadLink('ilias.php?baseClass=ilExerciseHandlerGUI&ref_id=5&cmd=downloadFile&ass_id=7&file=blatt1.pdf'), true);
  assert.equal(isDownloadLink('ilias.php?baseClass=ilrepositorygui&cmd=sendfile&ref_id=42'), true);
  assert.equal(isDownloadLink('ilias.php?baseClass=ilrepositorygui&cmd=download&ref_id=6071389'), false);
  assert.equal(isDownloadLink('ilias.php?baseClass=ilrepositorygui&cmd=downloadCertificate&ref_id=1'), false);
  assert.equal(isDownloadLink('https://www.studon.fau.de/studon/go/file/123'), false);
  assert.equal(isDownloadLink('javascript:void(0)'), false);
});

test('sanitizeName strips size suffix and illegal characters', () => {
  assert.equal(sanitizeName('HCI_SS_2026_01.pdf (5,15 MB)'), 'HCI_SS_2026_01.pdf');
  assert.equal(sanitizeName('Übung: 1 / Lösung?'), 'Übung_ 1 _ Lösung_');
  assert.equal(sanitizeName('   '), 'untitled');
  assert.equal(sanitizeName('a'.repeat(400)).length, 150);
});

test('parseSize understands German and English formats', () => {
  assert.equal(parseSize('2,04 MB'), Math.round(2.04 * 1024 * 1024));
  assert.equal(parseSize('450 KB'), 450 * 1024);
  assert.equal(parseSize('12 Bytes'), 12);
  assert.equal(parseSize('1.5 GB'), Math.round(1.5 * 1024 ** 3));
  assert.equal(parseSize('Gestern, 14:11'), null);
});

test('typeFromIcon reads icon src or German alt text', () => {
  assert.equal(typeFromIcon('./Customizing/global/skin/studon9skin/studon9style/images/standard/icon_fold.svg', 'Ordner'), 'fold');
  assert.equal(typeFromIcon('', 'Lernmodul'), 'lm');
  assert.equal(typeFromIcon('', 'Datei'), 'file');
  assert.equal(typeFromIcon('', 'unbekannt'), null);
});

test('filenameFromContentDisposition handles RFC 5987 and quoted names', () => {
  assert.equal(filenameFromContentDisposition("attachment; filename*=UTF-8''%C3%9Cbung%201.pdf"), 'Übung 1.pdf');
  assert.equal(filenameFromContentDisposition('attachment; filename="lecture.pdf"'), 'lecture.pdf');
  assert.equal(filenameFromContentDisposition('inline; filename=notes.txt'), 'notes.txt');
  assert.equal(filenameFromContentDisposition(''), null);
});

test('looksLikeLogin detects SSO redirects and login forms', () => {
  assert.equal(looksLikeLogin('https://www.sso.uni-erlangen.de/simplesaml/module.php/core/loginuserpass.php', ''), true);
  assert.equal(looksLikeLogin('https://www.studon.fau.de/studon/ilias.php?ref_id=1', '<input name="password" type="password">'), true);
  assert.equal(looksLikeLogin('https://www.studon.fau.de/studon/ilias.php?ref_id=1', '<div class="il-std-item">x</div>'), false);
});

test('misc helpers', () => {
  assert.equal(fileDownloadUrl('77'), 'https://www.studon.fau.de/studon/goto.php?target=file_77_download');
  assert.equal(isYouTubeUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(isYouTubeUrl('https://youtu.be/abc'), true);
  assert.equal(isYouTubeUrl('https://www.fau.tv/clip/1'), false);
  assert.equal(extensionOf('Folien.PDF'), 'pdf');
  assert.equal(extensionOf('noext'), '');
});

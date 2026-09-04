import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotebookLMClient, NotLoggedInError, RpcError, parseBatchResponse, extractRpcResult, parseSourceList, SOURCE_STATUS } from '../lib/nlm-client.js';

const HOME = 'https://notebook.google.com/';
const HOME_HTML = '<html><script>WIZ_global_data = {"SNlM0e":"AFvR:123","cfb2h":"boq_labs_2026","FdrFJe":"-12345","oPEP7c":"munir@example.com"};</script></html>';

function wrb(rpcId, result, error = null) {
  const inner = JSON.stringify([['wrb.fr', rpcId, result == null ? null : JSON.stringify(result), null, null, error, 'generic']]);
  return `)]}'\n\n${inner.length}\n${inner}\n25\n[["di",12],["af.httprm",12,"123",1]]\n`;
}

function makeFetch(handlers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    for (const [match, handler] of handlers) {
      if (typeof match === 'string' ? url.startsWith(match) : match.test(url)) return handler(url, init);
    }
    throw new Error(`unhandled ${url}`);
  };
  fetch.calls = calls;
  return fetch;
}

const homeHandler = [HOME, () => ({ ok: true, status: 200, url: HOME, text: async () => HOME_HTML, headers: new Map() })];
const loginRedirect = ['https://notebooklm.google.com/', () => ({ ok: true, status: 200, url: HOME, text: async () => HOME_HTML, headers: new Map() })];

test('parseBatchResponse strips the XSSI prefix and reads sized chunks', () => {
  const chunks = parseBatchResponse(wrb('wXbhsf', [[['NB', [], 'id-1']]]));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0][0][0], 'wrb.fr');
});

test('extractRpcResult returns parsed result and raises typed errors', () => {
  const ok = extractRpcResult(parseBatchResponse(wrb('CCqFvf', ['T', null, 'nb-1'])), 'CCqFvf');
  assert.deepEqual(ok, ['T', null, 'nb-1']);
  const err = assert.throws(() => extractRpcResult(parseBatchResponse(wrb('izAoDd', null, [8, null, [['type.googleapis.com/google.rpc.ErrorInfo', ['QUOTA']]]])), 'izAoDd'), RpcError);
  assert.throws(() => extractRpcResult(parseBatchResponse(wrb('izAoDd', null, [8, null, []])), 'izAoDd'), (e) => e instanceof RpcError && e.isQuota);
  assert.throws(() => extractRpcResult(parseBatchResponse(wrb('other', [])), 'izAoDd'), /rotiert/);
  assert.equal(err, undefined);
});

test('init follows the redirect, extracts tokens and detects logged-out state', async () => {
  const fetch = makeFetch([loginRedirect]);
  const c = new NotebookLMClient({ fetch });
  const info = await c.init();
  assert.equal(info.base, 'https://notebook.google.com');
  assert.equal(c.at, 'AFvR:123');
  assert.equal(c.bl, 'boq_labs_2026');
  assert.equal(c.sid, '-12345');
  assert.equal(info.email, 'munir@example.com');

  const out = makeFetch([['https://notebooklm.google.com/', () => ({ ok: true, status: 200, url: 'https://accounts.google.com/v3/signin/identifier?x', text: async () => '' })]]);
  await assert.rejects(new NotebookLMClient({ fetch: out }).init(), NotLoggedInError);
});

test('rpc builds the batchexecute request exactly like the web app', async () => {
  const fetch = makeFetch([
    loginRedirect,
    [/batchexecute/, (url, init) => {
      const u = new URL(url);
      assert.equal(u.searchParams.get('rpcids'), 'CCqFvf');
      assert.equal(u.searchParams.get('bl'), 'boq_labs_2026');
      assert.equal(u.searchParams.get('f.sid'), '-12345');
      assert.equal(u.searchParams.get('rt'), 'c');
      assert.equal(u.searchParams.get('source-path'), '/');
      assert.equal(init.method, 'POST');
      assert.equal(init.credentials, 'include');
      assert.equal(init.headers['X-Same-Domain'], '1');
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('at'), 'AFvR:123');
      const freq = JSON.parse(body.get('f.req'));
      assert.equal(freq[0][0][0], 'CCqFvf');
      assert.deepEqual(JSON.parse(freq[0][0][1]), ['Mein Kurs', null, null, [2], [1, null, null, null, null, null, null, null, null, null, [1]]]);
      return { ok: true, status: 200, url, text: async () => wrb('CCqFvf', ['Mein Kurs', null, 'nb-42']) };
    }],
  ]);
  const c = new NotebookLMClient({ fetch });
  const nb = await c.createNotebook('Mein Kurs');
  assert.deepEqual(nb, { id: 'nb-42', title: 'Mein Kurs' });
});

test('listNotebooks and getNotebook parse the nested arrays', async () => {
  const listResult = [[
    ['HCI', [[['s1'], 'Folien.pdf']], 'nb-1', '📘', null, [1, false, true, null, null, [1756000000, 0]]],
    ['Shared', [], 'nb-2', null, null, [2]],
  ]];
  const nbResult = [['HCI', [
    [['s1'], 'Folien.pdf', [null, null, null, null, 3, null, null, null], [null, 2]],
    [['s2'], 'Notes', [null, null, null, null, 4], [null, 1]],
    [['s3'], 'Drive Doc', [['doc-9'], null, null, null, 1], [null, 2]],
  ], 'nb-1']];
  const fetch = makeFetch([
    loginRedirect,
    [/rpcids=wXbhsf/, (url) => ({ ok: true, status: 200, url, text: async () => wrb('wXbhsf', listResult) })],
    [/rpcids=rLM1Ne/, (url) => ({ ok: true, status: 200, url, text: async () => wrb('rLM1Ne', nbResult) })],
  ]);
  const c = new NotebookLMClient({ fetch });
  const list = await c.listNotebooks();
  assert.equal(list.length, 2);
  assert.equal(list[0].title, 'HCI');
  assert.equal(list[0].sourceCount, 1);
  assert.equal(list[0].owned, true);
  assert.equal(list[1].owned, false);
  const nb = await c.getNotebook('nb-1');
  assert.equal(nb.sources.length, 3);
  assert.equal(nb.sources[0].status, SOURCE_STATUS.READY);
  assert.equal(nb.sources[1].status, SOURCE_STATUS.PROCESSING);
  assert.equal(nb.sources[2].driveDocId, 'doc-9');
});

test('uploadFile performs the three-step resumable upload', async () => {
  const seen = [];
  const fetch = makeFetch([
    loginRedirect,
    [/rpcids=o4cbdc/, (url, init) => {
      const params = JSON.parse(JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0][1]);
      assert.deepEqual(params[0], [['Folien.pdf']]);
      assert.equal(params[1], 'nb-1');
      return { ok: true, status: 200, url, text: async () => wrb('o4cbdc', [['src-77']]) };
    }],
    ['https://notebook.google.com/upload/_/', (url, init) => {
      seen.push('start');
      assert.equal(init.headers['x-goog-upload-command'], 'start');
      assert.equal(init.headers['x-goog-upload-header-content-length'], '3');
      assert.deepEqual(JSON.parse(init.body), { PROJECT_ID: 'nb-1', SOURCE_NAME: 'Folien.pdf', SOURCE_ID: 'src-77' });
      return { ok: true, status: 200, url, headers: new Map([['x-goog-upload-url', 'https://notebook.google.com/upload/session/abc']]), text: async () => '' };
    }],
    ['https://notebook.google.com/upload/session/abc', (url, init) => {
      seen.push('bytes');
      assert.equal(init.headers['x-goog-upload-command'], 'upload, finalize');
      assert.equal(init.body.size, 3);
      return { ok: true, status: 200, url, text: async () => '' };
    }],
  ]);
  const c = new NotebookLMClient({ fetch });
  const result = await c.uploadFile('nb-1', 'Folien.pdf', new Blob(['abc']));
  assert.deepEqual(result, { id: 'src-77', title: 'Folien.pdf' });
  assert.deepEqual(seen, ['start', 'bytes']);
});

test('addUrlSources falls back to the v2 RPC and remembers it', async () => {
  let v1Calls = 0;
  const fetch = makeFetch([
    loginRedirect,
    [/rpcids=izAoDd/, (url) => { v1Calls += 1; return { ok: true, status: 200, url, text: async () => wrb('izAoDd', null, [3, null, []]) }; }],
    [/rpcids=rLM1Ne/, (url) => ({ ok: true, status: 200, url, text: async () => wrb('rLM1Ne', [['HCI', [], 'nb-1']]) })],
    [/rpcids=ozz5Z/, (url) => ({ ok: true, status: 200, url, text: async () => wrb('ozz5Z', [[[['u1'], 'Example']]]) })],
  ]);
  const c = new NotebookLMClient({ fetch, sleep: async () => {} });
  const added = await c.addUrlSources('nb-1', ['https://example.org']);
  assert.deepEqual(added, [{ id: 'u1', title: 'Example' }]);
  assert.equal(c.urlSourceVersion, 'v2');
  await c.addUrlSources('nb-1', ['https://example.org/2']);
  assert.equal(v1Calls, 1);
});

test('rpc re-initialises tokens once on auth error code 16', async () => {
  let inits = 0;
  let calls = 0;
  const fetch = makeFetch([
    [/rpcids=wXbhsf/, (url) => {
      calls += 1;
      return { ok: true, status: 200, url, text: async () => (calls === 1 ? wrb('wXbhsf', null, [16, null, []]) : wrb('wXbhsf', [[]])) };
    }],
    ['https://notebooklm.google.com/', () => { inits += 1; return { ok: true, status: 200, url: HOME, text: async () => HOME_HTML }; }],
    [HOME, () => { inits += 1; return { ok: true, status: 200, url: HOME, text: async () => HOME_HTML }; }],
  ]);
  const c = new NotebookLMClient({ fetch, sleep: async () => {} });
  const list = await c.listNotebooks();
  assert.deepEqual(list, []);
  assert.equal(inits, 2);
  assert.equal(calls, 2);
});

test('parseSourceList tolerates unexpected shapes', () => {
  assert.deepEqual(parseSourceList(null), { id: null, title: '', sources: [] });
  assert.deepEqual(parseSourceList([['T', 'garbage', 'id']]), { id: 'id', title: 'T', sources: [] });
});

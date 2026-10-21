const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');

class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
function gateway(handler) {
  const filename = path.resolve(__dirname, '../src/lib/activity-logs.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, URLSearchParams,
    require(name) { assert.equal(name, './api'); return { apiRequest: handler, ApiError }; },
  }, { filename });
  return module.exports;
}
const empty = { search: '', role: '', result: '', from: '', to: '', offset: 0 };

test('each portal requests its own backend endpoint with encoded filters and pagination', async () => {
  const calls = [];
  const api = gateway(async url => { calls.push(url); return { items: [], has_more: false }; });
  for (const portal of ['management', 'maintenance']) {
    await api.getActivityLogs(portal, { ...empty, search: 'repair & review', role: portal,
      result: 'failed', from: '2026-10-20', to: '2026-10-21', offset: 40 });
    const url = new URL(calls.at(-1), 'https://fixture.example');
    assert.equal(url.pathname, `/api/v1/${portal}/activity-logs`);
    assert.equal(url.searchParams.get('search'), 'repair & review');
    assert.equal(url.searchParams.get('role'), portal);
    assert.equal(url.searchParams.get('limit'), '20');
    assert.equal(url.searchParams.get('offset'), '40');
    assert.equal(url.searchParams.get('from'), '2026-10-20');
    assert.equal(url.searchParams.get('to'), '2026-10-21');
  }
});

test('empty history is preserved and malformed data is an error', async () => {
  assert.equal((await gateway(async () => ({ items: [], has_more: false })).getActivityLogs('maintenance', empty)).items.length, 0);
  for (const value of [{}, { items: {}, has_more: false }, { items: [], has_more: 'yes' }]) {
    await assert.rejects(gateway(async () => value).getActivityLogs('maintenance', empty), /could not be loaded/);
  }
});

test('backend unavailable and access denied never turn into an empty or demo history', async () => {
  for (const status of [403, 503]) {
    await assert.rejects(gateway(async () => { throw new ApiError('Denied or unavailable', status); }).getActivityLogs('management', empty), { status });
  }
  await assert.rejects(gateway(async () => { throw new ApiError('Missing endpoint', 404); }).getActivityLogs('maintenance', empty), /not available yet/);
});

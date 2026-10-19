/* global __dirname */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/api.ts'), 'utf8');
let expire, timeoutMs, cleared = 0, calls = 0, behavior = 'success';
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  module: mod, exports: mod.exports, AbortController, FormData,
  require: name => { assert.equal(name, './multipartUpload'); return { uploadMultipart() { throw Error('No upload in route calculation'); } }; },
  process: { env: { EXPO_PUBLIC_API_URL: 'https://example.invalid' } },
  setTimeout(fn, ms) { expire = fn; timeoutMs = ms; return 1; },
  clearTimeout() { cleared++; },
  fetch: async (url, options) => {
    calls++;
    if (behavior === 'timeout') return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('aborted'))));
    if (behavior === 'unauthorized') return { ok: false, status: 401, text: async () => JSON.stringify({ detail: 'Invalid credentials' }) };
    assert.equal(url, 'https://example.invalid/api/v1/navigation/areas/kl-east-pilot/demo-routes');
    assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, 'Bearer synthetic');
    return { ok: true, status: 200, text: async () => JSON.stringify({ options: [] }) };
  },
});
async function main() {
  const { demoAreasApi, healthApi } = mod.exports;
  await demoAreasApi.getRoutes('synthetic', 'kl-east-pilot', {});
  assert.equal(timeoutMs, 90000); assert.equal(cleared, 1);
  behavior = 'timeout'; let before = calls;
  const pending = demoAreasApi.getRoutes('synthetic', 'kl-east-pilot', {}); expire();
  await assert.rejects(pending, e => e.status === 0 && /Route calculation took too long/.test(e.message));
  assert.equal(calls, before + 1, 'No hidden or unbounded retries'); assert.equal(cleared, 2);
  behavior = 'unauthorized';
  await assert.rejects(demoAreasApi.getRoutes('synthetic', 'kl-east-pilot', {}), e => e.status === 401 && e.message === 'Invalid credentials');
  behavior = 'timeout';
  const health = healthApi.check(); assert.equal(timeoutMs, 60000); expire();
  await assert.rejects(health, /Please check your connection/);
  console.log('PASS: cold-route timeout, specific message, timer cleanup, auth errors and other request limits');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

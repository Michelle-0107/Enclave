/* global __dirname */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
const { featureFilter, validateStyleMin } = require('@maplibre/maplibre-gl-style-spec');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/navigation/nativeMapStyle.ts'), 'utf8');
const fixture = () => ({
  version: 8, glyphs: 'https://example.invalid/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://example.invalid/sprites',
  sources: { openmaptiles: { type: 'vector', tiles: ['https://example.invalid/{z}/{x}/{y}.pbf'] } },
  layers: [
    { id: 'park_outline', type: 'line', source: 'openmaptiles', 'source-layer': 'park', paint: { 'line-color': '#0f0' } },
    { id: 'park_label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'park', layout: { 'text-field': '{name}', 'text-font': ['Noto Sans Regular'] } },
    { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
  ],
});
function load(fetch) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, fetch, AbortController, setTimeout, clearTimeout, Map });
  return module.exports;
}
async function main() {
  const { normalizeNativeMapStyle } = load(() => { throw Error('Unexpected download'); });
  const original = fixture(), snapshot = JSON.stringify(original), fixed = normalizeNativeMapStyle(original);
  assert.equal(JSON.stringify(original), snapshot, 'Do not mutate the cached source style');
  assert.equal(validateStyleMin(fixed).length, 0, 'The corrected style must remain valid');
  const matches = featureFilter(fixed.layers[0].filter, 'layers[0].filter').filter;
  assert.equal(matches({ zoom: 12 }, { type: 1, properties: {} }), false, 'Park label points cannot be line features');
  for (const type of [2, 3]) assert.equal(matches({ zoom: 12 }, { type, properties: {} }), true, 'Keep park lines and polygon outlines');
  assert.equal(fixed.layers[1], original.layers[1], 'Keep park names');
  assert.equal(fixed.layers[2], original.layers[2], 'Do not alter road geometry');
  assert.equal(fixed.sources, original.sources);
  assert.equal(fixed.glyphs, original.glyphs);
  assert.equal(fixed.sprite, original.sprite);

  const filtered = fixture(); filtered.layers[0].filter = ['==', ['get', 'class'], 'national_park'];
  const restricted = featureFilter(normalizeNativeMapStyle(filtered).layers[0].filter, 'layers[0].filter').filter;
  assert.equal(restricted({ zoom: 12 }, { type: 3, properties: { class: 'national_park' } }), true);
  assert.equal(restricted({ zoom: 12 }, { type: 3, properties: { class: 'other' } }), false, 'Retain existing filters');
  assert.equal(restricted({ zoom: 12 }, { type: 1, properties: { class: 'national_park' } }), false);

  let requests = 0;
  const loader = load(async () => { requests++; return { ok: true, json: async () => fixture() }; });
  const first = loader.loadNativeMapStyle('https://example.invalid/style');
  assert.equal(first, loader.loadNativeMapStyle('https://example.invalid/style'), 'Deduplicate concurrent map screens');
  const loaded = await first;
  assert.equal(await loader.loadNativeMapStyle('https://example.invalid/style'), loaded);
  assert.equal(requests, 1);

  let attempt = 0;
  const retry = load(async () => ++attempt === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => fixture() });
  await assert.rejects(retry.loadNativeMapStyle('https://example.invalid/retry'), /503/);
  await retry.loadNativeMapStyle('https://example.invalid/retry');
  assert.equal(attempt, 2, 'A failed download must not poison the cache');
  const invalid = load(async () => ({ ok: true, json: async () => ({ message: 'Service unavailable' }) }));
  await assert.rejects(invalid.loadNativeMapStyle('https://example.invalid/bad'), /invalid style/);
  console.log('PASS: native map filters, unchanged roads/labels, shared downloads, retries and invalid responses');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

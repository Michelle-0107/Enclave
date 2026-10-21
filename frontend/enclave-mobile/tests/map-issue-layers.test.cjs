const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../src/lib/map-issue-layers.ts'), 'utf8');
const moduleRef = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleRef, exports: moduleRef.exports, Map });
const { mapIssueLayers } = moduleRef.exports;

const confirmed = {
  id: 'confirmed', geometry: { coordinates: [101.7307, 3.2264] },
  properties: { facility_name: 'Confirmed road', facility_type: 'path_surface', fault_kind: 'damage', reporter_count: 2 },
};
const pending = {
  id: 'pending', latitude: 3.2265, longitude: 101.7308,
  facility_name: 'Unnamed footway road · Section 186', facility_type: 'path_surface',
  fault_kind: 'damage', status: 'open', reporter_count: 1,
};

test('one linked resident appears as a pending map marker without becoming confirmed', () => {
  const markers = mapIssueLayers([confirmed], [pending]);
  assert.equal(markers.length, 2);
  assert.deepEqual(Array.from(markers[1].coordinates), [101.7308, 3.2265]);
  assert.equal(markers[1].confirmed, false);
  assert.equal(markers[1].reporterCount, 1);
  assert.equal(markers[0].confirmed, true);
});

test('confirmed endpoint wins and discovery cannot invent confirmed markers', () => {
  const sameId = { ...pending, id: 'confirmed', reporter_count: 1 };
  const unverifiedTwo = { ...pending, id: 'discovery-only-two', reporter_count: 2 };
  const resolved = { ...pending, id: 'resolved', status: 'resolved' };
  const markers = mapIssueLayers([confirmed], [sameId, unverifiedTwo, resolved]);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].confirmed, true);
  assert.equal(markers[0].reporterCount, 2);
});

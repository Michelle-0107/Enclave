const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { createRequire } = require('node:module');
const web = path.resolve(__dirname, '..');
const fromWeb = createRequire(path.join(web, 'package.json'));
const ts = fromWeb('typescript');
function load(relative, dependencies = {}) {
  const filename = path.join(web, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(output, { module: mod, exports: mod.exports,
    require(name) { return name in dependencies ? dependencies[name] : fromWeb(name); },
  }, { filename });
  return mod.exports;
}
const view = load('src/lib/repairRouteView.ts');
const points = [[101.7304, 3.2254], [101.7304, 3.2256], [101.7308, 3.2256]];
const route = distance => ({ state: 'available', distance_meters: distance,
  geometry: { type: 'LineString', coordinates: points } });
const baseline = [
  { path_id: 'one', path_name: 'Journey 1', route_mode: 'avoid_damage', current: route(200) },
  { path_id: 'one', path_name: 'Journey 1', route_mode: 'accessible', current: { state: 'not_assessable' } },
];
const paths = [
  { path_id: 'one', path_name: 'Journey 1', route_mode: 'avoid_damage', after: route(150), effect: 'shortened' },
  { path_id: 'one', path_name: 'Journey 1', route_mode: 'accessible', after: { state: 'not_assessable' }, effect: 'not_assessable' },
];
test('shows real before/after geometry and distance for each path and mode', () => {
  const rows = view.repairPathViews(baseline, paths);
  assert.equal(rows.length, 2);
  assert.equal(view.routeDistance(rows[0].before.route), '200 m');
  assert.equal(view.routeDistance(rows[0].after.route), '150 m');
  assert.equal(view.routeCoordinates(rows[0].after.route), points);
  assert.equal(view.routeChange(rows[0]), '50 m shorter');
});
test('old backend accessible results use explicitly marked walking references', () => {
  const before = JSON.stringify({ baseline, paths });
  const rows = view.repairPathViews(baseline, paths);
  assert.equal(rows[1].before.reference, true);
  assert.equal(rows[1].after.reference, true);
  assert.equal(rows[1].after.state, 'not_assessable');
  assert.equal(view.routeChange(rows[1]), 'Walking reference: 50 m shorter');
  assert.equal(JSON.stringify({ baseline, paths }), before);
});
test('accessible-only results use new backend fallback without requiring a walking row', () => {
  const fallback = { ...route(120), route_mode: 'avoid_damage', reference_only: true, accessibility_verified: false };
  const rows = view.repairPathViews([{ ...baseline[1], current: { state: 'not_assessable', fallback } }],
    [{ ...paths[1], after: { state: 'not_assessable', fallback } }]);
  assert.equal(rows[0].after.reference, true);
  assert.equal(view.routeDistance(rows[0].after.route), '120 m');
});
test('available accessible route is kept instead of a walking fallback', () => {
  const rows = view.repairPathViews([{ ...baseline[1], current: route(230) }],
    [{ ...paths[1], after: route(210) }, paths[0]]);
  assert.equal(rows[0].after.reference, false);
  assert.equal(view.routeDistance(rows[0].after.route), '210 m');
});
test('missing and invalid geometry never creates a straight invented route', () => {
  assert.equal(view.routeCoordinates(null).length, 0);
  assert.equal(view.routeCoordinates({ geometry: { coordinates: [[Infinity, 3], [101, 3]] } }).length, 0);
  assert.equal(view.routeCoordinates({ geometry: { coordinates: [[181, 3], [101, 3]] } }).length, 0);
});
test('a legacy longer result is labelled as longer instead of negative metres saved', () => {
  const rows = view.repairPathViews(baseline, [{ ...paths[0], after: route(206), effect: 'longer' }]);
  assert.equal(view.routeChange(rows[0]), '6 m longer');
});
test('distance labels are placed on the midpoint of the polyline', () => {
  const midpoint = view.lineMidpoint([[101.7304, 3.2254], [101.7308, 3.2254]]);
  assert.ok(Math.abs(midpoint[0] - 101.7306) < 1e-8);
  assert.equal(midpoint[1], 3.2254);
  assert.equal(view.lineMidpoint([]), null);
});
test('plan renders path selectors, both distances, legend and reference warning', () => {
  const Component = load('src/components/management/RepairPlanRoutes.tsx', {
    '@/lib/repairRouteView': view, 'maplibre-gl/dist/maplibre-gl.css': {},
  }).default;
  const React = fromWeb('react');
  const { renderToStaticMarkup } = fromWeb('react-dom/server');
  const html = renderToStaticMarkup(React.createElement(Component, { baseline,
    plan: { id: 'plan1', name: 'Repair plan 1', paths } }));
  for (const label of ['Journey 1', 'Before repairs: ', 'After repairs: ', '200 m', '150 m',
    'Dashed orange', 'Solid teal', 'accessibility unverified']) {
    assert.ok(html.includes(label), label);
  }
});

test('selected accessible fallback shows wheelchair warning', () => {
  const Component = load('src/components/management/RepairPlanRoutes.tsx', {
    '@/lib/repairRouteView': view, 'maplibre-gl/dist/maplibre-gl.css': {},
  }).default;
  const fallback = { ...route(200), route_mode: 'avoid_damage', reference_only: true, accessibility_verified: false };
  const React = fromWeb('react');
  const { renderToStaticMarkup } = fromWeb('react-dom/server');
  const html = renderToStaticMarkup(React.createElement(Component, {
    baseline: [{ ...baseline[1], current: { state: 'not_assessable', fallback } }],
    plan: { id: 'plan1', name: 'Repair plan 1', paths: [{ ...paths[1], after: { state: 'not_assessable', fallback } }] },
  }));
  assert.ok(html.includes('not verified for wheelchair use'));
  assert.ok(html.includes('Accessible availability counts are unchanged'));
});

test('same-origin worker assets match the installed MapLibre version', () => {
  assert.equal(fromWeb('maplibre-gl/package.json').version, '6.14.0');
  for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
    assert.deepEqual(fs.readFileSync(path.join(web, 'public/vendor/maplibre-6.14.0', file)),
      fs.readFileSync(path.join(web, 'node_modules/maplibre-gl/dist', file)));
  }
  for (const component of ['RepairPlanRoutes.tsx', 'WhatIfPathMap.tsx']) {
    assert.ok(fs.readFileSync(path.join(web, 'src/components/management', component), 'utf8')
      .includes("setWorkerUrl('/vendor/maplibre-6.14.0/maplibre-gl-worker.mjs')"));
  }
});

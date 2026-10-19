const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { createRequire } = require('node:module');
const web = path.resolve(__dirname, '..');
const fromWeb = createRequire(path.join(web, 'package.json'));
const ts = fromWeb('typescript');
function load(relative, dependencies = {}, globals = {}) {
  const filename = path.join(web, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(output, { ...globals, module: mod, exports: mod.exports,
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

test('restriction legend and unchanged explanation are visible instead of an unexplained result', () => {
  const Component = load('src/components/management/RepairPlanRoutes.tsx', {
    '@/lib/repairRouteView': view, 'maplibre-gl/dist/maplibre-gl.css': {},
  }).default;
  const React = fromWeb('react');
  const {renderToStaticMarkup} = fromWeb('react-dom/server');
  const html = renderToStaticMarkup(React.createElement(Component, {
    baseline: [{...baseline[0],comparison_origin:{latitude:3.2254,longitude:101.7304}}],
    plan:{id:'p',name:'Repair plan',paths:[{...paths[0],explanation:'Selected repairs do not intersect the fixed reference route.'}]},
    restrictions:[{issue_id:'i',facility_id:'f',facility_name:'Unknown walkway',latitude:3.2254,longitude:101.7306,binding_source:'point_only',affected_segment:null,exclusion_rings:[]}],
  }));
  for (const label of ['Red areas','Green areas','Purple','without a confirmed affected road segment',
    'same matched start and destination','Selected repairs do not intersect']) {
    assert.ok(html.includes(label),label);
  }
});

test('selected repairs remain visible with an older backend and duplicate incidents deduplicate by facility', () => {
  const plan={id:'p',name:'Repair plan',paths,facility_impacts:[{facility_id:'f',facility_name:'North pavement'},{facility_id:'bench',facility_name:'Selected bench'}]};
  const candidate={facility_id:'f',facility_name:'North pavement',longitude:101.73,latitude:3.226};
  const facilities=view.repairMapFacilities(plan,[candidate,{...candidate,id:'second-issue'},{facility_id:'bench',facility_name:'Selected bench',longitude:101.738,latitude:3.233,affects_routes:false}],[]);
  assert.equal(facilities.length,2);
  assert.equal(facilities[0].label,'R1');assert.equal(facilities[1].label,'R2');
  assert.ok(facilities.every(f=>f.selected && !f.hasRestrictionGeometry));
  const bounds=view.repairMapBoundsPoints(points,[],facilities);
  assert.ok(bounds.some(p=>p[0]===101.738 && p[1]===3.233),'off-route selected facility must be in initial viewport');
});

test('result geometry coordinates take precedence and missing repair locations are never invented', () => {
  const plan={id:'p',name:'Repair',paths,facility_impacts:[{facility_id:'known',facility_name:'Known'},{facility_id:'missing',facility_name:'Missing'}]};
  const facilities=view.repairMapFacilities(plan,[{facility_id:'known',facility_name:'Known',longitude:101.74,latitude:3.23}],
    [{facility_id:'known',facility_name:'Known',longitude:101.73,latitude:3.22,exclusion_rings:[points]}]);
  assert.equal(facilities[0].coordinate[0],101.73);
  assert.equal(facilities[0].hasRestrictionGeometry,true);
  assert.equal(facilities[1].coordinate,null);
});

test('selected facility names and map controls render even without restriction geometry', () => {
  const Component=load('src/components/management/RepairPlanRoutes.tsx',{'@/lib/repairRouteView':view,'maplibre-gl/dist/maplibre-gl.css':{}}).default;
  const React=fromWeb('react');const {renderToStaticMarkup}=fromWeb('react-dom/server');
  const html=renderToStaticMarkup(React.createElement(Component,{baseline,
    plan:{id:'p',name:'Repair',paths,facility_impacts:[{facility_id:'f',facility_name:'North pavement'}]},
    candidates:[{facility_id:'f',facility_name:'North pavement',longitude:101.73,latitude:3.226}]}));
  for (const label of ['Selected repairs','R1','North pavement','Show route and selected repairs','locations only'])assert.ok(html.includes(label),label);
});

test('overview retains both independent journeys, separate geometries, and stable focus numbers', () => {
  const secondPoints = [[101.735, 3.23], [101.737, 3.232]];
  const secondRoute = { ...route(591), geometry: { type: 'LineString', coordinates: secondPoints } };
  const rows = view.repairPathViews([...baseline,
    { ...baseline[0], path_id: 'two', path_name: 'Journey 2', current: secondRoute }],
    [...paths, { ...paths[0], path_id: 'two', path_name: 'Journey 2', after: secondRoute }]);
  const overview = view.repairMapPaths(rows);
  assert.equal(overview.length, 2, 'walking references must not duplicate journeys');
  assert.equal(overview[0].beforePoints, points);
  assert.equal(overview[1].beforePoints, secondPoints);
  assert.equal(overview[1].beforeLabel, 'Before: 591 m');
  const focus = view.repairMapPaths(rows, 'two:avoid_damage');
  assert.equal(focus.length, 1);
  assert.equal(focus[0].number, 2, 'focused path keeps the same number as the overview');
  assert.equal(view.repairMapPaths(rows, 'deleted-path').length, 2);
  const accessible = view.repairMapPaths(rows, 'all:accessible');
  assert.equal(accessible.length, 1);
  assert.equal(accessible[0].view.before.reference, true);
});

test('map creates four distinct route sources, fits both journeys, and cleans up on selection change', async () => {
  const effects = [], sources = new Map(), layers = new Map(), markers = [];
  let fitted, refIndex = 0;
  const React = fromWeb('react');
  const hooks = { ...React,
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    useState: value => [value === 0 ? 1 : value, () => {}],
    useRef: value => ({ current: refIndex++ === 1 ? {} : value }),
  };
  class FakeMap {
    scrollZoom = { disable() {} };
    addControl() {} on() {} resize() {} remove() {}
    addSource(id, source) { sources.set(id, source); }
    addLayer(layer) { layers.set(layer.id, layer); }
    getSource(id) { return sources.get(id); }
    getLayer(id) { return layers.get(id); }
    removeSource(id) { sources.delete(id); }
    removeLayer(id) { layers.delete(id); }
    fitBounds(bounds) { fitted = bounds.points; }
  }
  class Marker {
    constructor(options) { this.options = options; }
    setLngLat(point) { this.point = point; return this; }
    addTo() { markers.push(this); return this; }
    remove() { this.removed = true; }
  }
  class Bounds { points = []; extend(point) { this.points.push(point); } }
  const Component = load('src/components/management/RepairPlanRoutes.tsx', {
    react: hooks, '@/lib/repairRouteView': view, 'maplibre-gl/dist/maplibre-gl.css': {},
    'maplibre-gl': { Map: FakeMap, Marker, LngLatBounds: Bounds, NavigationControl: class {}, setWorkerUrl() {} },
  }, { document: { createElement: () => ({ style: {} }) }, ResizeObserver: class { observe() {} disconnect() {} } }).default;
  const secondPoints = [[101.735, 3.23], [101.737, 3.232]];
  const second = { ...route(591), geometry: { type: 'LineString', coordinates: secondPoints } };
  Component({ baseline: [...baseline, { ...baseline[0], path_id: 'two', current: second }],
    plan: { name: 'Repair plan', paths: [...paths, { ...paths[0], path_id: 'two', path_name: 'Journey 2', after: second }] } });
  const unmount = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  const cleanup = effects[1]();
  assert.deepEqual([...sources.keys()], ['repair-1-before', 'repair-2-before', 'repair-1-after', 'repair-2-after']);
  assert.equal(sources.get('repair-2-after').data.geometry.coordinates, secondPoints);
  assert.ok(fitted.includes(points[0]) && fitted.includes(secondPoints[1]));
  for (const label of ['1A', '1B', '2A', '2B']) assert.ok(markers.some(m => m.options.element.textContent === label), label);
  assert.ok(markers.some(m => m.options.element.textContent.includes('P2 · Journey 2 · After: 591 m')));
  cleanup();
  assert.equal(sources.size, 0); assert.equal(layers.size, 0);
  assert.ok(markers.every(m => m.removed));
  unmount();
});

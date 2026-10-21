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
    require(name) { if (name === '@/lib/serviceAreaBoundary') return load('src/lib/serviceAreaBoundary.ts'); if (name === '@/lib/restrictionZones') return load('src/lib/restrictionZones.ts'); if (name === '@/lib/fixedFacilityLayer') return load('src/lib/fixedFacilityLayer.ts'); return name in dependencies ? dependencies[name] : fromWeb(name); },
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
    'Dashed orange', 'Solid teal']) {
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
    const normalizeLineEndings = value => value.replace(/\r\n/g, '\n');
    assert.equal(normalizeLineEndings(fs.readFileSync(path.join(web, 'public/vendor/maplibre-6.14.0', file), 'utf8')),
      normalizeLineEndings(fs.readFileSync(path.join(web, 'node_modules/maplibre-gl/dist', file), 'utf8')));
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


test('one journey is selected by default and switching retains only that path and mode', () => {
  const secondPoints = [[101.735, 3.23], [101.737, 3.232]];
  const second = { ...route(591), geometry: { type: 'LineString', coordinates: secondPoints } };
  const rows = view.repairPathViews([...baseline, { ...baseline[0], path_id: 'two', current: second }],
    [...paths, { ...paths[0], path_id: 'two', path_name: 'Journey 2', after: second }]);
  const first = view.repairMapPaths(rows);
  assert.equal(first.length, 1);
  assert.equal(first[0].beforePoints, points);
  const focus = view.repairMapPaths(rows, 'two:avoid_damage');
  assert.equal(focus.length, 1);
  assert.equal(focus[0].number, 2);
  assert.equal(focus[0].beforePoints, secondPoints);
  assert.equal(focus[0].beforeLabel, 'Before: 591 m');
  assert.equal(view.repairMapPaths(rows, 'deleted-path')[0].view.key, rows[0].key);
  assert.equal(view.repairMapPaths(rows, 'one:accessible')[0].view.before.reference, true);
  assert.equal(view.repairMapPaths([]).length, 0);
});

test('switching route removes old geometry, endpoints and distances before drawing the selected pair', async () => {
  const effects = [], sources = new Map(), layers = new Map(), markers = [], refs = [];
  let fitted, refIndex = 0;
  const React = fromWeb('react');
  const hooks = { ...React,
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    useState: value => [value === 0 ? 1 : value, () => {}],
    useRef: value => {
      const index = refIndex++;
      return refs[index] ??= { current: index === 1 ? {} : value };
    },
  };
  class FakeMap {
    scrollZoom = { disable() {} };
    addControl() {} on() {} resize() {} remove() {}
    addSource(id, source) { assert.ok(!sources.has(id)); sources.set(id, source); }
    addLayer(layer) { assert.ok(!layers.has(layer.id)); layers.set(layer.id, layer); }
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
  const props = { baseline: [...baseline, { ...baseline[0], path_id: 'two', current: second }],
    plan: { name: 'Repair plan', paths: [...paths, { ...paths[0], path_id: 'two', path_name: 'Journey 2', after: second }] } };
  Component(props);
  const unmount = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  const cleanup = effects[1]();
  assert.deepEqual([...sources.keys()], ['repair-1-before', 'repair-1-after']);
  cleanup();
  assert.equal(sources.size, 0); assert.equal(layers.size, 0);
  assert.ok(markers.every(m => m.removed));
  effects.length = 0; refIndex = 0;
  Component({ ...props, selectedKey: 'two:avoid_damage' });
  const cleanupSecond = effects[1]();
  assert.deepEqual([...sources.keys()], ['repair-2-before', 'repair-2-after']);
  assert.equal(sources.get('repair-2-after').data.geometry.coordinates, secondPoints);
  assert.ok(fitted.includes(secondPoints[1]));
  assert.ok(!fitted.includes(points[0]));
  const active = markers.filter(m => !m.removed);
  for (const label of ['2A', '2B']) assert.ok(active.some(m => m.options.element.textContent === label));
  assert.ok(active.every(m => !m.options.element.textContent.includes('P1')));
  assert.equal(active.length, 2, 'only compact endpoints remain; long route labels are omitted');
  assert.ok(active.every(m => !m.options.element.textContent.includes('P2')));
  cleanupSecond();
  effects.length = 0; refIndex = 0;
  Component({ ...props, selectedKey: 'all:avoid_damage' });
  const cleanupAll = effects[1]();
  assert.deepEqual([...sources.keys()], ['repair-1-before', 'repair-2-before', 'repair-1-after', 'repair-2-after']);
  assert.ok(fitted.includes(points[0]) && fitted.includes(secondPoints[1]));
  assert.equal(markers.filter(m => !m.removed).length, 4, 'all-route mode keeps only four compact endpoints');
  cleanupAll();
  assert.equal(sources.size, 0); assert.ok(markers.every(m => m.removed));
  // Failed routing must keep the submitted endpoints, including in bounds.
  const origin={longitude:101.7234,latitude:3.2197},destination={longitude:101.7268,latitude:3.2244};
  const failure={state:'not_assessable',reason:'no_fixed_reference_endpoints',details:'No mapped walking access is reachable under the 20 m outdoor gap rule.'};
  effects.length=0;refIndex=0;
  Component({baseline:[{...baseline[0],requested_origin:origin,requested_destination:destination,current:failure}],
    plan:{name:'Failed plan',paths:[{...paths[0],after:failure,effect:'not_assessable'}]}});
  const cleanupFailed=effects[1]();
  assert.equal(sources.size,0,'Do not draw a straight line when routing fails');
  const failedMarkers=markers.filter(m=>!m.removed);assert.equal(failedMarkers.length,2);
  assert.ok(failedMarkers.some(m=>m.options.element.textContent==='1A'&&m.point[0]===origin.longitude&&m.point[1]===origin.latitude));
  assert.ok(failedMarkers.some(m=>m.options.element.textContent==='1B'&&m.point[0]===destination.longitude&&m.point[1]===destination.latitude));
  assert.ok(fitted.some(p=>p[0]===origin.longitude)&&fitted.some(p=>p[0]===destination.longitude));
  cleanupFailed();

  unmount();
});

test('a shared selection displays route 2 in every plan and hides route 1 result details', () => {
  const Component = load('src/components/management/RepairPlanRoutes.tsx', {
    '@/lib/repairRouteView': view, 'maplibre-gl/dist/maplibre-gl.css': {},
  }).default;
  const React = fromWeb('react');
  const { renderToStaticMarkup } = fromWeb('react-dom/server');
  const extraBefore = { ...baseline[0], path_id: 'two', path_name: 'Journey 2', current: route(591) };
  const extraAfter = { ...paths[0], path_id: 'two', path_name: 'Journey 2', after: route(278) };
  for (const name of ['Repair plan 1', 'Repair plan 2']) {
    const html = renderToStaticMarkup(React.createElement(Component, { baseline: [...baseline, extraBefore],
      plan: { name, paths: [...paths, extraAfter] }, selectedKey: 'two:avoid_damage' }));
    assert.ok(html.includes('value="two:avoid_damage" selected=""'));
    assert.ok(html.includes('Before: 591 m') && html.includes('After: 278 m'));
    assert.ok(!html.includes('Before: 200 m') && !html.includes('After repairs: 150 m'));
    assert.ok(!html.includes('All paths'));
    assert.ok(html.includes('Journey 1'), 'route 1 remains selectable');
  }
});

test('planner passes the same route selection and change handler to every repair plan', () => {
  const React = fromWeb('react');
  const captured = [];
  const select = () => {};
  const result = { simulation_id: 's', snapshot_at: '2026-10-20T00:00:00Z', warnings: [], baseline,
    plans: ['Plan 1','Plan 2'].map((name, i) => ({ id: String(i), name, paths, summaries: [],
      total_estimated_cost_myr: null, budget_status: 'unknown' })) };
  let stateIndex = 0;
  const hooks = { ...React, useEffect() {}, useCallback: fn => fn, useMemo: fn => fn(),
    useState(value) {
      const index = stateIndex++;
      if (index === 0) return [3, () => {}];
      if (value === null) return [result, () => {}];
      if (index === 9) return ['two:avoid_damage', select];
      return [value, () => {}];
    },
  };
  const Planner = load('src/components/management/WhatIfPlanner.tsx', {
    react: hooks, '@/lib/api': { ApiError: class extends Error {}, WHAT_IF_LIMITS: load('src/lib/api.ts', { '@/lib/auth-session': {} }).WHAT_IF_LIMITS },
    '@/components/ui/DataSkeleton': { DataSkeleton: () => null },
    './SharedLocationPicker': { __esModule: true, default: () => null }, './RepairSummaryPanel': { __esModule: true, default: () => null }, './WhatIfPathMap': { __esModule: true, default: () => null, parseMapPoint: () => null, pathDistance: () => 0 }, './RepairPlanRoutes': { default: props => { captured.push(props); return null; }, __esModule: true },
  }).default;
  const { renderToStaticMarkup } = fromWeb('react-dom/server');
  renderToStaticMarkup(React.createElement(Planner));
  assert.equal(captured.length, 2);
  for (const props of captured) {
    assert.equal(props.selectedKey, 'two:avoid_damage');
    assert.equal(props.onSelectionChange, select);
  }
});


test('explicit all-route mode lists each journey once with before/after distance and time savings', () => {
  const before = [{ ...baseline[0], current: { ...route(200), duration_seconds: 100 } }, baseline[1],
    { ...baseline[0], path_id: 'two', path_name: 'Journey 2', current: { ...route(591), duration_seconds: 500 } }];
  const after = [{ ...paths[0], after: { ...route(150), duration_seconds: 70 } }, paths[1],
    { ...paths[0], path_id: 'two', path_name: 'Journey 2', after: { ...route(300), duration_seconds: 250 } }];
  const rows = view.repairPathViews(before, after);
  const all = view.repairMapPaths(rows, 'all:avoid_damage');
  assert.equal(all.length, 2);
  assert.ok(all.every(path => path.view.mode === 'avoid_damage'));
  assert.equal(view.repairMapPaths(rows, 'one:avoid_damage').length, 1);
  assert.equal(view.routeTimeChange(rows[0]), '30 s saved');
  const Component = load('src/components/management/RepairPlanRoutes.tsx', {
    '@/lib/repairRouteView': view, 'maplibre-gl/dist/maplibre-gl.css': {},
  }).default;
  const React = fromWeb('react'); const { renderToStaticMarkup } = fromWeb('react-dom/server');
  const html = renderToStaticMarkup(React.createElement(Component, { baseline: before,
    plan: { name: 'Plan', paths: after }, selectedKey: 'all:avoid_damage' }));
  for (const label of ['Compare all routes','Comparing all 2 routes','Journey 2','50 m shorter','291 m shorter','30 s saved','4 min 10 s saved']) assert.ok(html.includes(label), label);
});

test('time differences do not invent savings for restored routes or mismatched references', () => {
  const row = view.repairPathViews(baseline, paths)[0];
  row.before.route = { ...route(100), duration_seconds: 70 };
  row.after.route = { ...route(100), duration_seconds: 90 };
  assert.equal(view.routeTimeChange(row), '20 s longer');
  row.after.reference = true;
  assert.equal(view.routeTimeChange(row), 'Time not comparable');
  row.before.route = null; row.after.reference = false;
  assert.equal(view.routeTimeChange(row), 'Time saving unavailable');
  assert.equal(view.formatRouteSeconds(null), 'Unavailable');
  assert.equal(view.formatRouteSeconds(Infinity), 'Unavailable');
});

test('summary panel explicitly labels calculated fallback and does not call it AI generated', () => {
  const React = fromWeb('react'); const { renderToStaticMarkup } = fromWeb('react-dom/server');
  const value = { source: 'calculated', text: 'Ranking uses time only.', facts: {
    route_mode: 'avoid_damage', budget_myr: null, comparable_path_count: 2, excluded_path_count: 0,
    recommended_plan_ids: ['plan1'], explanation: 'Each route is walked once.', plans: [{
      id: 'plan1', name: 'Repair plan 1', before_seconds: 300, after_seconds: 200, saved_seconds: 100,
      cost_myr: null, budget_status: 'unknown_cost', restored_paths: 0, unavailable_after_paths: 0,
    }],
  } };
  let state = 0;
  const hooks = { ...React, useEffect() {}, useState(initial) {
    return [state++ === 0 ? { key: 's:avoid_damage:0', value } : initial, () => {}];
  } };
  const Panel = load('src/components/management/RepairSummaryPanel.tsx', {
    react: hooks, '@/lib/api': {}, '@/lib/repairRouteView': view, './CandidateReviewButton': { default: () => null },
  }).default;
  const html = renderToStaticMarkup(React.createElement(Panel, { simulationId: 's', mode: 'avoid_damage', plans: [] }));
  for (const label of ['Calculated summary','AI unavailable','Recommended: Repair plan 1','Unknown / incomplete','1 min 40 s','Ranking uses time only.']) assert.ok(html.includes(label), label);
  assert.ok(!html.includes('AI explanation'));
});

test('summary ignores an earlier mode response after the user changes route mode', async () => {
  const React = fromWeb('react'); const effects = [], updates = [], pending = [];
  const Panel = load('src/components/management/RepairSummaryPanel.tsx', {
    react: { ...React, useState: value => [value, next => updates.push(next)], useEffect: fn => effects.push(fn) },
    '@/lib/api': { getRepairSummary: (...args) => new Promise(resolve => pending.push({ args, resolve })) },
    '@/lib/repairRouteView': view, './CandidateReviewButton': { default: () => null },
  }).default;
  Panel({ simulationId: 's', mode: 'avoid_damage' });
  const cleanup = effects[0]();
  cleanup();
  Panel({ simulationId: 's', mode: 'accessible' }); effects[1]();
  pending[0].resolve({ source: 'ai', text: 'stale' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.length, 0);
  pending[1].resolve({ source: 'calculated', text: 'current' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].key, 's:accessible:0');
});

test('summary API sends only the simulation ID and selected mode, with the existing session', async () => {
  let request;
  const api = load('src/lib/api.ts', { '@/lib/auth-session': { clearAuthSession() {}, getValidAccessToken: async () => 'session-fixture' } }, {
    process: { env: { NEXT_PUBLIC_API_BASE_URL: 'https://backend.example' } }, Headers, FormData,
    fetch: async (url, options) => { request = { url, options }; return { ok: true, status: 200, json: async () => ({ source: 'calculated' }) }; },
  });
  await api.getRepairSummary('simulation-fixture', 'accessible');
  assert.equal(request.url, 'https://backend.example/api/v1/management/what-if/simulation-fixture/summary');
  assert.deepEqual(JSON.parse(request.options.body), { route_mode: 'accessible' });
  assert.equal(request.options.headers.get('Authorization'), 'Bearer session-fixture');
});

test('failed route diagnostics retain selected endpoints and distinguish access, restrictions and accessibility',()=>{
 const failed={state:'not_assessable',reason:'no_fixed_reference_endpoints',details:'No walking access within 20 m.'};
 const input=[{...baseline[0],requested_origin:{longitude:101.7234,latitude:3.2197},requested_destination:{longitude:101.7268,latitude:3.2244},current:failed}];
 const rows=view.repairPathViews(input,[{...paths[0],after:failed}]);const mapped=view.repairMapPaths(rows)[0];
 assert.equal(JSON.stringify(mapped.origin),'[101.7234,3.2197]');assert.equal(JSON.stringify(mapped.destination),'[101.7268,3.2244]');
 assert.equal(mapped.beforePoints.length,0);assert.equal(mapped.afterPoints.length,0);
 assert.match(view.routeFailureReason(rows[0].before),/all damage restrictions removed/);
 assert.match(view.routeFailureReason(rows[0].before),/20 m/);
 assert.match(view.routeFailureReason({state:'no_route',reason:'blocked_endpoint'}),/inside an unrepaired restriction/);
 assert.match(view.routeFailureReason({state:'not_assessable',reason:'no_verified_accessible_reference'}),/verified step-free/);
 assert.equal(view.routeFailureReason({state:'available'}),null);
});
test('selected markers keep the requested pins rather than moving to snapped route endpoints',()=>{
 const original={longitude:101.73,latitude:3.225},target={longitude:101.731,latitude:3.226};
 const rows=view.repairPathViews([{...baseline[0],requested_origin:original,requested_destination:target,comparison_origin:{longitude:101.73001,latitude:3.22501}}],[paths[0]]);
 const map=view.repairMapPaths(rows)[0];assert.equal(map.origin[0],original.longitude);assert.equal(map.destination[0],target.longitude);
 const bounds=view.repairMapBoundsPoints([],[],[],[map.origin,map.destination]);assert.equal(bounds.length,2);
});
test('compare transport retains endpoints from the submitted request when an older backend has no metadata',async()=>{
 const api=load('src/lib/api.ts',{'@/lib/auth-session':{getValidAccessToken:async()=> 'fixture',clearAuthSession(){}}},
 {Headers,FormData,URLSearchParams,fetch:async()=>new Response(JSON.stringify({baseline:[{path_id:'p',current:{state:'no_route'}}]}),{status:200}),process:{env:{NEXT_PUBLIC_API_BASE_URL:'https://api.invalid'}}});
 const origin={latitude:3.2197,longitude:101.7234},destination={latitude:3.2244,longitude:101.7268};
 const pending=api.compareRepairPlans({paths:[{id:'p',name:'Journey',origin,destination}],plans:[{id:'repair',name:'Repair',repairs:[{facility_id:'10000000-0000-4000-8000-000000000001',estimated_cost_myr:null}]}],route_modes:['avoid_damage'],include_geometry:true});
 const original={...origin};origin.longitude+=.001;const result=await pending;
 assert.equal(JSON.stringify(result.baseline[0].requested_origin),JSON.stringify(original));assert.equal(JSON.stringify(result.baseline[0].requested_destination),JSON.stringify(destination));
});

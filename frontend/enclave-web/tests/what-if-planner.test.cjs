const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const web = path.resolve(__dirname, '..');
const fromWeb = createRequire(path.join(web, 'package.json'));
const ts = fromWeb('typescript');
const facilityId = '11111111-1111-4111-8111-111111111111';
const journey = { name: 'Gate to mall', fromLat: '3.225', fromLng: '101.73', toLat: '3.226', toLng: '101.731' };
const issue = { id: 'issue-1', facility_id: facilityId, facility_name: 'Jalan 3/5A', facility_type: 'path_surface',
  fault_kind: 'damage', latitude: 3.2255, longitude: 101.7305, affects_routes: true, estimated_cost_myr: null };
function setup(overrides = {}, compare = async () => ({})) {
  const React = fromWeb('react');
  const state = { 0: 1, 1: [issue], 2: [journey], 5: [{ name: 'Repair plan 1', facilities: [facilityId], costs: {} }],
    13: false, 14: true, ...overrides };
  const refs = [];
  let cursor = 0, refCursor = 0, effectCursor = 0;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
    useRef(initial) { const index = refCursor++; return refs[index] ??= { current: initial }; },
    useMemo: fn => fn(), useCallback: fn => fn(),
    useEffect(fn) { if (effectCursor++ === 0) fn(); },
  };
  const api = { ApiError: class extends Error {}, getRepairCandidates: async () => ({ issues: [issue] }),
    compareRepairPlans: compare, getRepairSummary: async () => null, resolveMapLocationName: async () => ({ matched: false, name: null }),
    WHAT_IF_LIMITS: { paths: 10, plans: 5, repairs: 20 } };
  const map = function Map() {};
  map.parseMapPoint = (lat, lng) => lat.trim() && lng.trim() && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    ? { latitude: Number(lat), longitude: Number(lng) } : null;
  map.pathDistance = (a, b) => Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude) * 111000;
  const icons = new Proxy({}, { get: () => function Icon() {} });
  const filename = path.join(web, 'src/components/management/WhatIfPlanner.tsx');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(source, { module: mod, exports: mod.exports, window: { scrollTo() {} },
    require(name) { if (name === 'react') return hooks; if (name === '@/lib/api') return api;
      if (name === './WhatIfPathMap') return { default: map, ...map };
      if (name === '@/lib/repairRouteView') return { formatRouteSeconds: () => '0 s', repairPathViews: () => [], routeDistance: () => '', routeTimeChange: () => '' };
      if (name === 'lucide-react') return icons;
      if (name === '@/components/ui/DataSkeleton' || name === './RepairPlanRoutes' || name === './RepairSummaryPanel' || name === './CandidateReviewButton') return { default: () => null, DataSkeleton: () => null };
      return fromWeb(name); },
  }, { filename });
  function render() { cursor = 0; refCursor = 0; effectCursor = 0; return mod.exports.default(); }
  function all(tree) { if (!tree || typeof tree !== 'object') return []; return [tree, ...React.Children.toArray(tree.props?.children).flatMap(all)]; }
  function words(tree) { if (tree == null || typeof tree === 'boolean') return ''; if (typeof tree !== 'object') return String(tree);
    return React.Children.toArray(tree.props?.children).map(words).join(''); }
  function find(tree, type, label) { return all(tree).find(node => node.type === type && words(node).includes(label)); }
  return { render, find, words, state, all };
}

test('path and plan controls stop at backend limits and copied endpoints are rejected before submit', () => {
  const ui = setup();
  let tree = ui.render();
  for (let count = 1; count < 10; count++) {
    const add = ui.find(tree, 'button', 'Add Path');
    assert.ok(ui.words(add).includes(`${count}/10`));
    add.props.onClick(); tree = ui.render();
  }
  assert.equal(ui.find(tree, 'button', 'Add Path').props.disabled, true);
  const duplicate = setup(); tree = duplicate.render();
  duplicate.all(tree).find(node => node.props?.['aria-label'] === 'Duplicate path 1').props.onClick({ stopPropagation() {} });
  tree = duplicate.render(); ui.find(tree, 'button', 'Continue to Plans').props.onClick();
  tree = duplicate.render();
  assert.match(duplicate.words(tree), /Each path needs a different start and destination pair/);
  assert.equal(duplicate.state[0], 1);
});

test('a hidden plan invalid estimate is stopped locally instead of sending an invalid backend request', () => {
  let calls = 0;
  const ui = setup({ 0: 2, 5: [
    { name: 'Repair plan 1', facilities: [facilityId], costs: {} },
    { name: 'Repair plan 2', facilities: [facilityId], costs: { [facilityId]: '2.001' } },
  ] }, async () => { calls++; return {}; });
  let tree = ui.render();
  assert.ok(ui.words(tree).includes('New Plan (2/5)'));
  ui.all(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  tree = ui.render();
  assert.equal(calls, 0);
  assert.match(ui.words(tree), /Check the estimated cost in Repair plan 2/);
});

test('plan count stops at five and an invalid budget is rejected before comparison', () => {
  let calls = 0;
  const ui = setup({ 0: 2 });
  let tree = ui.render();
  for (let count = 1; count < 5; count++) {
    const add = ui.find(tree, 'button', 'New Plan');
    assert.ok(ui.words(add).includes(`${count}/5`));
    add.props.onClick(); tree = ui.render();
  }
  assert.equal(ui.find(tree, 'button', 'New Plan').props.disabled, true);
  const budgetUi = setup({ 0: 2 }, async () => { calls++; return {}; });
  tree = budgetUi.render();
  budgetUi.all(tree).find(node => node.type === 'input' && node.props?.placeholder === 'No budget set').props.onChange({ target: { value: '-1' } });
  tree = budgetUi.render();
  budgetUi.all(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  tree = budgetUi.render();
  assert.equal(calls, 0);
  assert.match(budgetUi.words(tree), /Enter a non-negative budget/);
});

test('valid comparison sends real endpoints and estimates, then opens Results; edited inputs discard a late response', async () => {
  const result = { simulation_id: 'simulation-1', snapshot_at: '2026-01-01T00:00:00Z', budget_myr: null,
    baseline_road_obstacle_count: 1, baseline: [], warnings: [], plans: [{ id: 'plan_1', name: 'Repair plan 1',
      total_estimated_cost_myr: '120.00', budget_status: 'not_set', summaries: [], paths: [], remaining_road_obstacle_count: 0,
      improved_major_path_count: 0 }] };
  let submitted;
  const ui = setup({ 0: 2, 5: [{ name: 'Repair plan 1', facilities: [facilityId], costs: { [facilityId]: '120.00' } }] },
    async value => { submitted = value; return result; });
  let tree = ui.render();
  ui.all(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  tree = ui.render();
  assert.equal(submitted.paths[0].origin.latitude, 3.225);
  assert.equal(submitted.plans[0].repairs[0].estimated_cost_myr, '120.00');
  assert.equal(submitted.include_geometry, true);
  assert.equal(ui.state[0], 3);
  assert.match(ui.words(tree), /Spatial Route Comparison/);

  let resolveComparison;
  const late = setup({ 0: 2 }, () => new Promise(resolve => { resolveComparison = resolve; }));
  tree = late.render();
  late.all(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  tree = late.render();
  late.all(tree).find(node => node.type === 'input' && node.props?.placeholder === 'No budget set').props.onChange({ target: { value: '50' } });
  late.render();
  resolveComparison(result);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.state[0], 2);
  assert.equal(late.state[8], null);
});

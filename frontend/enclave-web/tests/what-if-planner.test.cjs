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

test('source-backed default remains editable and comparison asks backend for its latest estimate', async () => {
  const priced = { ...issue, estimated_cost_myr: '12000.00', cost_estimate_source: 'provisional_benchmark',
    cost_estimate_sample_count: 1 };
  let submitted;
  const ui = setup({ 0: 2, 1: [priced] }, async value => { submitted = value; return { baseline: [], plans: [], simulation_id: 'priced' }; });
  let tree = ui.render();
  assert.match(ui.words(tree), /Provisional reference/);
  const costInput = ui.all(tree).find(node => node.type === 'input' && node.props?.value === '12000.00');
  assert.ok(costInput);
  ui.all(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(submitted.plans[0].repairs[0].estimated_cost_myr, null);

  const overridden = setup({ 0: 2, 1: [priced] }, async value => { submitted = value; return { baseline: [], plans: [], simulation_id: 'custom' }; });
  tree = overridden.render();
  overridden.all(tree).find(node => node.type === 'input' && node.props?.value === '12000.00')
    .props.onChange({ target: { value: '15000.00' } });
  tree = overridden.render();
  assert.equal(overridden.state[5][0].costs[facilityId], '15000.00');
  overridden.all(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(submitted.plans[0].repairs[0].estimated_cost_myr, '15000.00');
});

test('Results shows the summary in the recommendation banner without selecting an all-path map route', () => {
  const result = { simulation_id: 'simulation-1', snapshot_at: '2026-01-01T00:00:00Z', budget_myr: '1500',
    baseline_road_obstacle_count: 1, baseline: [], warnings: ['Accessible comparisons use simulated step-free facilities from the resident demo map; these routes are not surveyed.'], plans: [{ id: 'plan_1', name: 'Repair plan 1',
      total_estimated_cost_myr: '999.90', budget_status: 'within_budget', summaries: [], paths: [], remaining_road_obstacle_count: 0,
      improved_major_path_count: 1 }] };
  const summary = { source: 'ai', text: 'This plan saves the most time within budget.', facts: {
    route_mode: 'avoid_damage', budget_myr: '1500', comparable_path_count: 1, excluded_path_count: 0,
    recommended_plan_ids: ['plan_1'], explanation: 'Each journey is counted once.',
    plans: [{ id: 'plan_1', name: 'Repair plan 1', saved_seconds: 120 }],
  } };
  const ui = setup({ 0: 3, 8: result, 9: 'journey-1:avoid_damage', 12: summary });
  let tree = ui.render();
  let banner = ui.all(tree).find(node => node.props?.['aria-label'] === 'Repair comparison summary');
  assert.ok(banner);
  assert.match(ui.words(banner), /AI executive summary & explanation/);
  assert.match(ui.words(banner), /This plan saves the most time within budget/);
  assert.match(ui.words(banner), /Each journey is counted once/);
  assert.ok(ui.words(tree).indexOf(summary.text) < ui.words(tree).indexOf('Selected plan cost'));

  const accessible = ui.all(tree).find(node => node.type === 'button' && ui.words(node) === 'Accessible');
  accessible.props.onClick();
  assert.equal(ui.state[9], 'all:accessible');
  tree = ui.render();
  assert.match(ui.words(tree), /Simulated step-free facilities · not field verified/);
  banner = ui.all(tree).find(node => node.props?.['aria-label'] === 'Repair comparison summary');
  assert.doesNotMatch(ui.words(banner), /This plan saves the most time within budget/);

  ui.state[12] = { source: 'calculated', text: 'No comparable accessible journey is available.', facts: {
    ...summary.facts, route_mode: 'accessible', comparable_path_count: 0, excluded_path_count: 1,
    recommended_plan_ids: [], explanation: 'No common before and after durations are available.',
  } };
  tree = ui.render();
  banner = ui.all(tree).find(node => node.props?.['aria-label'] === 'Repair comparison summary');
  assert.match(ui.words(banner), /Calculated summary · AI unavailable/);
  assert.match(ui.words(banner), /No comparable accessible journey is available/);
  assert.match(ui.words(tree), /No time-based recommendation/);

  ui.state[12] = null;
  ui.state[17] = { key: 'simulation-1:accessible', message: 'Summary unavailable.' };
  tree = ui.render();
  assert.match(ui.words(tree), /Summary unavailable/);
  ui.find(tree, 'button', 'Retry summary').props.onClick();
  assert.equal(ui.state[17], null);
  assert.equal(ui.state[18], 1);
});

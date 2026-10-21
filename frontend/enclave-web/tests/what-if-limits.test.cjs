const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');

function load(file, dependencies, globals = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, ...globals,
    require(name) { if (name in dependencies) return dependencies[name]; return require(name); },
  }, { filename });
  return module.exports;
}
function gateway() {
  const calls = [];
  const api = load('src/lib/api.ts', {
    '@/lib/auth-session': { getValidAccessToken: async () => 'fixture', clearAuthSession() {} },
  }, { Headers, FormData, process: { env: { NEXT_PUBLIC_API_BASE_URL: 'https://api.fixture.example' } },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ baseline: [], plans: [] }) }; },
  });
  return { api, calls };
}
function input(paths = 1, plans = 1, repairs = 1) {
  return {
    paths: Array.from({ length: paths }, (_, i) => ({ id: `path_${i}`, name: `Path ${i}`,
      origin: { latitude: 3.225 + i * .00001, longitude: 101.73 },
      destination: { latitude: 3.226 + i * .00001, longitude: 101.731 } })),
    plans: Array.from({ length: plans }, (_, i) => ({ id: `plan_${i}`, name: `Repair plan ${i}`,
      repairs: Array.from({ length: repairs }, (_, j) => ({ facility_id: `10000000-0000-4000-8000-${String(j + 1).padStart(12, '0')}`, estimated_cost_myr: null })) })),
    route_modes: ['avoid_damage'], budget_myr: null, include_geometry: true,
  };
}

test('more than five repair plans fail locally with a useful message before any API call', async () => {
  const { api, calls } = gateway();
  for (const count of [0, 6, 10]) {
    await assert.rejects(api.compareRepairPlans(input(1, count)), error => error.status === 422 && /1 and 5 repair plans/.test(error.message));
  }
  assert.equal(calls.length, 0);
});

test('path and per-plan facility limits are checked without sending or truncating the request', async () => {
  const { api, calls } = gateway();
  for (const count of [0, 11, 20]) {
    await assert.rejects(api.compareRepairPlans(input(count)), /1 and 10 paths/);
  }
  for (const count of [0, 21]) {
    await assert.rejects(api.compareRepairPlans(input(1, 1, count)), /1 and 20 facilities/);
  }
  assert.equal(calls.length, 0);
});

test('ten paths and five plans with twenty repairs are submitted intact', async () => {
  const { api, calls } = gateway();
  const body = input(10, 5, 20);
  await api.compareRepairPlans(body);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.fixture.example/api/v1/management/what-if/compare');
  assert.deepEqual(JSON.parse(calls[0].options.body), body);
});

test('planner instructions and Add buttons use the API limits', () => {
  const { api } = gateway();
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Planner = load('src/components/management/WhatIfPlanner.tsx', {
    '@/lib/api': api,
    '@/components/ui/DataSkeleton': { DataSkeleton: () => null },
    './RepairPlanRoutes': { default: () => null },
    './RepairSummaryPanel': { default: () => null },
    './WhatIfPathMap': { default: () => null, parseMapPoint: () => null, pathDistance: () => 0 },
  }).default;
  const html = renderToStaticMarkup(React.createElement(Planner));
  const text = html.replace(/<[^>]*>/g, '');
  assert.match(text, /Define up to 10 major journeys and compare up to 5 independent/);
  assert.match(text, /Add path \(1\/10\)/);
  assert.match(text, /Add repair plan \(1\/5\)/);
});

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');

function load(file, dependencies, globals = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, FormData, ...globals,
    require(name) { if (name in dependencies) return dependencies[name]; throw Error('Unexpected dependency ' + name); },
  }, { filename });
  return module.exports;
}
class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
const task = (version = 1, status = 'assigned') => ({
  id: 'task-uuid', ticket_id: 'TICK-2026', title: 'Repair walkway', description: 'Damaged surface',
  latitude: 3.22649, longitude: 101.730755, priority: 'high', status, version,
  assigned_staff_id: 'worker', assigned_team_id: null, target_date: '2026-10-25',
  created_at: '2026-10-18T01:00:00Z', updated_at: '2026-10-18T01:01:00Z',
  instructions: 'Inspect and repair', work_notes: '', completion_notes: '', review_note: '',
  before_photo_url: 'https://storage.example/before?signature=fixture', after_photo_url: null,
  checked_on_site: false, report_status: 'approved',
});
const page = (items, offset = 0, has_more = false) => ({ items, offset, limit: 100, has_more });
function gateway(handler) { return load('src/lib/maintenance/api.ts', { '@/lib/api': { ApiError, apiRequest: handler } }); }

test('maps backend task fields, real photo URLs and all workflow status labels', () => {
  const api = gateway(() => {});
  for (const [raw, ui] of [['assigned', 'assigned'], ['in_progress', 'in-progress'], ['changes_requested', 'changes-requested'], ['awaiting_verification', 'awaiting-verification'], ['resolved', 'resolved']]) {
    const mapped = api.toMaintenanceTask(task(1, raw));
    assert.equal(mapped.status, ui); assert.equal(mapped.ticketId, 'TICK-2026');
    assert.equal(mapped.priority, 'High'); assert.equal(mapped.location, 'Selected map point');
    assert.equal(mapped.latitude, task().latitude); assert.equal(mapped.longitude, task().longitude);
    assert.equal(api.toMaintenanceTask({ ...task(), location_name: 'Jalan Melati · Section 2' }).location, 'Jalan Melati · Section 2');
    assert.equal(mapped.beforePhotoUrl, task().before_photo_url);
  }
  assert.throws(() => api.toMaintenanceTask({ ...task(), version: 0 }), { status: 503 });
  assert.throws(() => api.toMaintenanceTask({ ...task(), status: 'unknown' }), { status: 503 });
});

test('loads every page and never substitutes demo tasks for an error or empty list', async () => {
  const requests = [];
  const api = gateway(async url => { requests.push(url); return requests.length === 1 ? page([task()], 0, true) : page([], 100); });
  assert.equal((await api.createMaintenanceGateway().listTasks()).length, 1);
  assert.deepEqual(requests, ['/api/v1/maintenance/tasks?limit=100&offset=0', '/api/v1/maintenance/tasks?limit=100&offset=100']);
  assert.equal((await gateway(async () => page([])).createMaintenanceGateway().listTasks()).length, 0);
  await assert.rejects(gateway(async () => { throw new ApiError('Unavailable', 503); }).createMaintenanceGateway().listTasks(), { status: 503 });
});

test('start, progress and blocker use the last visible version and persist returned versions', async () => {
  const calls = [];
  const api = gateway(async (url, options) => {
    calls.push({ url, options });
    return !options ? page([task()]) : task(options.body.expected_version + 1, 'in_progress');
  });
  const worker = api.createMaintenanceGateway(); await worker.listTasks();
  await worker.startWork('task-uuid'); await worker.saveUpdate('task-uuid', 'Surface prepared');
  await worker.reportBlocker('task-uuid', 'parts', 'Need panels');
  assert.deepEqual(calls.slice(1).map(call => call.options.body.expected_version), [1, 2, 3]);
  assert.equal(calls[1].options.method, 'POST'); assert.match(calls[1].url, /\/start$/);
  assert.equal(calls[2].options.method, 'PATCH'); assert.match(calls[2].url, /\/progress$/);
  assert.equal(calls[3].options.body.blocker_type, 'parts');
});

test('a conflict is surfaced once without a silent retry or success state', async () => {
  let writes = 0;
  const worker = gateway(async (url, options) => {
    if (!options) return page([task()]);
    writes++; throw new ApiError('Version changed', 409);
  }).createMaintenanceGateway();
  await worker.listTasks();
  await assert.rejects(worker.startWork('task-uuid'), { status: 409 }); assert.equal(writes, 1);
});

test('completion uploads the photo as multipart with version, notes and attestation', async () => {
  const photo = new File(['synthetic image'], 'repair.png', { type: 'image/png' });
  const worker = gateway(async (url, options) => {
    if (!options) return page([task(2, 'in_progress')]);
    assert.match(url, /\/evidence$/); assert.equal(options.method, 'POST');
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('expected_version'), '2'); assert.equal(options.body.get('notes'), 'Repaired');
    assert.equal(options.body.get('checked_on_site'), 'true'); assert.equal(options.body.get('file').name, 'repair.png');
    return { ...task(3, 'awaiting_verification'), after_photo_url: 'https://storage.example/after' };
  }).createMaintenanceGateway();
  await worker.listTasks();
  const result = await worker.submitEvidence('task-uuid', { notes: 'Repaired', checkedOnSite: true, photo });
  assert.equal(result.status, 'awaiting-verification'); assert.equal(result.afterPhotoUrl, 'https://storage.example/after');
});

test('an old list response cannot roll back the version of a completed update', async () => {
  let release; let lists = 0;
  const worker = gateway(async (url, options) => {
    if (options) return task(2, 'in_progress');
    lists++; if (lists === 1) return page([task()]);
    return new Promise(resolve => { release = () => resolve(page([task()])); });
  }).createMaintenanceGateway();
  await worker.listTasks(); const oldList = worker.listTasks(); await worker.startWork('task-uuid'); release();
  await assert.rejects(oldList, { status: 409 });
});

test('notifications/read and task history use real staff endpoints', async () => {
  const calls = [];
  const api = gateway(async (url, options) => { calls.push({ url, options }); return options ? undefined : page([]); });
  await api.getStaffNotifications(); await api.markStaffNotificationRead(42);
  await api.getTaskHistory('task-uuid'); await api.getTaskHistory('task-uuid', true);
  assert.equal(calls[1].url, '/api/v1/maintenance/notifications/42/read'); assert.equal(calls[1].options.method, 'POST');
  assert.match(calls[2].url, /^\/api\/v1\/maintenance\/tasks\/task-uuid\/history/);
  assert.match(calls[3].url, /^\/api\/v1\/management\/maintenance\/tasks\/task-uuid\/history/);
});

test('management assignment, rework, verification and reassignment match backend contracts', async () => {
  const calls = [];
  const api = gateway(async (url, options) => { calls.push({ url, options }); return task(); });
  await api.assignMaintenance({ ticket_id: 'TICK-2026', title: 'Repair', instructions: 'Inspect', priority: 'high', target_date: '2026-10-25', assigned_staff_id: 'worker', assigned_team_id: null });
  await api.reviewMaintenance(task(4, 'awaiting_verification'), 'rework', 'Clearer photo');
  await api.reviewMaintenance(task(6, 'awaiting_verification'), 'approve', 'Inspected', 'Repaired and checked');
  await api.reassignMaintenance(task(7, 'changes_requested'), { assigned_staff_id: null, assigned_team_id: 'team' }, 'Team changed');
  assert.equal(calls[0].url, '/api/v1/management/maintenance/tasks');
  assert.equal(calls[1].options.body.repair_verified, false); assert.equal(calls[1].options.body.expected_version, 4);
  assert.equal(calls[2].options.body.repair_verified, true); assert.equal(calls[2].options.body.public_note, 'Repaired and checked');
  assert.equal(calls[3].options.method, 'PATCH'); assert.equal(calls[3].options.body.expected_version, 7);
});

function sharedApi(token, fetch) {
  let cleared = 0;
  const api = load('src/lib/api.ts', { '@/lib/auth-session': {
    getValidAccessToken: async () => token, clearAuthSession: () => { cleared++; },
  } }, { Headers, fetch, process: { env: { NEXT_PUBLIC_API_BASE_URL: 'https://api.example/' } } });
  return { api, get cleared() { return cleared; } };
}

test('shared transport preserves auth and lets the browser set the multipart boundary', async () => {
  const calls = [];
  const app = sharedApi('fresh-token', async (url, options) => { calls.push({ url, options }); return new Response('{}', { status: 200 }); });
  const form = new FormData(); form.set('notes', 'Done');
  await app.api.apiRequest('/api/v1/maintenance/tasks/id/evidence', { method: 'POST', body: form });
  await app.api.apiRequest('/api/v1/maintenance/tasks/id/progress', { method: 'PATCH', body: { notes: 'Done' } });
  assert.equal(calls[0].options.headers.get('Authorization'), 'Bearer fresh-token');
  assert.equal(calls[0].options.headers.has('Content-Type'), false); assert.equal(calls[0].options.body, form);
  assert.equal(calls[1].options.headers.get('Content-Type'), 'application/json');
  assert.equal(calls[1].options.body, '{"notes":"Done"}');
});

test('expired staff sessions and API denial never report a successful write', async () => {
  const expired = sharedApi(null, () => { throw Error('Must not send'); });
  await assert.rejects(expired.api.apiRequest('/api/v1/maintenance/tasks'), { status: 401 }); assert.equal(expired.cleared, 1);
  const denied = sharedApi('fixture', async () => new Response('{"detail":"Task not assigned"}', { status: 404 }));
  await assert.rejects(denied.api.apiRequest('/api/v1/maintenance/tasks/id/start', { method: 'POST', body: { expected_version: 1 } }), { status: 404 });
});

test('related reports find the same shared task rather than offering a duplicate assignment', async () => {
  const shared = { ...task(), related_ticket_ids: ['TICK-2026', 'RELATED-TICKET'] };
  const api = gateway(async () => page([shared]));
  assert.equal((await api.getReportTask('RELATED-TICKET')).id, shared.id);
  assert.equal(await api.getReportTask('UNRELATED'), null);
  assert.throws(() => api.validateTask({ ...shared, related_ticket_ids: 'RELATED-TICKET' }), { status: 503 });
});

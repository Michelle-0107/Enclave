/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function harness() {
  const slots = [], effects = [], timers = new Map(), calls = [], chosen = [];
  let cursor = 0, now = 0, nextTimer = 0;
  let responder = async () => ({ area_id: 'kl-east-pilot', items: [], storage: 'database' });
  let session = { access_token: 'resident' };
  const handle = { current: null };
  let props = { areaId: 'kl-east-pilot', query: 'KL East Mall', field: 'starting point', ref: handle, onChoose: point => chosen.push(point) };
  function changed(old, next) { return !old || next.some((value, i) => value !== old[i]); }
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
    useImperativeHandle(ref, create) { cursor++; if (ref) ref.current = create(); },
    useEffect(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    useLayoutEffect(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const module = { exports: {} };
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View', Keyboard: { dismiss() {} }, StyleSheet: { create: value => value } },
    '../theme': { colors: {} },
    '../lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session } }) } } },
    '../lib/api': { placesApi: { search: async (...args) => { calls.push(args); return responder(...args); } } },
  };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/navigation/PlaceSearch.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => dependencies[name], console, Error,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  function render(next = {}) { props = { ...props, ...next }; cursor = 0; const tree = module.exports.default(props); while (effects.length) effects.shift()(); return tree; }
  return { calls, chosen, handle, render,
    respond(fn) { responder = fn; }, signedOut() { session = null; },
    unmount() { for (const value of slots) value?.cleanup?.(); },
    async tick(ms = 350) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await new Promise(setImmediate); },
  };
}
function all(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(all); return [tree, ...all(tree.props?.children)]; }
function text(tree) { if (tree == null) return ''; if (typeof tree !== 'object') return String(tree); if (Array.isArray(tree)) return tree.map(text).join(' '); return text(tree.props?.children); }
function button(tree) { return all(tree).find(node => node.props?.accessibilityLabel === 'Search addresses and places'); }
function choices(tree) { return all(tree).filter(node => node.props?.accessibilityLabel?.startsWith('Choose place:')); }
function page(area = 'kl-east-pilot', count = 1) { return { area_id: area, storage: 'database', items: Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Place ${i}`, longitude: 101.73 + i * 0.0001, latitude: 3.225, address: '', position_basis: 'Mapped point' })) }; }

test('typing automatically searches only after the debounce and uses the current area and JWT', async () => {
  const h = harness(); h.render(); await h.tick(349); assert.equal(h.calls.length, 0);
  await h.tick(1); assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['resident', 'kl-east-pilot', 'KL East Mall']]);
  assert.ok(text(h.render()).includes('No matching address or place'));
});

test('typing quickly cancels earlier queued queries and short input never searches', async () => {
  const h = harness(); h.render({ query: 'K' }); await h.tick(1000); assert.equal(h.calls.length, 0);
  h.render({ query: 'KL' }); await h.tick(200); h.render({ query: 'KL East' }); await h.tick(200);
  assert.equal(h.calls.length, 0); await h.tick(150); assert.equal(h.calls[0][2], 'KL East');
  assert.equal(button(h.render({ query: 'a' })).props.disabled, true);
});

test('keyboard search and the search button submit immediately without a second debounce request', async () => {
  const h = harness(); h.render(); await h.handle.current.search(); assert.equal(h.calls.length, 1);
  await h.tick(1000); assert.equal(h.calls.length, 1);
  const other = harness(); await button(other.render()).props.onPress(); assert.equal(other.calls.length, 1);
  await other.tick(1000); assert.equal(other.calls.length, 1);
});

test('repeated submit while the same query is in flight sends one request', async () => {
  const h = harness(); let release; h.respond(() => new Promise(resolve => { release = resolve; })); h.render();
  const pending = h.handle.current.search(); await new Promise(setImmediate);
  await h.handle.current.search(); assert.equal(h.calls.length, 1);
  assert.equal(button(h.render()).props.disabled, true);
  assert.ok(all(h.render()).some(node => node.props?.accessibilityLabel === 'Searching places'));
  release(page()); await pending; assert.equal(choices(h.render()).length, 1);
});

test('late success from a previous query cannot overwrite the new result', async () => {
  const h = harness(); let release; h.respond(() => new Promise(resolve => { release = resolve; })); h.render();
  const pending = h.handle.current.search(); await new Promise(setImmediate);
  h.render({ query: 'Saujana', areaId: 'kajang-prima-saujana' }); h.respond(async () => page('kajang-prima-saujana', 2));
  await h.tick(); assert.equal(choices(h.render()).length, 2);
  release(page()); await pending; assert.equal(choices(h.render()).length, 2);
});

test('switching between start and destination invalidates the old request even for the same text', async () => {
  const h = harness(); let release; h.respond(() => new Promise(resolve => { release = resolve; })); h.render();
  const pending = h.handle.current.search(); await new Promise(setImmediate);
  h.render({ field: 'end point' }); release(page()); await pending;
  assert.equal(choices(h.render()).length, 0);
});

test('wrong-area results are rejected and search errors can be retried', async () => {
  const h = harness(); h.respond(async () => page('kajang-prima-saujana')); await button(h.render()).props.onPress();
  assert.ok(text(h.render()).includes('do not match')); assert.equal(choices(h.render()).length, 0);
  h.respond(async () => { throw Error('Temporary connection failure'); }); await button(h.render()).props.onPress();
  assert.ok(text(h.render()).includes('Temporary connection failure')); assert.equal(button(h.render()).props.disabled, false);
  h.respond(async () => page()); await button(h.render()).props.onPress(); assert.equal(choices(h.render()).length, 1);
});

test('three results are shown initially and choosing an expanded result preserves its exact database point', async () => {
  const h = harness(); h.respond(async () => page('kl-east-pilot', 7)); await button(h.render()).props.onPress();
  assert.equal(choices(h.render()).length, 3);
  all(h.render()).find(node => node.type === 'Pressable' && text(node) === 'Show more locations (4)').props.onPress();
  assert.equal(choices(h.render()).length, 7); assert.equal(h.chosen.length, 0);
  choices(h.render())[6].props.onPress();
  assert.equal(h.chosen[0].label, 'Place 6'); assert.equal(h.chosen[0].coordinate[0], page().items[0].longitude + 0.0006);
  assert.equal(h.chosen[0].coordinate[1], 3.225);
});

test('closing search cancels queued work and ignores requests already in flight', async () => {
  const h = harness(); h.render(); h.unmount(); await h.tick(1000); assert.equal(h.calls.length, 0);
  const other = harness(); let release; other.respond(() => new Promise(resolve => { release = resolve; })); other.render();
  const pending = other.handle.current.search(); await new Promise(setImmediate); other.unmount();
  release(page()); await pending; assert.equal(choices(other.render()).length, 0);
});

test('signed-out users see a sign-in message instead of invented results', async () => {
  const h = harness(); h.signedOut(); h.render(); await h.tick();
  assert.equal(h.calls.length, 0); assert.ok(text(h.render()).includes('Sign in again')); assert.equal(choices(h.render()).length, 0);
});

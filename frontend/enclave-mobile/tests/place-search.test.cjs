/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'src/navigation/map-places.json'), 'utf8'));
let states, cursor, calls, chosen, responder, cleanups;
const react = {
  useState(value) { const i = cursor++; if (!(i in states)) states[i] = value; return [states[i], next => { states[i] = next; }]; },
  useRef(value) { const i = cursor++; if (!(i in states)) states[i] = { current: value }; return states[i]; },
  useEffect(fn) { const i = cursor++; if (!(i in states)) { states[i] = true; cleanups.push(fn()); } },
};
const dependencies = {
  react,
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', Keyboard: { dismiss() {} }, StyleSheet: { create: value => value } },
  '../theme': { colors: {} }, './map-places.json': catalogue,
  '../lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'resident' } } }) } } },
  '../lib/api': { placesApi: { search: async (...args) => { calls.push(args); return responder(...args); } } },
};
const mod = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/navigation/PlaceSearch.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
vm.runInNewContext(code, { module: mod, exports: mod.exports, require: name => dependencies[name], console, Error });
const Screen = mod.exports.default;
function tree(query = 'KL East Mall', areaId = 'kl-east-pilot', field = 'starting point') {
  cursor = 0; return Screen({ query, areaId, field, onChoose: point => { chosen = point; } });
}
function all(t) { if (!t || typeof t !== 'object') return []; if (Array.isArray(t)) return t.flatMap(all); return [t, ...all(t.props?.children)]; }
function text(t) { if (t == null) return ''; if (typeof t !== 'object') return String(t); if (Array.isArray(t)) return t.map(text).join(' '); return text(t.props?.children); }
function button(t) { return all(t).find(n => n.props?.accessibilityLabel === 'Search addresses and places'); }
const results = [];
async function test(name, run) {
  states = []; cursor = 0; calls = []; chosen = null; cleanups = [];
  responder = async () => ({ area_id: 'kl-east-pilot', items: [], storage: 'database' });
  try { await run(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); }
}
void (async () => {
  await test('Place choices come from database search rather than an independent bundled catalogue', () => {
    const t = tree('20 Jalan Saujana Mutiara 3', 'kajang-prima-saujana');
    assert.equal(calls.length, 0);
    const result = all(t).find(n => n.props?.accessibilityLabel === 'Choose place: 20 Jalan Saujana Mutiara 3');
    assert.equal(result, undefined); assert.equal(chosen, null);
    assert.ok(!text(tree('20 Jalan Saujana Mutiara 3')).includes('Choose place: 20 Jalan Saujana Mutiara 3'));
  });
  await test('Search happens only on explicit action and carries the area and JWT', async () => {
    await button(tree()).props.onPress();
    assert.equal(JSON.stringify(calls), JSON.stringify([['resident', 'kl-east-pilot', 'KL East Mall']]));
    assert.ok(text(tree()).includes('No matching address or place'));
    assert.ok(button(tree('a')).props.disabled);
  });
  await test('Delayed result from an old input cannot replace the new query', async () => {
    let release;
    responder = () => new Promise(resolve => { release = resolve; });
    const pending = button(tree()).props.onPress(); await new Promise(setImmediate);
    tree('Saujana', 'kajang-prima-saujana');
    release({ area_id: 'kl-east-pilot', items: [], storage: 'database' }); await pending;
    assert.ok(!text(tree('Saujana', 'kajang-prima-saujana')).includes('No matching address or place'));
  });
  await test('Result from a different area is rejected and is not selectable', async () => {
    responder = async () => ({ area_id: 'kajang-prima-saujana', items: [], storage: 'database' });
    await button(tree()).props.onPress(); assert.ok(text(tree()).includes('do not match'));
  });
  await test('Network failure allows retry without inventing database search results', async () => {
    responder = async () => { throw Error('Temporary connection failure'); };
    await button(tree()).props.onPress();
    assert.ok(text(tree()).includes('Temporary connection failure')); assert.equal(all(tree()).filter(n => n.props?.accessibilityLabel?.startsWith('Choose place:')).length, 0);
    assert.equal(button(tree()).props.disabled, false);
  });
  await test('Closing search ignores an in-flight request', async () => {
    let release;
    responder = () => new Promise(resolve => { release = resolve; });
    const pending = button(tree()).props.onPress(); await new Promise(setImmediate);
    cleanups.forEach(fn => fn?.());
    release({ area_id: 'kl-east-pilot', items: [], storage: 'database' }); await pending;
    assert.equal(states[3], null);
  });
  console.log(JSON.stringify(results, null, 2)); process.exitCode = results.some(row => !row.passed) ? 1 : 0;
})();

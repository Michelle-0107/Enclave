/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, console, Error, setTimeout, clearTimeout,
    require(name) { if (name in dependencies) return dependencies[name]; throw Error(`Unexpected import ${name}`); },
  });
  return mod.exports;
}
const { createSavedPlacesStore, placeInput } = load('src/savedPlaces/store.ts');
const point = { label: '  My   Home  ', coordinate: [101.730755, 3.22649] };
function client() {
  const state = { user: 'A', error: null, data: [], calls: [] };
  const sdk = {
    auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null }, error: null }) },
    from(table) {
      const call = { table, filters: [] }; state.calls.push(call);
      const q = {
        select(columns) { call.columns = columns; return q; },
        insert(values) { call.action = 'insert'; call.values = values; return q; },
        update(values) { call.action = 'update'; call.values = values; return q; },
        delete() { call.action = 'delete'; return q; },
        eq(key, value) { call.filters.push([key, value]); return q; },
        order(key) { call.order = key; return q; },
        single() { return Promise.resolve({ data: state.data, error: state.error }); },
        then(ok, fail) { return Promise.resolve({ data: state.data, error: state.error }).then(ok, fail); },
      }; return q;
    },
  };
  return { state, store: createSavedPlacesStore(sdk) };
}
function hooks() {
  let cursor = 0; const slots = [];
  return { reset() { cursor = 0; }, react: {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn,
  } };
}
const native = Object.fromEntries(['ActivityIndicator','Alert','Camera','Map','Marker','GeoJSONSource','Layer','Pressable','Text','TextInput','View','Modal'].map(x => [x,x]));
native.StyleSheet = { create: value => value };
native.Keyboard = { dismiss() {} };
native.Alert = { alert() {} };
native.Linking = { openURL: async () => {} };
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}
function words(tree) {
  if (tree == null) return '';
  if (typeof tree !== 'object') return String(tree);
  return Array.isArray(tree) ? tree.map(words).join(' ') : words(tree.props?.children);
}
function button(tree, title) {
  const found = elements(tree).find(x => x.type === 'Pressable' && (x.props.accessibilityLabel === title || words(x).trim() === title));
  assert.ok(found, `Missing button ${title}`); return found;
}
function screen(file, extras = {}, props = {}) {
  const runtime = hooks();
  const Screen = load(file, { react: runtime.react, 'react/jsx-runtime': jsx, 'react-native': native,
    '../lib/api': {}, '../lib/supabase': {}, './navigationProgress': {},
    '../lib/map-issue-layers': load('src/lib/map-issue-layers.ts'),
    '../components/DataSkeleton': { SkeletonBlock: 'SkeletonBlock', SkeletonList: 'SkeletonList' },
    '../navigation/NativeMap': { NativeMap: 'Map' }, '@maplibre/maplibre-react-native': native, '../theme': { colors: {} },
    '../navigation/NamedMapPoint': { __esModule: true, default: 'NamedMapPoint', useMapPointName: () => null },
    '../savedPlaces/SavedPlacesControl': { __esModule: true, default: 'SavedPlacesControl' }, ...extras,
    '../navigation/PlaceSearch': { __esModule: true, default: 'PlaceSearch' },
  }).default;
  return () => { runtime.reset(); return Screen(props); };
}
const cases = [];
async function test(name, fn) { await fn(); cases.push(name); console.log('PASS: ' + name); }
async function main() {
  await test('Validate names and coordinates before any write; preserve longitude/latitude order', () => {
    const values = placeInput(point);
    assert.equal(values.name, 'My Home'); assert.equal(values.latitude, 3.22649); assert.equal(values.longitude, 101.730755);
    for (const invalid of [{ ...point, label: ' ' }, { ...point, label: 'a'.repeat(61) },
      { ...point, coordinate: [NaN, 3] }, { ...point, coordinate: [181,3] }, { ...point, coordinate: [101,91] }]) {
      assert.throws(() => placeInput(invalid));
    }
  });
  await test('Signed-out user makes no table request', async () => {
    const { state, store } = client(); state.user = null;
    await assert.rejects(store.list(), /sign in/); await assert.rejects(store.save(point), /sign in/);
    await assert.rejects(store.remove('x'), /sign in/); assert.equal(state.calls.length, 0);
  });
  await test('Read filter follows current authenticated account, with no shared cache', async () => {
    const { state, store } = client(); state.data = [{ id: 'x', name: 'Home', latitude: 3.22649, longitude: 101.730755 }];
    const rows = await store.list(); assert.equal(rows[0].coordinate[0], 101.730755);
    assert.equal(state.calls[0].filters[0][1], 'A'); state.user = 'B'; await store.list();
    assert.equal(state.calls[1].filters[0][1], 'B');
  });
  await test('Create binds owner explicitly so account switching cannot retarget a write', async () => {
    const { state, store } = client(); state.data = { id: 'x', name: 'Home', latitude: 3.22649, longitude: 101.730755 };
    await store.save(point); const call = state.calls[0]; assert.equal(call.values.user_id, 'A'); assert.equal(call.values.name, 'My Home');
  });
  await test('Edit/delete target both place ID and current owner', async () => {
    const { state, store } = client(); state.data = { id: 'x', name: 'Office', latitude: 3.22, longitude: 101.73 };
    await store.save(point, 'x'); await store.remove('x');
    for (const call of state.calls) { assert.equal(JSON.stringify(call.filters), JSON.stringify([['id','x'],['user_id','A']])); }
    assert.equal(state.calls[0].values.user_id, undefined);
  });
  await test('Missing migration, duplicate name and permissions errors are actionable; never fake success', async () => {
    for (const [code, pattern] of [['PGRST205', /migration 012/], ['23505', /already/], ['42501', /denied/], ['NETWORK', /connection/]]) {
      const { state, store } = client(); state.error = { code };
      await assert.rejects(store.list(), pattern); await assert.rejects(store.save(point), pattern); await assert.rejects(store.remove('x'), pattern);
    }
  });
  const auth = { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic' } } }) } } };
  await test('Live overview chooses saved endpoints and forwards numeric coordinates, not just labels', () => {
    let sent;
    const render = screen('src/screens/MapScreen.tsx', { '../lib/api': {}, '../lib/supabase': auth },
      { onReportPress() {}, onChooseRoute: (...args) => { sent = args; } });
    let tree = render(); let controls = elements(tree).filter(x => x.type === 'SavedPlacesControl');
    assert.ok(controls.every(x => x.props.current === null));
    controls[0].props.onChoose({ id: 'a', label: 'Home', coordinate: [101.730755,3.22649] });
    tree = render(); controls = elements(tree).filter(x => x.type === 'SavedPlacesControl');
    controls[1].props.onChoose({ id: 'b', label: 'Gym', coordinate: [101.7315,3.225] });
    tree = render(); button(tree, 'Choose route').props.onPress();
    assert.equal(sent[0], 'Home'); assert.equal(sent[1], 'Gym');
    assert.equal(sent[2].origin.longitude,101.730755); assert.equal(sent[2].destination.latitude,3.225);
    elements(tree).find(x => x.type === 'TextInput').props.onChangeText('Different place');
    sent = null;
    tree = render(); button(tree, 'Choose route').props.onPress(); assert.equal(sent, null, 'Typed labels require selecting a resolved location');
  });
  await test('Live routing initializes from saved coordinates and uses replacement presets in all three API modes', async () => {
    const sent = [];
    const render = screen('src/screens/RouteOptionsScreen.tsx', { '../lib/supabase': auth, '../lib/api': {
      ApiError: class extends Error {}, navigationApi: { getRoute: async (_token, body) => {
        sent.push(body); return { geometry: { type:'LineString', coordinates:[[101.73,3.22],[101.731,3.225]] }, distance_meters:150, duration_seconds:120 };
      } },
    } }, { start: 'Home', destination: 'Gym', initialOrigin: {longitude:101.730755,latitude:3.22649}, initialDestination: {longitude:101.7315,latitude:3.225}, onBack() {} });
    let tree = render(); assert.equal(button(tree, 'Find routes').props.disabled, false);
    const controls = elements(tree).filter(x => x.type === 'SavedPlacesControl');
    controls[0].props.onChoose({ id: 'new', label: 'Office', coordinate: [101.732,3.227] });
    tree = render(); button(tree, 'Find routes').props.onPress();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(sent.length, 3); assert.ok(sent.every(x => x.origin.longitude === 101.732 && x.origin.latitude === 3.227 && x.destination.longitude === 101.7315));
    tree = render(); assert.ok(words(tree).includes('150 m'));
    elements(tree).find(x => x.type === 'SavedPlacesControl' && x.props.field === 'destination').props.onChoose({ id:'end',label:'Park',coordinate:[101.733,3.228] });
    assert.ok(!words(render()).includes('150 m'), 'Changing a preset must invalidate calculated routes');
  });
  await test('Resident demo uses saved coordinates for both endpoint markers', () => {
    const render = screen('src/demo/DemoMapScreen.tsx', {
      '@expo/vector-icons': { MaterialCommunityIcons:'Icon' }, 'expo-location': {}, './JourneyGuidance': { __esModule:true,default:'Guidance' },
      './driving': {}, './access': { planJourney: () => ({ direct: [] }) },
      './network': { dataset: { facilities:[],landmarks:[],bbox:[101.721,3.217,101.741,3.235] }, initialScenario:()=>({}), searchPlaces:()=>[],
        insidePilot:()=>true, selectLocation:(label,coordinate)=>({label,coordinate}), labels:{}, meters:()=>0 },
    }, { onShowLiveMap() {} });
    let tree=render(); let control=elements(tree).find(x=>x.type==='SavedPlacesControl');
    assert.equal(control.props.field,'starting point');
    control.props.onChoose({id:'a',label:'Home',coordinate:[101.73,3.22]});
    tree=render(); control=elements(tree).find(x=>x.type==='SavedPlacesControl');
    assert.equal(control.props.field,'end point');
    control.props.onChoose({id:'b',label:'Gym',coordinate:[101.731,3.225]});
    tree=render(); const inputs=elements(tree).filter(x=>x.type==='TextInput');
    assert.equal(inputs[0].props.value,'Home'); assert.equal(inputs[1].props.value,'Gym');
    const markers=elements(tree).filter(x=>x.type==='Marker');
    assert.equal(markers[0].props.lngLat[0],101.73); assert.equal(markers[1].props.lngLat[1],3.225);
  });
  for (const file of ['src/screens/MapScreen.tsx', 'src/screens/RouteOptionsScreen.tsx']) {
    await test(`${file}: map keeps the page still through a two-finger gesture and releases on cancel/end`, () => {
      const changes = [];
      const render = screen(file, { '../lib/api': {}, '../lib/supabase': auth }, {
        start: '', destination: '', onBack() {}, onReportPress() {}, onStartJourney() {},
        onMapTouchChange: active => changes.push(active),
      });
      const tree = render();
      const map = elements(tree).find(item => item.type === 'Map');
      assert.equal(map.props.dragPan, true);
      assert.equal(map.props.touchZoom, true);
      assert.equal(map.props.doubleTapZoom, true);
      const container = elements(tree).find(item => item.type === 'View' && item.props.onTouchStart);
      container.props.onTouchStart();
      container.props.onTouchEnd({ nativeEvent: { touches: [{}] } });
      assert.equal(JSON.stringify(changes), '[true]', 'Keep scroll locked while one finger remains');
      container.props.onTouchEnd({ nativeEvent: { touches: [] } });
      assert.equal(JSON.stringify(changes), '[true,false]');
      container.props.onTouchStart(); container.props.onTouchCancel();
      assert.equal(JSON.stringify(changes), '[true,false,true,false]', 'Cancellation must restore page scrolling');
    });
  }
  console.log(`${cases.length} saved places checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode=1; });

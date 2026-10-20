const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
function compile(file, deps, globals = {}, exportName) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText + (exportName ? `\nmodule.exports.default = ${exportName};` : ''), { module: mod, exports: mod.exports, require: name => { if (name in deps) return deps[name]; throw Error('Unexpected import ' + name); }, console, ...globals });
  return mod.exports.default;
}
function all(t) { return !t || typeof t !== 'object' ? [] : Array.isArray(t) ? t.flatMap(all) : [t, ...all(t.props?.children)]; }
function runtime() {
  const values = [], effects = [], cleanups = [], dependencies = []; let cursor = 0;
  return { reset: () => { cursor = 0; }, flush: () => { while (effects.length) effects.shift()(); }, unmount: () => cleanups.forEach(fn => fn?.()),
    react: { useState(initial) { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], next => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
      useRef(initial) { const i = cursor++; if (!(i in values)) values[i] = { current: initial }; return values[i]; },
      useEffect(fn, deps) { const i = cursor++; if (!dependencies[i] || deps.some((v, n) => dependencies[i][n] !== v)) { cleanups[i]?.(); dependencies[i] = deps; effects.push(() => { cleanups[i] = fn(); }); } },
    } };
}
function harness() {
  const hooks = runtime(), touches = [], selected = [], cameras = []; let tree;
  const native = Object.fromEntries(['View', 'Text', 'TextInput', 'Pressable', 'Modal', 'ActivityIndicator', 'Image'].map(name => [name, name]));
  native.Keyboard = { dismiss() {} }; native.StyleSheet = { create: value => value };
  const deps = { react: hooks.react, 'react/jsx-runtime': jsx, 'react-native': native,
    '../navigation/NativeMap': { NativeMap: 'Map' }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@maplibre/maplibre-react-native': { Camera: 'Camera', Marker: 'Marker' }, 'expo-location': {},
    '../navigation/SharedLocationPicker': { __esModule: true, default: 'PlacePicker' }, '../theme': { colors: {} },
    '../facilities/ReportFacilityPoints': { useReportFacilityPoints: () => ({ facilities: [{ id: 'one', latitude: 3.225, longitude: 101.731 }], loading: false, error: '', reload() {} }), ReportFacilityMarkers: 'Facilities', ReportFacilityHint: 'Hint' },
  };
  const Screen = compile('src/screens/ReportLocationScreen.tsx', deps);
  const onMapTouchChange = value => touches.push(value);
  function render() { hooks.reset(); tree = Screen({ onMapTouchChange, onDetailsChange: value => selected.push(value), onBack() {} }); hooks.flush();
    const camera = all(tree).find(n => n.type === 'Camera'); camera.props.ref.current = { easeTo: value => cameras.push(value) }; return tree; }
  function find(predicate) { const node = all(tree).find(predicate); assert.ok(node, 'UI element missing'); return node; }
  return { render, find, touches, selected, cameras, unmount: hooks.unmount };
}
test('Report map holds page scrolling until the final finger releases, cancels and unmounts safely', () => {
  const h = harness(); h.render();
  const area = h.find(n => n.type === 'View' && n.props.onTouchStart);
  area.props.onTouchStart(); assert.equal(h.touches.at(-1), true);
  area.props.onTouchEnd({ nativeEvent: { touches: [{}] } }); assert.equal(h.touches.at(-1), true);
  area.props.onTouchEnd({ nativeEvent: { touches: [] } }); assert.equal(h.touches.at(-1), false);
  area.props.onTouchStart(); area.props.onTouchCancel(); assert.equal(h.touches.at(-1), false);
  area.props.onTouchStart(); h.unmount(); assert.equal(h.touches.at(-1), false);
});
test('Full-screen picker keeps the exact pin, camera position and zoom when returning to the form', () => {
  const h = harness(); h.render();
  h.find(n => n.type === 'Map').props.onRegionDidChange({ nativeEvent: { center: [101.732, 3.226], zoom: 18 } });
  h.find(n => n.props.accessibilityLabel === 'Expand report map').props.onPress(); h.render();
  assert.equal(h.find(n => n.type === 'Modal').props.visible, true);
  assert.equal(all(h.render()).filter(n => n.type === 'Map').length, 1);
  assert.equal(JSON.stringify(h.find(n => n.type === 'Camera').props.initialViewState), JSON.stringify({ center: [101.732, 3.226], zoom: 18 }));
  h.find(n => n.type === 'Map').props.onPress({ nativeEvent: { lngLat: [101.7325, 3.2265] } }); h.render();
  assert.equal(h.selected.at(-1).coordinates.longitude, 101.7325); assert.equal(h.selected.at(-1).coordinates.latitude, 3.2265);
  h.find(n => n.props.accessibilityLabel === 'Zoom in report map').props.onPress(); assert.equal(h.cameras.at(-1).zoom, 19);
  h.find(n => n.type === 'Modal').props.onRequestClose(); h.render();
  assert.ok(!all(h.render()).some(n => n.type === 'Modal'));
  assert.equal(JSON.stringify(h.find(n => n.props.id === 'report-location').props.lngLat), JSON.stringify([101.7325, 3.2265]));
  assert.equal(h.find(n => n.type === 'Camera').props.initialViewState.zoom, 19); assert.equal(h.touches.at(-1), false);
});
test('Report facility markers are optional and showing them does not relocate the issue pin', () => {
  const h = harness(); h.render(); assert.ok(!all(h.render()).some(n => n.type === 'Facilities'));
  h.find(n => n.props.accessibilityLabel === 'Show report facility markers').props.onPress(); h.render();
  assert.equal(h.find(n => n.type === 'Facilities').props.facilities.length, 1); assert.equal(h.selected.length, 0);
  const map = h.find(n => n.type === 'Map'); assert.ok(map.props.dragPan && map.props.touchZoom && map.props.doubleTapZoom);
});

test('Report photo-to-location flow forwards the page scroll lock callback to the map', () => {
  const hooks = runtime(); const lock = () => {};
  const Screen = compile('src/screens/ReportScreen.tsx', {
    react: hooks.react, 'react/jsx-runtime': jsx,
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', Image: 'Image', StyleSheet: { create: value => value } },
    './ReportPhotoScreen': { __esModule: true, default: 'Photo' },
    './ReportLocationScreen': { __esModule: true, default: 'Location' }, './ReportSuccessScreen': {},
    '../lib/api': {}, '../lib/supabase': {}, '../lib/road-report-sections': {}, '../theme': { colors: {} },
  });
  function render() { hooks.reset(); const tree = Screen({ onGoHome() {}, onViewReports() {}, onReportCreated() {}, onMapTouchChange: lock }); hooks.flush(); return tree; }
  const photo = all(render()).find(n => n.type === 'Photo');
  photo.props.onContinue({ uri: 'file:///synthetic.jpg', width: 100, height: 100 });
  const location = all(render()).find(n => n.type === 'Location');
  assert.ok(location); assert.equal(location.props.onMapTouchChange, lock);
});

test('report upload keeps the selected location ID, actual pin and returned name through issue linking', async () => {
  const hooks = runtime(), uploads = [], links = [], reports = [], alerts = [];
  class FixtureFormData {
    constructor() { this.parts = []; }
    append(key, value) { this.parts.push([key, value]); }
  }
  const coordinates = { latitude: 3.225, longitude: 101.731 };
  const record = { ticket_id: 'SYNTHETIC-REPORT', ...coordinates, location_name: 'Taman Melati Station', description: 'Broken station entrance' };
  const Screen = compile('src/screens/ReportScreen.tsx', {
    react: hooks.react, 'react/jsx-runtime': jsx,
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', Image: 'Image', StyleSheet: { create: value => value }, Alert: { alert: (...args) => alerts.push(args) } },
    './ReportPhotoScreen': { __esModule: true, default: 'Photo' },
    './ReportLocationScreen': { __esModule: true, default: 'Location' },
    './ReportSuccessScreen': { __esModule: true, default: 'Success' },
    '../lib/api': {
      reportsApi: { submit: async (token, form) => { uploads.push({ token, form }); return { ticket_id: record.ticket_id, data: [record] }; } },
      communityIssuesApi: { createOrLink: async (token, input) => { links.push({ token, input }); return { community_visible: false, issue: { reporter_count: 1 } }; } },
    },
    '../lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) } } },
    '../lib/road-report-sections': {}, '../theme': { colors: {} },
  }, { FormData: FixtureFormData });
  function render() { hooks.reset(); const tree = Screen({ onGoHome() {}, onViewReports() {}, onReportCreated: report => reports.push(report) }); hooks.flush(); return tree; }
  all(render()).find(n => n.type === 'Photo').props.onContinue({ uri: 'file:///station.jpg', fileName: 'station.jpg', mimeType: 'image/jpeg' });
  all(render()).find(n => n.type === 'Location').props.onDetailsChange({ coordinates, description: record.description });
  const selection = all(render()).find(n => n.type === 'Location').props.children;
  selection.props.onSubmit({ facility: { id: 'station-location-id', ...coordinates }, faultKind: 'damage' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(uploads.length, 1); assert.equal(uploads[0].token, 'fixture-token');
  const parts = Object.fromEntries(uploads[0].form.parts);
  assert.equal(parts.location_id, 'station-location-id'); assert.equal(parts.latitude, String(coordinates.latitude)); assert.equal(parts.longitude, String(coordinates.longitude));
  assert.equal(parts.file.uri, 'file:///station.jpg'); assert.equal(parts.description, record.description);
  assert.equal(links.length, 1); assert.equal(links[0].input.facility_id, parts.location_id); assert.equal(links[0].input.report_ticket_id, record.ticket_id);
  assert.equal(reports[0].location, record.location_name); assert.equal(alerts.length, 0);
  assert.ok(all(render()).some(n => n.type === 'Success'));
});

test('report list and details retain the shared location name as well as numeric navigation coordinates', () => {
  const deps = {
    react: {}, 'react/jsx-runtime': jsx,
    'react-native': { StyleSheet: { create: value => value } },
    '../navigation/NativeMap': {}, '@maplibre/maplibre-react-native': {}, '@expo/vector-icons': {},
    '../lib/api': {}, '../lib/supabase': {}, '../theme': { colors: {} },
  };
  const record = { ticket_id: 'SYNTHETIC-REPORT', location_name: 'Taman Melati Station', latitude: 3.225, longitude: 101.731, status: 'approved' };
  for (const file of ['MyReportsScreen.tsx', 'ReportDetailsScreen.tsx']) {
    const map = compile('src/screens/' + file, deps, {}, 'mapReportRecord');
    const report = map(record);
    assert.equal(report.location, record.location_name); assert.equal(report.latitude, record.latitude); assert.equal(report.longitude, record.longitude);
    assert.equal(report.status, 'Approved for maintenance');
    assert.equal(map({ ...record, location_name: null }).location, 'Selected map point');
  }
});

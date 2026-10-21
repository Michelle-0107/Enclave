/* global __dirname */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/navigation/NativeMap.tsx'), 'utf8');
let cursor = 0; const state = [], effects = [], requests = [];
const react = {
  useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
    return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
  useMemo(fn) { return fn(); },
  useEffect(fn, deps) { const i = cursor++; const old = state[i];
    if (!old || deps.some((d, n) => d !== old.deps[n])) { old?.cleanup?.(); const next = { deps }; state[i] = next; effects.push(() => { next.cleanup = fn(); }); } },
};
const moduleResult = { exports: {} }, native = { ActivityIndicator: 'Spinner', Pressable: 'Button', Text: 'Text', View: 'View', StyleSheet: { create: x => x } };
const deps = {
  react, 'react-native': native,
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  '../components/DataSkeleton': { SkeletonMap: 'SkeletonMap' },
  '@maplibre/maplibre-react-native': { Map: 'NativeMap', GeoJSONSource: 'GeoJSONSource', Layer: 'Layer' },
  './nativeMapStyle': {
    normalizeNativeMapStyle: style => ({ ...style, normalized: true }),
    loadNativeMapStyle: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
  },
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module: moduleResult, exports: moduleResult.exports, require: name => { assert.ok(name in deps, name); return deps[name]; } });
function render(props) { cursor = 0; const tree = moduleResult.exports.NativeMap(props); while (effects.length) effects.shift()(); return tree; }
const tick = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  const props = { mapStyle: 'https://example.invalid/first', androidView: 'texture', style: { height: 300 }, children: 'Camera and route', ref: {}, onPress() {}, onDidFinishLoadingMap() {} };
  assert.equal(render(props).type, 'View', 'Never mount native renderer with unfiltered remote style');
  const first = requests[0];
  const changed = { ...props, mapStyle: 'https://example.invalid/second' }; render(changed);
  first.resolve({ name: 'stale' }); await tick();
  assert.equal(render(changed).type, 'View', 'An old response cannot mount the wrong basemap');
  requests[1].reject(Error('offline')); await tick();
  const failed = render(changed);
  const retry = failed.props.children.props.children.find(node => node?.type === 'Button');
  retry.props.onPress(); assert.equal(render(changed).type, 'View'); assert.equal(requests.length, 3);
  const fixed = { name: 'filtered style' }; requests[2].resolve(fixed); await tick();
  const map = render(changed); assert.equal(map.type, 'NativeMap'); assert.equal(map.props.mapStyle, fixed);
  for (const key of ['androidView', 'style', 'children', 'ref', 'onPress', 'onDidFinishLoadingMap']) assert.equal(map.props[key], props[key], key);
  const inline = render({ ...props, mapStyle: { version: 8, sources: {}, layers: [] } });
  assert.equal(inline.type, 'NativeMap'); assert.equal(inline.props.mapStyle.normalized, true);
  assert.equal(requests.length, 3, 'Inline styles need no request');
  for(const bounds of [[101.721,3.217,101.741,3.235],[101.8,2.9,101.9,3.1]]){
    const boundaryMap=render({...props,mapStyle:{version:8,sources:{},layers:[]},serviceAreaBounds:bounds});
    assert.equal(boundaryMap.props.children[1],props.children);
    const source=boundaryMap.props.children[0],line=source.props.children;
    assert.equal(source.type,'GeoJSONSource');assert.equal(line.type,'Layer');
    const [w,s,e,n]=bounds;
    assert.equal(JSON.stringify(source.props.data.geometry.coordinates),JSON.stringify([[w,s],[e,s],[e,n],[w,n],[w,s]]));
    assert.equal(JSON.stringify(line.props.paint['line-dasharray']),'[4,3]');
    assert.equal(boundaryMap.props.serviceAreaBounds,undefined,'App-only bounds must not leak into native Map props');
  }
  console.log('PASS: native map waits for correction, ignores stale responses, retries and forwards camera/route/ref/events');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

/* global __dirname */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const mobile=path.resolve(__dirname,'..'),backend=path.resolve(mobile,'../../backend');
const read=name=>JSON.parse(fs.readFileSync(path.join(backend,'data',name),'utf8'));
const kl=read('demo_areas/kl-east-pilot.json'),kajang=read('demo_areas/kajang-prima-saujana.json'),catalog=read('service_areas.json');
function compile(file,deps){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(mobile,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,
 {module:mod,exports:mod.exports,require(name){if(name in deps)return deps[name];throw Error('Unexpected import '+name);},Error,console,Promise,setTimeout,clearTimeout});return mod.exports;}
const network=compile('src/demo/network.ts',{'./kl-east-demo.json':kl});
const access=compile('src/demo/access.ts',{'./network':network}),driving=compile('src/demo/driving.ts',{'./network':network});
const jsx={jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
const native=Object.fromEntries(['ActivityIndicator','Text','View','Pressable','TextInput','Modal','Map','Marker','Camera','GeoJSONSource','Layer'].map(x=>[x,x]));
native.StyleSheet={create:x=>x};native.Keyboard={dismiss(){}};native.Linking={openURL:async()=>{}};
function runtime(runEffects){let cursor=0;const state=[],effects=new Set(),pending=[],cleanups=[];return{reset(){cursor=0;},flush(){for(const fn of pending.splice(0)){const cleanup=fn();if(cleanup)cleanups.push(cleanup);}},unmount(){for(const fn of cleanups)fn();},react:{
 useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];},
 useRef(initial){const i=cursor++;if(!(i in state))state[i]={current:initial};return state[i];},useMemo:fn=>fn(),useCallback:fn=>fn,
 useEffect(fn){const i=cursor++;if(runEffects&&!effects.has(i)){effects.add(i);pending.push(fn);}},
}};}
function nodes(t){if(!t||typeof t!=='object')return[];if(Array.isArray(t))return t.flatMap(nodes);return[t,...nodes(t.props?.children)];}
function text(t){if(t==null)return'';if(typeof t!=='object')return String(t);return Array.isArray(t)?t.map(text).join(' '):text(t.props?.children);}
function find(t,fn){const n=nodes(t).find(fn);assert.ok(n,'Expected UI node');return n;}
function button(t,label){return find(t,n=>n.type==='Pressable'&&(n.props.accessibilityLabel===label||text(n).trim()===label));}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function wrapper(api){const hooks=runtime(true),touches=[];const Screen=compile('src/demo/ServiceAreaDemoScreen.tsx',{
 react:hooks.react,'react/jsx-runtime':jsx,'react-native':native,'../theme':{colors:{}},'./network':network,
 './DemoMapScreen':{__esModule:true,default:'DemoMapScreen'},'../lib/api':{demoAreasApi:api},
 '../lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}}})}}},
}).default;return{unmount:()=>hooks.unmount(),render(){hooks.reset();const t=Screen({onShowLiveMap(){},onMapTouchChange:x=>touches.push(x)});hooks.flush();return t;},touches};}
function dataFor(id){return{area_id:id,dataset:id==='kl-east-pilot'?kl:kajang};}
async function main(){let count=0;async function test(name,fn){await fn();count++;console.log('PASS: '+name);}
 await test('Both independent backend graphs validate and the gap is outside both service areas',()=>{
  assert.equal(network.validateDataset(kajang),kajang);assert.equal(network.validateDataset(kl),kl);
  assert.equal(network.insidePilot([101.77,3.11],kajang),false);assert.equal(network.insidePilot([101.77,3.11],kl),false);
  const invalid=structuredClone(kajang);invalid.center=kl.center;assert.throws(()=>network.validateDataset(invalid));
 });
 const edge=kajang.edges.find(e=>e.direction==='both'&&e.baseStepFree&&e.geometry.length===2&&network.meters(...e.geometry)>50);
 assert.ok(edge);const interp=t=>edge.geometry[0].map((x,i)=>x+(edge.geometry[1][i]-x)*t),a=interp(0.15),b=interp(0.85);
 await test('Kajang walking, avoidance and wheelchair routes use Kajang roads; cross-region points are rejected',()=>{
  const result=network.calculateProfileRoutes('walking',a,b,kajang);assert.equal(result.length,3);assert.ok(result.every(x=>x.route&&x.route.distance>5));
  const wheelchair=network.calculateProfileRoutes('wheelchair',a,b,kajang);assert.ok(wheelchair[0].route);
  assert.throws(()=>network.calculateProfileRoutes('walking',kl.center,b,kajang));
  const url=new URL(driving.drivingDirectionsUrl(a,b,kajang));assert.equal(url.searchParams.get('origin'),`${a[1]},${a[0]}`);
 });
 await test('Demo screen passes the supplied graph to place search, endpoint selection and route calculation',()=>{
  const hooks=runtime(false);const Screen=compile('src/demo/DemoMapScreen.tsx',{
   react:hooks.react,'react/jsx-runtime':jsx,'react-native':native,'../navigation/NativeMap':{NativeMap:'Map'},'@maplibre/maplibre-react-native':native,
   '@expo/vector-icons':{MaterialCommunityIcons:'Icon'},'expo-location':{},'../theme':{colors:{}},'./network':network,'./access':access,'./driving':driving,
   './JourneyGuidance':{__esModule:true,default:'JourneyGuidance'},'../savedPlaces/SavedPlacesControl':{__esModule:true,default:'SavedPlacesControl'},
  }).default;
  const render=()=>{hooks.reset();return Screen({data:kajang,onShowLiveMap(){}});};
  let tree=render();assert.equal(JSON.stringify(find(tree,n=>n.type==='Camera').props.initialViewState.bounds),JSON.stringify(kajang.bbox));
  let input=find(tree,n=>n.type==='TextInput'&&n.props.accessibilityLabel==='Starting point');input.props.onChangeText(kajang.landmarks[0].name);
  tree=render();assert.ok(text(tree).includes(kajang.landmarks[0].name));
  let pick=find(tree,n=>n.type==='SavedPlacesControl'&&n.props.field==='starting point');pick.props.onChoose({label:'Local start',coordinate:a});
  tree=render();pick=find(tree,n=>n.type==='SavedPlacesControl'&&n.props.field==='destination');pick.props.onChoose({label:'Local destination',coordinate:b});
  tree=render();button(tree,'Choose route').props.onPress();tree=render();
  assert.ok(nodes(tree).some(n=>n.props?.id==='demo-selected-route'));assert.ok(text(tree).includes(kajang.name));
 });
 await test('Generic area discovery loads server default and switching remounts the selected dataset',async()=>{
  const calls=[];const app=wrapper({getAll:async()=>catalog,getDataset:async(_token,id)=>{calls.push(id);return dataFor(id);}});
  app.render();await tick();let tree=app.render();const first=find(tree,n=>n.type==='DemoMapScreen');assert.equal(first.props.data,kl);
  button(tree,'Service area: Prima Saujana, Kajang').props.onPress();await tick();tree=app.render();const second=find(tree,n=>n.type==='DemoMapScreen');
  assert.equal(second.props.data,kajang);assert.notEqual(first.key,second.key);assert.equal(calls.join(','),'kl-east-pilot,kajang-prima-saujana');assert.equal(app.touches[0],false);
 });
 await test('A future server-configured area needs no new frontend location constants',async()=>{
  const extra={...catalog.items[1],id:'synthetic-test-area',name:'Synthetic test area'};
  const app=wrapper({getAll:async()=>({...catalog,items:[...catalog.items,extra]}),getDataset:async(_token,id)=>({area_id:id,dataset:id==='kl-east-pilot'?kl:kajang})});
  app.render();await tick();button(app.render(),'Service area: Synthetic test area').props.onPress();await tick();assert.equal(find(app.render(),n=>n.type==='DemoMapScreen').props.data,kajang);
 });
 await test('Wrong-area responses never replace the current map',async()=>{
  const app=wrapper({getAll:async()=>catalog,getDataset:async(_token,id)=>id==='kl-east-pilot'?dataFor(id):{area_id:'wrong-area',dataset:kajang}});
  app.render();await tick();button(app.render(),'Service area: Prima Saujana, Kajang').props.onPress();await tick();const tree=app.render();
  assert.equal(find(tree,n=>n.type==='DemoMapScreen').props.data,kl);assert.ok(text(tree).includes('does not match'));
 });
 await test('Older/offline backends keep the existing map explicitly labelled as a built-in snapshot',async()=>{
  const app=wrapper({getAll:async()=>{throw Error('Synthetic server offline');}});app.render();await tick();const tree=app.render();
  assert.equal(find(tree,n=>n.type==='DemoMapScreen').props.data,network.dataset);assert.ok(text(tree).includes('built-in demo snapshot'));
  assert.ok(!nodes(tree).some(n=>n.props?.accessibilityLabel==='Service area: Prima Saujana, Kajang'));
 });
 await test('Leaving the map cancels stale catalog results before starting another dataset request',async()=>{
  let finish;let datasetCalls=0;const pending=new Promise(resolve=>{finish=resolve;});
  const app=wrapper({getAll:()=>pending,getDataset:async()=>{datasetCalls++;return dataFor('kl-east-pilot');}});
  app.render();await tick();app.unmount();finish(catalog);await tick();assert.equal(datasetCalls,0);
 });
 console.log(`${count} service area checks passed.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});

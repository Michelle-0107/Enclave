/* global __dirname */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),backend=path.resolve(root,'../../backend');
const catalog=JSON.parse(fs.readFileSync(path.join(backend,'data/service_areas.json'),'utf8'));
const details=Object.fromEntries(catalog.items.map(a=>[a.id,{...a,map_style_url:'https://example.invalid/style',supported_route_modes:a.temporary_live?['shortest']:['shortest','avoid_damage','accessible']}]));
class ApiError extends Error {constructor(message,status){super(message);this.status=status;}}
function compile(file,deps){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:mod,exports:mod.exports,require(name){if(name in deps)return deps[name];throw Error('Unexpected import '+name);},Error,console,Promise,setTimeout,clearTimeout});return mod.exports;}
const jsx={jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
const native=Object.fromEntries(['ActivityIndicator','Text','View','Pressable','TextInput','Map','Marker','Camera','GeoJSONSource','Layer'].map(x=>[x,x]));
native.StyleSheet={create:x=>x};native.Alert={alert(){}};
function runtime(){let cursor=0;const state=[],effects=new Set(),pending=[],cleanups=[];return{reset(){cursor=0;},flush(){for(const fn of pending.splice(0)){const cleanup=fn();if(cleanup)cleanups.push(cleanup);}},unmount(){for(const fn of cleanups)fn();},react:{useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];},useRef(initial){const i=cursor++;if(!(i in state))state[i]={current:initial};return state[i];},useEffect(fn){const i=cursor++;if(!effects.has(i)){effects.add(i);pending.push(fn);}}}};}
function nodes(t){if(!t||typeof t!=='object')return[];if(Array.isArray(t))return t.flatMap(nodes);return[t,...nodes(t.props?.children)];}
function text(t){if(t==null)return'';if(typeof t!=='object')return String(t);return Array.isArray(t)?t.map(text).join(' '):text(t.props?.children);}
function find(t,fn){const n=nodes(t).find(fn);assert.ok(n,'Expected UI node');return n;}
const button=(t,label)=>find(t,n=>n.type==='Pressable'&&(n.props.accessibilityLabel===label||text(n).trim()===label));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function component(file,api,props){const hooks=runtime(),touches=[];const Screen=compile(file,{react:hooks.react,'react/jsx-runtime':jsx,'react-native':native,'@maplibre/maplibre-react-native':native,'../theme':{colors:{}},'../screens/MapScreen':{__esModule:true,default:'MapScreen'},'../savedPlaces/SavedPlacesControl':{__esModule:true,default:'SavedPlacesControl'},'../lib/api':{ApiError,demoAreasApi:{getAll:async()=>catalog},...api},'../lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}}})}}}}).default;return{unmount:()=>hooks.unmount(),render(){hooks.reset();const t=Screen({onReportPress(){},onMapTouchChange:x=>touches.push(x),...props});hooks.flush();return t;},touches};}
async function main(){let count=0;async function test(name,fn){await fn();count++;console.log('PASS: '+name);}
 await test('Live area catalog loads the default, switches by server ID and remounts the map',async()=>{
  const calls=[];const app=component('src/navigation/LiveAreaMapScreen.tsx',{navigationApi:{getArea:async(_token,id)=>{calls.push(id);return details[id];}}},{});
  app.render();await tick();let tree=app.render();const first=find(tree,n=>n.type==='MapScreen');
  button(tree,'Live service area: Prima Saujana, Kajang').props.onPress();await tick();tree=app.render();const second=find(tree,n=>n.type==='MapScreen');
  assert.equal(second.props.navigationArea,details['kajang-prima-saujana']);assert.notEqual(first.key,second.key);assert.equal(calls.join(','),'kl-east-pilot,kajang-prima-saujana');assert.equal(app.touches[0],false);
  assert.ok(text(tree).includes('Damage avoidance and verified step-free coverage are not enabled'));
 });
 await test('Mismatched live area cannot replace the displayed area',async()=>{
  const app=component('src/navigation/LiveAreaMapScreen.tsx',{navigationApi:{getArea:async(_token,id)=>details[id==='kajang-prima-saujana'?'kl-east-pilot':id]}},{});
  app.render();await tick();button(app.render(),'Live service area: Prima Saujana, Kajang').props.onPress();await tick();const tree=app.render();
  assert.equal(find(tree,n=>n.type==='MapScreen').props.navigationArea.id,'kl-east-pilot');assert.ok(text(tree).includes('does not match'));
 });
 await test('Older backend only exposes its actual existing region and labels missing additional coverage',async()=>{
  const app=component('src/navigation/LiveAreaMapScreen.tsx',{demoAreasApi:{getAll:async()=>{throw new ApiError('Not found',404);}},navigationApi:{getArea:async()=>details['kl-east-pilot']}},{});
  app.render();await tick();const tree=app.render();assert.equal(find(tree,n=>n.type==='MapScreen').props.navigationArea.id,'kl-east-pilot');assert.ok(text(tree).includes('require a backend update'));assert.ok(!text(tree).includes('Prima Saujana'));
 });
 await test('Stale discovery after leaving the screen cannot fetch or display a region',async()=>{
  let finish,calls=0;const pending=new Promise(resolve=>{finish=resolve;});
  const app=component('src/navigation/LiveAreaMapScreen.tsx',{demoAreasApi:{getAll:()=>pending},navigationApi:{getArea:async()=>{calls++;return details['kl-east-pilot'];}}},{});
  app.render();await tick();app.unmount();finish(catalog);await tick();assert.equal(calls,0);
 });
 await test('Live map uses backend bounds, skips unsupported community data and forwards area plus numeric pins',async()=>{
  const area=details['kajang-prima-saujana'],chosen=[];let communityCalls=0;
  const app=component('src/screens/MapScreen.tsx',{navigationApi:{getArea:async(_token,id)=>{assert.equal(id,area.id);return area;}},reportsApi:{getCommunityIssues:async()=>{communityCalls++;return{features:[],pagination:{has_more:false}};}}},{navigationArea:area,onChooseRoute:(...args)=>chosen.push(args)});
  app.render();await tick();let tree=app.render();assert.equal(JSON.stringify(find(tree,n=>n.type==='Camera').props.initialViewState.center),JSON.stringify(area.center));
  find(tree,n=>n.type==='SavedPlacesControl'&&n.props.field==='starting point').props.onChoose({label:'Local start',coordinate:[101.804,3.008]});
  tree=app.render();find(tree,n=>n.type==='SavedPlacesControl'&&n.props.field==='destination').props.onChoose({label:'Local end',coordinate:[101.805,3.009]});
  tree=app.render();button(tree,'Choose route').props.onPress();assert.equal(chosen[0][2].area.id,area.id);assert.equal(chosen[0][2].origin.longitude,101.804);assert.equal(communityCalls,0);
  assert.ok(text(tree).includes('coverage is not enabled'));
 });
 await test('Route options accept Kajang coordinates and only request modes actually enabled by the backend',async()=>{
  const calls=[],area=details['kajang-prima-saujana'];const a={longitude:101.804,latitude:3.008},b={longitude:101.805,latitude:3.009};
  const app=component('src/screens/RouteOptionsScreen.tsx',{navigationApi:{getRoute:async(_token,request)=>{calls.push(request);return{route_mode:'shortest',geometry:{type:'LineString',coordinates:[[a.longitude,a.latitude],[b.longitude,b.latitude]]},distance_meters:150,duration_seconds:130,warnings:[]};}}},{navigationArea:area,start:'A',destination:'B',initialOrigin:a,initialDestination:b,onBack(){},onStartJourney(){}});
  let tree=app.render();button(tree,'Find routes').props.onPress();await tick();tree=app.render();assert.equal(calls.length,1);assert.equal(calls[0].route_mode,'shortest');assert.equal(calls[0].origin.longitude,101.804);assert.ok(text(tree).includes('not enabled in the selected live service area'));
  find(tree,n=>n.type==='SavedPlacesControl'&&n.props.field==='starting point').props.onChoose({label:'Other region',coordinate:[101.730,3.225]});
  assert.ok(text(app.render()).includes('inside the selected live service area'));
 });
 console.log(`${count} live service area checks passed.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});

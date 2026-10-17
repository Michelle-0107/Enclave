/* global __dirname */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.join(__dirname,'..');
function compile(file,req){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:req,Error});return m.exports;}
const network=compile('network.ts',()=>JSON.parse(fs.readFileSync(path.join(root,'kl-east-demo.json')))),access=compile('access.ts',()=>network);
let states,effects,cursor,pending,callback,permission,requests,watches,removed,positions,resolveWatch;
const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},useEffect(fn,deps){const i=cursor++;const old=effects[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){old?.cleanup?.();effects[i]={deps};pending.push(()=>effects[i].cleanup=fn());}}};
const location={Accuracy:{High:4},requestForegroundPermissionsAsync:async()=>{requests++;return{status:permission};},watchPositionAsync:async(options,fn)=>{watches++;callback=fn;assert.equal(options.distanceInterval,5);const subscription={remove:()=>removed++};if(resolveWatch)return new Promise(resolve=>resolveWatch.resolve=()=>resolve(subscription));return subscription;}};
const Component=compile('JourneyGuidance.tsx',name=>{
 if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 if(name==='react-native')return{Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}};
 if(name==='expo-location')return location;if(name==='../theme')return{colors:{navy:'#000',muted:'#666',white:'#fff'}};if(name==='./network')return network;if(name==='./access')return access;throw Error(name);
}).default;
const positionHandler=p=>positions.push(p),origin=[101.73,3.225],entry=[101.7301,3.225],end=[101.731,3.225];
function tree(){cursor=0;const t=Component({route:{coordinates:[entry,end],originSnap:{coordinate:entry},destinationSnap:{coordinate:end}},origin,destination:end,onPosition:positionHandler});while(pending.length)pending.shift()();return t;}
function all(t){if(!t||typeof t!=='object')return[];if(Array.isArray(t))return t.flatMap(all);return[t,...all(t.props?.children)];}
function text(t){if(t==null)return'';if(typeof t!=='object')return String(t);if(Array.isArray(t))return t.map(text).join(' ');return text(t.props?.children);}
function press(t,label){const b=all(t).find(n=>n.type==='Pressable'&&text(n)===label);assert.ok(b,'Missing button: '+label);b.props.onPress();}
function reset(){states=[];effects=[];pending=[];cursor=0;permission='granted';requests=0;watches=0;removed=0;positions=[];resolveWatch=null;}
function unmount(){for(const e of effects)e?.cleanup?.();effects=[];}
const tick=()=>new Promise(resolve=>setImmediate(resolve));const cases=[];
async function test(name,fn){reset();try{await fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.message});}finally{unmount();}}
(async()=>{
 await test('Unmapped access is a proximity stage requiring explicit safe arrival, then mapped guidance stays in-app',async()=>{
  let t=tree();assert.ok(text(t).includes('bearing is not a walking path'));assert.equal(requests,0);
  press(t,'I reached this access safely — continue');t=tree();assert.ok(text(t).includes('Enclave route guidance'));
  press(t,'Reached end of mapped path');t=tree();assert.ok(text(t).includes('Route completed'));assert.equal(requests,0);
 });
 await test('Denied GPS leaves map guidance usable without requesting background access',async()=>{
  permission='denied';let t=tree();press(t,'Use my location');tree();await tick();t=tree();assert.ok(text(t).includes('permission denied'));assert.equal(watches,0);assert.equal(requests,1);
  press(t,'I reached this access safely — continue');t=tree();assert.ok(text(t).includes('Enclave route guidance'));
 });
 await test('Foreground GPS updates the position and stops its subscription on stop',async()=>{
  let t=tree();press(t,'Use my location');tree();await tick();callback({coords:{longitude:101.73005,latitude:3.225,accuracy:8}});t=tree();
  assert.ok(text(t).includes('from GPS position'));assert.deepEqual(Array.from(positions.at(-1)),[101.73005,3.225]);press(t,'Stop GPS');tree();assert.equal(removed,1);assert.equal(positions.at(-1),null);
 });
 await test('An in-flight GPS subscription is removed if navigation closes before it starts',async()=>{
  resolveWatch={};let t=tree();press(t,'Use my location');tree();await tick();assert.equal(watches,1);unmount();resolveWatch.resolve();await tick();assert.equal(removed,1);
 });
 console.log(JSON.stringify(cases,null,2));process.exitCode=cases.some(c=>!c.passed)?1:0;
})();

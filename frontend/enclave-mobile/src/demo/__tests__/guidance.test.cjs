/* global __dirname */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.join(__dirname,'..');let now=1000000;
class Clock extends Date { static now(){return now;} }
function compile(file,req){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:req,Date:Clock,Error,console});return m.exports;}
const network=compile('network.ts',()=>JSON.parse(fs.readFileSync(path.join(root,'kl-east-demo.json'),'utf8')));
const access=compile('access.ts',()=>network),nav=compile('navigationProgress.ts',()=>network);
const p=(x,y)=>[101.73+x/(111195.08*Math.cos(3.225*Math.PI/180)),3.225+y/111195.08];
const coords=[p(0,0),p(100,0),p(100,100),p(200,100)];
const baseRoute={id:'initial',coordinates:coords,distance:300,seconds:250,originSnap:{coordinate:coords[0]},destinationSnap:{coordinate:coords.at(-1)},maneuvers:[
 {instruction:'Turn left onto Garden Road.',coordinate:coords[1],distanceFromStart:100,type:15},
 {instruction:'Turn right onto Park Road.',coordinate:coords[2],distanceFromStart:200,type:10}]};
let hooks,cursor,pending,dirty,mounted,treeValue,props,callback,permission,requests,watches,removed,positions,ready,targets,reroutes,resolveWatch,rerouteImpl,lateUpdates,completions,spoken,stops,hasVoice;
const same=(a,b)=>a&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
function memo(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={deps,value:fn()};return hooks[i].value;}
const react={useState(initial){const i=cursor++;if(!hooks[i]){const h={value:typeof initial==='function'?initial():initial};h.set=next=>{if(!mounted){lateUpdates++;return;}const value=typeof next==='function'?next(h.value):next;if(!Object.is(value,h.value)){h.value=value;dirty=true;}};hooks[i]=h;}return[hooks[i].value,hooks[i].set];},
 useRef(initial){const i=cursor++;if(!hooks[i])hooks[i]={current:initial};return hooks[i];},useMemo:memo,useCallback:(fn,deps)=>memo(()=>fn,deps),
 useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps)){const old=hooks[i];hooks[i]={deps};pending.push(()=>{old?.cleanup?.();hooks[i].cleanup=fn();});}}};
const location={Accuracy:{High:4},requestForegroundPermissionsAsync:async()=>{requests++;return{status:permission};},watchPositionAsync:async(options,fn)=>{assert.equal(options.distanceInterval,0);assert.equal(options.timeInterval,1000);watches++;callback=fn;const subscription={remove:()=>removed++};if(resolveWatch)return new Promise(resolve=>resolveWatch.resolve=()=>resolve(subscription));return subscription;}};
const Component=compile('JourneyGuidance.tsx',name=>{
 if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 if(name==='react-native')return{Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}};
 if(name==='expo-location')return location;if(name==='../theme')return{colors:{navy:'#000',muted:'#666',white:'#fff'}};
 if(name==='./NavigationView')return{__esModule:true,default:'NavigationView'};
 if(name==='./navigationVoice')return{voiceAvailable:()=>hasVoice,turnAnnouncement:(text,distance)=>({phase:distance<=10?'now':distance<=25?'near':distance<=60?'approach':'ahead',text:distance<=10?`Now. ${text}`:`In ${Math.round(distance)} meters. ${text}`}),createNavigationVoice:()=>{let last='';return{stop:()=>{last='';stops++;},say:async(key,text)=>{if(last!==key){spoken.push(text);last=key;}}};}};
 if(name==='./network')return network;if(name==='./access')return access;if(name==='./navigationProgress')return nav;throw Error(name);
}).default;
function render(next){if(next)props={...props,...next};if(!mounted)return treeValue;let loops=0;do{assert.ok(loops++<30,'Repeated render/effect loop');dirty=false;cursor=0;treeValue=Component(props);while(pending.length)pending.shift()();}while(dirty);return treeValue;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));async function settle(){for(let i=0;i<3;i++){await tick();render();}return treeValue;}
function all(t){if(!t||typeof t!=='object')return[];if(Array.isArray(t))return t.flatMap(all);return[t,...all(t.props?.children)];}
function text(t=treeValue){if(t==null)return'';if(typeof t!=='object')return String(t);if(Array.isArray(t))return t.map(text).join('');return text(t.props?.children);}
function press(label){const b=all(treeValue).find(n=>n.type==='Pressable'&&text(n)===label);assert.ok(b,'Missing button: '+label);assert.ok(!b.props.disabled,'Button is disabled: '+label);b.props.onPress();return render();}
function emit(point,accuracy=8,advance=4000,timestamp){now+=advance;callback({coords:{longitude:point[0],latitude:point[1],accuracy},timestamp:timestamp??now});return render();}
function unmount(){if(!mounted)return;mounted=false;for(const h of hooks)h?.cleanup?.();}
function reset(){hooks=[];cursor=0;pending=[];dirty=false;mounted=true;treeValue=null;now=1000000;permission='granted';requests=0;watches=0;removed=0;positions=[];ready=[];targets=[];reroutes=[];resolveWatch=null;rerouteImpl=async()=>true;lateUpdates=0;completions=0;spoken=[];stops=0;hasVoice=true;
 props={route:baseRoute,origin:coords[0],destination:coords.at(-1),onPosition:x=>positions.push(x),onRouteReady:x=>ready.push(x),onTarget:x=>targets.push(x),onComplete:()=>completions++,onReroute:async point=>{reroutes.push(point);return rerouteImpl(point);}};}
const cases=[];async function test(name,fn){reset();try{await fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.stack});}finally{unmount();await tick();}}
(async()=>{
 await test('Starting navigation requests foreground GPS once and advances to upcoming turns automatically',async()=>{
  render();await settle();assert.equal(requests,1);assert.equal(watches,1);assert.ok(text().includes('Turn left onto Garden Road.'));
  emit(p(40,0));assert.ok(text().includes('260 m remaining'));emit(p(80,0));assert.ok(text().includes('220 m remaining'));
  emit(p(100,15));assert.ok(text().includes('Turn right onto Park Road.'));assert.equal(watches,1);assert.equal(reroutes.length,0);
 });
 await test('GPS jitter cannot move progress backward or jump to a nearby return leg',async()=>{
  const route={...baseRoute,coordinates:[p(0,0),p(100,0),p(100,4),p(0,4)],maneuvers:undefined,destinationSnap:{coordinate:p(0,4)}};
  render({route,destination:p(0,4)});await settle();emit(p(45,0));const remaining=text().match(/(\d+) m remaining/)[1];
  emit(p(42,3));assert.equal(text().match(/(\d+) m remaining/)[1],remaining);assert.ok(!text().includes('Route completed'));
 });
 await test('Standing at the actual turn advances after two precise fixes, without walking beyond it',async()=>{
  render();await settle();emit(p(50,0));emit(p(92,0),8,20000);assert.ok(text().includes('Turn left onto Garden Road.'));
  emit(p(100,0),8,3000);assert.ok(text().includes('Turn right onto Park Road.'));
  assert.ok(spoken.some(x=>x.includes('Now. Turn left')));assert.ok(spoken.at(-1).includes('Turn right'));
 });
 await test('A single near-turn GPS reading and inaccurate near-turn fixes cannot skip instructions',async()=>{
  render();await settle();emit(p(50,0));emit(p(100,0),8,20000);assert.ok(text().includes('Turn left'));
  emit(p(100,0),22);emit(p(100,0),22);assert.ok(text().includes('Turn left'));
 });
 await test('Fullscreen presentation receives live instructions and mute/repeat controls without duplicate GPS watchers',async()=>{
  const presentation={styleUrl:'https://map.example/style.json',onClose:()=>{}};
  render({presentation});await settle();assert.equal(treeValue.type,'NavigationView');assert.equal(treeValue.props.tracking,true);
  emit(p(40,0));emit(p(80,0));assert.equal(treeValue.props.turnDistance.toFixed(0),'20');assert.ok(treeValue.props.instruction.text.includes('Turn left'));
  const before=spoken.length;treeValue.props.onToggleVoice();render();emit(p(100,0),8,12000);emit(p(100,0));assert.equal(spoken.length,before);
  assert.ok(treeValue.props.instruction.text.includes('Turn right'));treeValue.props.onToggleVoice();render();assert.ok(spoken.at(-1).includes('Turn right'));
  treeValue.props.onRepeat();assert.ok(spoken.at(-1).includes('Turn right'));assert.equal(watches,1);unmount();assert.ok(stops>0);assert.equal(removed,1);
 });
 await test('Old APK without the native speech module keeps visual GPS navigation and explains the required update',async()=>{
  hasVoice=false;render({presentation:{styleUrl:'fixture',onClose:()=>{}}});await settle();emit(p(40,0));
  assert.equal(treeValue.props.voiceEnabled,false);assert.ok(treeValue.props.voiceStatus.includes('updated development APK'));assert.equal(spoken.length,0);assert.ok(treeValue.props.remaining<300);
 });
 await test('Poor and stale GPS pause automatic progress and never trigger replanning',async()=>{
  render();await settle();for(let i=0;i<4;i++)emit(p(20,-80),90);assert.ok(text().includes('progress is paused'));assert.equal(reroutes.length,0);assert.ok(text().includes('300 m remaining'));
  emit(p(80,0),8,4000,now-30000);assert.ok(text().includes('fresh GPS'));assert.ok(text().includes('300 m remaining'));
 });
 await test('Adjusted starting point waits for accurate arrival before destination navigation',async()=>{
  render({origin:p(-60,0),waitForStart:true});await settle();for(let i=0;i<4;i++)emit(p(-50,0));assert.ok(text().includes('Go to your adjusted starting point'));assert.equal(reroutes.length,0);assert.equal(ready.at(-1),false);
  emit(p(-3,0),8);assert.ok(text().includes('Enclave navigation'));assert.equal(ready.at(-1),true);
 });
 await test('Denied permission leaves manual instructions and explicit start confirmation usable',async()=>{
  permission='denied';render({origin:p(-60,0),waitForStart:true});await settle();assert.ok(text().includes('permission denied'));assert.equal(watches,0);
  press('I am at S — confirm arrival');assert.ok(text().includes('Enclave navigation'));press('Next instruction');assert.ok(text().includes('Turn right'));
  press('Next instruction');press('Reached end of mapped path');assert.ok(text().includes('Route completed'));assert.equal(requests,1);
 });
 await test('Accurate progress through the full route completes arrival and removes the watcher',async()=>{
  render();await settle();emit(p(0,0));emit(p(100,0),8,40000);emit(p(100,100),8,40000);emit(p(200,100),8,40000);
  assert.ok(text().includes('Route completed'));assert.equal(removed,1);assert.equal(positions.at(-1),null);assert.equal(targets.at(-1),null);assert.equal(completions,1);
 });
 await test('Sustained deviation reroutes once, debounces GPS and prevents concurrent requests',async()=>{
  let finish;rerouteImpl=()=>new Promise(resolve=>finish=resolve);render();await settle();emit(p(20,0));
  emit(p(20,-65));emit(p(20,-65));assert.equal(reroutes.length,0);emit(p(20,-65));assert.equal(reroutes.length,1);assert.ok(text().includes('Recalculating'));
  for(let i=0;i<4;i++)emit(p(20,-65));assert.equal(reroutes.length,1);finish(true);await settle();
  for(let i=0;i<3;i++)emit(p(20,-65));assert.equal(reroutes.length,1);
 });
 await test('Replan failure retains the old route and offers explicit retry with an error',async()=>{
  rerouteImpl=async()=>{throw Error('Backend connection unavailable');};render();await settle();emit(p(20,0));for(let i=0;i<3;i++)emit(p(20,-65));await settle();
  assert.equal(reroutes.length,1);assert.ok(text().includes('Backend connection unavailable'));assert.ok(text().includes('280 m remaining'));
  rerouteImpl=async()=>true;press('Recalculate from my location');await settle();assert.equal(reroutes.length,2);assert.ok(!text().includes('Backend connection unavailable'));
 });
 await test('Updating the route resets matching and turns without restarting GPS',async()=>{
  render();await settle();emit(p(40,0));const start=p(40,0),route={...baseRoute,id:'rerouted',coordinates:[start,coords[1],coords[2],coords[3]],originSnap:{coordinate:start},maneuvers:baseRoute.maneuvers.map(m=>({...m,distanceFromStart:m.distanceFromStart-40}))};
  render({route,origin:start});await settle();assert.equal(watches,1);emit(p(50,0));assert.ok(text().includes('Turn left'));assert.ok(text().includes('250 m remaining'));
 });
 await test('Pausing GPS removes the subscription and resuming starts one fresh subscription',async()=>{
  render();await settle();emit(p(20,0));press('Pause GPS');assert.equal(removed,1);assert.equal(positions.at(-1),null);callback({coords:{longitude:0,latitude:0,accuracy:8},timestamp:now+4000});render();assert.equal(reroutes.length,0);
  press('Resume GPS');await settle();assert.equal(watches,2);
 });
 await test('A pending location subscription is removed when navigation closes before setup finishes',async()=>{
  resolveWatch={};render();await settle();assert.equal(watches,1);unmount();resolveWatch.resolve();await tick();assert.equal(removed,1);assert.equal(lateUpdates,0);
 });
 await test('An in-flight reroute cannot update an unmounted guidance component',async()=>{
  let finish;rerouteImpl=()=>new Promise(resolve=>finish=resolve);render();await settle();emit(p(20,0));for(let i=0;i<3;i++)emit(p(20,-65));assert.equal(reroutes.length,1);
  unmount();finish(true);await tick();assert.equal(lateUpdates,0);assert.equal(removed,1);
 });
 console.log(JSON.stringify(cases,null,2));process.exitCode=cases.some(c=>!c.passed)?1:0;
})();

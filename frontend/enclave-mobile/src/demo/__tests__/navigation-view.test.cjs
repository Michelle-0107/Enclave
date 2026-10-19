/* global __dirname */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.join(__dirname,'..');
function compile(file,req){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:req});return m.exports;}
const network=compile('network.ts',()=>JSON.parse(fs.readFileSync(path.join(root,'kl-east-demo.json'),'utf8'))),heading=compile('navigationHeading.ts',()=>network);
let hooks,cursor,effects,dirty,props,tree,cameraCalls;
const equal=(a,b)=>a&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
const react={useRef(initial){const i=cursor++;return hooks[i]??=(initial===null?{current:{easeTo:x=>cameraCalls.push(x),fitBounds:()=>{}}}:{current:initial});},
 useState(initial){const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return[hooks[i].value,value=>{const next=typeof value==='function'?value(hooks[i].value):value;if(!Object.is(hooks[i].value,next)){hooks[i].value=next;dirty=true;}}];},
 useEffect(fn,deps){const i=cursor++;if(!hooks[i]||!equal(hooks[i].deps,deps)){hooks[i]={deps};effects.push(fn);}}};
const Screen=compile('NavigationView.tsx',name=>{
 if(name==='react')return react;
 if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 if(name==='react-native')return{Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:x=>x}};
 if(name==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:24,bottom:20})};
 if(name==='@expo/vector-icons')return{MaterialCommunityIcons:'Icon'};
 if(name==='../navigation/NativeMap')return{NativeMap:'Map'};
 if(name==='@maplibre/maplibre-react-native')return{Camera:'Camera',GeoJSONSource:'Source',Layer:'Layer',Map:'Map',Marker:'Marker'};
 if(name==='./navigationHeading')return heading;if(name==='./network')return network;throw Error(name);
}).default;
function render(next){props={...props,...next};let loops=0;do{assert.ok(loops++<20,'render loop');dirty=false;cursor=0;tree=Screen(props);while(effects.length)effects.shift()();}while(dirty);return tree;}
function all(t){if(!t||typeof t!=='object')return[];if(Array.isArray(t))return t.flatMap(all);return[t,...all(t.props?.children)];}
function text(t){return t==null?'':typeof t!=='object'?String(t):Array.isArray(t)?t.map(text).join(''):text(t.props?.children);}
function find(test){const n=all(tree).find(test);assert.ok(n,'element missing');return n;}
function rotation(){return find(n=>n.type==='Icon'&&n.props.name==='navigation').props.style.transform[0].rotate;}
function reset(){hooks=[];cursor=0;effects=[];dirty=false;cameraCalls=[];const position=[101.73,3.225];props={styleUrl:'fixture',route:{coordinates:[position,[101.731,3.225]],facilities:[],originSnap:{coordinate:position},profile:'walking',seconds:100},destination:[101.731,3.225],stage:'mapped',position,motion:{coordinate:position,accuracy:5,timestamp:1000,course:90,speed:1},instruction:{kind:'right',text:'Turn right'},next:{kind:'left',text:'Turn left'},turnDistance:20,remaining:100,total:100,status:'Following route',tracking:true,rerouting:false,deviating:false,voiceStatus:'',error:'',onClose:()=>{},onToggleVoice:()=>{},onRepeat:()=>{},onToggleTracking:()=>{},onManualNext:()=>{}};}
const cases=[];function test(name,fn){reset();try{fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.stack});}}
test('Live map camera events keep the movement arrow correct in follow and free map modes',()=>{
 render();const map=find(n=>n.type==='Map');map.props.onDidFinishLoadingMap();render();map.props.onRegionIsChanging({nativeEvent:{bearing:30}});render();assert.equal(rotation(),'60deg');
 find(n=>n.type==='View'&&n.props.onTouchStart).props.onTouchStart();render();find(n=>n.type==='Map').props.onRegionDidChange({nativeEvent:{bearing:120}});render();assert.equal(rotation(),'330deg');
 render({motion:{...props.motion,timestamp:2000,course:270}});assert.equal(rotation(),'150deg');
 find(n=>n.props?.accessibilityLabel==='Recenter navigation on me').props.onPress();render();assert.equal(cameraCalls.at(-1).bearing,270);
 find(n=>n.type==='Map').props.onRegionDidChange({nativeEvent:{bearing:270}});render();assert.equal(rotation(),'0deg');
});
test('No known movement direction shows a location dot, without pointing toward the route',()=>{
 render({motion:{...props.motion,course:null,speed:0}});assert.ok(!all(tree).some(n=>n.type==='Icon'&&n.props.name==='navigation'));
 assert.ok(all(tree).some(n=>n.type==='Marker'&&n.props.id==='guidance-user'));
});
test('Automatic rerouting suppresses stale turn guidance and needs no recalculate control',()=>{
 render({deviating:true});assert.ok(text(tree).includes('automatic rerouting'));assert.ok(!text(tree).includes('Turn right'));assert.ok(!text(tree).includes('Then'));
 assert.ok(!text(tree).includes('Recalculate'));assert.ok(!text(tree).includes('Retry now'));
 render({rerouting:true});assert.ok(text(tree).includes('Updating your route automatically'));
});
console.log(JSON.stringify(cases,null,2));process.exitCode=cases.some(c=>!c.passed)?1:0;

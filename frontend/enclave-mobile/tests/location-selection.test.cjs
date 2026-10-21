const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function harness() {
 const state=[],deps=[],cleanup=[],timers=[];let cursor=0,chosen=[],calls=[],respond=async()=>({area_id:'kl-east-pilot',storage:'database',items:[]});
 const react={useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],next=>state[i]=typeof next==='function'?next(state[i]):next]},
 useRef(initial){const i=cursor++;if(!(i in state))state[i]={current:initial};return state[i]},
 useEffect(fn,next){const i=cursor++;if(!deps[i]||next.some((v,j)=>v!==deps[i][j])){cleanup[i]?.();deps[i]=next;timers.push(()=>cleanup[i]=fn())}}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const dependencies={react,'react/jsx-runtime':jsx,'react-native':{View:'View',Text:'Text',TextInput:'TextInput',Pressable:'Pressable'},'../theme':{colors:{navy:'#202C46',muted:'#687083',white:'#fff',border:'#ddd'}},
 '../lib/api':{locationsApi:{lookup:async(...args)=>{calls.push(args);return respond(...args)}}},'../lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'fixture-token'}}})}}}};
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/navigation/SharedLocationPicker.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module,exports:module.exports,require:n=>dependencies[n],setTimeout:fn=>{const token={fn};timers.push(()=>token.fn?.());return token},clearTimeout:token=>token.fn=null,console,Error});
 let point=null;
 return {calls,chosen,setPoint:p=>point=p,respond:fn=>respond=fn,flush:async()=>{while(timers.length)timers.shift()();await new Promise(resolve=>setImmediate(resolve));},
 render(){cursor=0;return module.exports.default({point,onChoose:p=>{chosen.push(p);point={latitude:p.latitude,longitude:p.longitude}}})}};
}
function all(t){return !t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(all):[t,...all(t.props?.children)]}
function text(t){return t==null||typeof t==='boolean'?'':typeof t!=='object'?String(t):Array.isArray(t)?t.map(text).join(' '):text(t.props?.children)}
const input=t=>all(t).find(n=>n.type==='TextInput');
const button=(t,label)=>all(t).find(n=>n.type==='Pressable'&&text(n)===label);
test('A map pin resolves into the editable search input without a second address label',async()=>{
 const h=harness();h.respond(async()=>({area_id:'kl-east-pilot',storage:'database',items:[{name:'Jalan 3/5A',distance_meters:3}]}));
 h.setPoint({latitude:3.22,longitude:101.724});h.render();await h.flush();const t=h.render();
 assert.equal(input(t).props.value,'Near Jalan 3/5A');assert.ok(!text(t).includes('Near Jalan 3/5A'));assert.equal(h.calls.length,1);
 input(t).props.onChangeText('New search');assert.equal(input(h.render()).props.value,'New search');
});
test('Report location search shows three results, expands and preserves the exact chosen name and coordinates',async()=>{
 const h=harness();h.respond(async()=>({area_id:'kl-east-pilot',storage:'database',items:Array.from({length:7},(_,i)=>({id:String(i),name:'Place '+i,latitude:3.22+i*0.00001,longitude:101.724,address:''}))}));
 let t=h.render();input(t).props.onChangeText('Place');t=h.render();await button(t,'Search locations').props.onPress();t=h.render();
 const choices=t=>all(t).filter(n=>n.type==='Pressable'&&/^Place \d$/.test(text(n).trim()));
 assert.equal(choices(t).length,3);button(t,'Show more locations (4)').props.onPress();t=h.render();assert.equal(choices(t).length,7);
 choices(t)[6].props.onPress();h.render();await h.flush();t=h.render();
 assert.equal(input(t).props.value,'Place 6');assert.ok(Math.abs(h.chosen[0].latitude-3.22006)<1e-10);assert.equal(h.calls.length,1);
});
test('A delayed map lookup cannot replace typed text or a newer pin',async()=>{
 const h=harness();let finish;h.respond(()=>new Promise(resolve=>finish=resolve));
 h.setPoint({latitude:3.22,longitude:101.724});h.render();await h.flush();input(h.render()).props.onChangeText('My new search');
 finish({area_id:'kl-east-pilot',storage:'database',items:[{name:'Old road'}]});await new Promise(resolve=>setImmediate(resolve));assert.equal(input(h.render()).props.value,'My new search');
 h.respond(async()=>({area_id:'kl-east-pilot',storage:'database',items:[{name:'New road',distance_meters:0}]}));
 h.setPoint({latitude:3.221,longitude:101.725});h.render();await h.flush();assert.equal(input(h.render()).props.value,'New road');
});

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),test=require('node:test'),ts=require('typescript');
function harness(count=1){
 const state=[];let cursor=0;const submitted=[];
 const react={useState(initial){const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],v=>state[i]=v];}};
 const deps={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
 '@/components/ui/button':{Button:'Button'},'@/components/ui/input':{Input:'Input'},'@/components/ui/textarea':{Textarea:'Textarea'}};
 const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/management/BlockerFeedbackForm.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {exports:mod.exports,module:mod,require:name=>{assert.ok(name in deps,name);return deps[name];}});
 const task={id:'t',target_date:'2026-12-31',pending_blocker_count:count,pending_blocker:{id:5,note:'parts: still waiting'}};
 const render=(busy=false)=>{cursor=0;return mod.exports.default({task,busy,onSubmit:async(...args)=>submitted.push(args)});};
 const all=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(all):[t,...all(t.props?.children)];
 const find=(type,predicate=()=>true)=>{const item=all(render()).find(n=>n.type===type&&predicate(n));assert.ok(item,type);return item;};
 const submit=(busy=false)=>render(busy).props.onSubmit({preventDefault(){}});
 return{task,render,all,find,submit,submitted};
}
test('management sees the blocker and must write feedback and choose a due-date action',()=>{
 const h=harness(2);h.submit();assert.equal(h.submitted.length,0);assert.ok(h.find('p',n=>n.props.role==='alert'));
 h.find('Textarea').props.onChange({target:{value:'Parts ordered'}});h.submit();assert.equal(h.submitted.length,0);
 h.find('input',n=>n.props.value==='keep').props.onChange();h.submit();
 assert.deepEqual(h.submitted,[['Parts ordered',undefined]]);
 assert.ok(h.all(h.render()).some(n=>n.type==='p'&&JSON.stringify(n.props.children).includes('blockers await')));
});
test('change date requires a different date; switching back to keep cannot send a stale hidden date',()=>{
 const h=harness();h.find('Textarea').props.onChange({target:{value:'Awaiting parts'}});
 h.find('input',n=>n.props.value==='change').props.onChange();h.submit();assert.equal(h.submitted.length,0);
 h.find('Input').props.onChange({target:{value:'2027-01-05'}});h.submit();assert.deepEqual(h.submitted[0],['Awaiting parts','2027-01-05']);
 h.find('input',n=>n.props.value==='keep').props.onChange();h.submit();assert.deepEqual(h.submitted[1],['Awaiting parts',undefined]);
 h.submit(true);assert.equal(h.submitted.length,2);
});

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');
const filename = path.join(__dirname, '../src/lib/candidateReview.ts');
const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText, { module: moduleValue, exports: moduleValue.exports, require, URLSearchParams });
const review = moduleValue.exports;
const ids = [1,2,3].map(n => `20000000-0000-4000-8000-00000000000${n}`);
const key = '30000000-0000-4000-8000-000000000001';
const candidates = ids.map((id,n) => ({id, review_ticket_id:`T-${n+1}`, status:'open', reporter_count:2}));
const copy = value => JSON.parse(JSON.stringify(value));
function storage() { const items = new Map(); return {getItem:k => items.get(k), setItem:(k,v)=>items.set(k,v), removeItem:k=>items.delete(k)}; }
const queue = {planName:'Plan 1', issueIds:ids, currentIssueId:ids[0], currentTicketId:'T-1', createdAt:1000};

test('selects only exact issues of the chosen plan, without joining tied alternatives', () => {
  const plan = {facility_impacts:[{repaired_issue_ids:[ids[1],ids[0],ids[1]]}]};
  const selected = review.planCandidateIds(plan);
  assert.deepEqual(copy(selected),[ids[1],ids[0]]);
  assert.deepEqual(copy(review.currentCandidates(selected,candidates)).map(i=>i.id),[ids[1],ids[0]]);
});

test('each approval advances once and stale/approved candidates are skipped', () => {
  assert.deepEqual(copy(review.remainingCandidates(queue,candidates)).map(i=>i.id),[ids[1],ids[2]]);
  const fresh = [candidates[0],candidates[2]];
  assert.deepEqual(copy(review.remainingCandidates(queue,fresh)).map(i=>i.id),[ids[2]]);
  const next = {...queue,issueIds:[ids[1],ids[2]],currentIssueId:ids[1],currentTicketId:'T-2'};
  assert.deepEqual(copy(review.remainingCandidates(next,candidates)).map(i=>i.id),[ids[2]]);
  assert.equal(review.remainingCandidates({...next,issueIds:[ids[2]],currentIssueId:ids[2]},candidates).length,0);
});

test('only open two-resident issues with pending review tickets are eligible', () => {
  const bad = [{...candidates[0],status:'resolved'}, {...candidates[1],reporter_count:1}, {...candidates[2],review_ticket_id:null}];
  assert.equal(review.currentCandidates(ids,bad).length,0);
});

test('queue survives page navigation and refresh, but No removes it and old/wrong sessions fail closed', () => {
  const store = storage(); review.saveReview(store,key,queue);
  assert.deepEqual(copy(review.readReview(store,key,'T-1',2000)),queue);
  assert.equal(review.readReview(store,key,'T-2',2000),null);
  assert.equal(review.readReview(store,key,'T-1',1000+2*60*60*1000+1),null);
  assert.equal(review.readReview(store,'../anything','T-1',2000),null);
  review.stopReview(store,key);
  assert.equal(review.readReview(store,key,'T-1',2000),null);
});

test('invalid queue values cannot supply arbitrary navigation and report URLs stay local', () => {
  const store = storage(); review.saveReview(store,key,{...queue,issueIds:['javascript:alert(1)']});
  assert.equal(review.readReview(store,key,'T-1',2000),null);
  assert.equal(review.reviewHref('../other?evil=1',key),`/management/reports/..%2Fother%3Fevil%3D1?repairReview=${key}`);
});


function loadComponent(relative, dependencies, globals={}) {
  const filename=path.join(__dirname,'..',relative), mod={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,
  }}).outputText,{...globals,module:mod,exports:mod.exports,require:name=>name in dependencies?dependencies[name]:require(name)});
  return mod.exports.default;
}

test('summary renders a review button only for each recommended plan, keeping ties separate',()=>{
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const facts={recommended_plan_ids:['a','c'],plans:[],budget_myr:null,comparable_path_count:1,excluded_path_count:0,explanation:'Calculated facts'};
  let state=0;
  const Panel=loadComponent('src/components/management/RepairSummaryPanel.tsx',{
    react:{...React,useEffect(){},useState:initial=>[state++===0?{key:'s:avoid_damage:0',value:{source:'calculated',text:'Summary',facts}}:initial,()=>{}]},
    '@/lib/api':{},'@/lib/repairRouteView':{formatRouteSeconds:()=>''},
    './CandidateReviewButton':{default:({plan})=>React.createElement('button',null,`Review ${plan.id}`)},
  });
  const html=renderToStaticMarkup(React.createElement(Panel,{simulationId:'s',mode:'avoid_damage',plans:[{id:'a'},{id:'b'},{id:'c'}]}));
  assert.ok(html.includes('Review a'));assert.ok(html.includes('Review c'));assert.ok(!html.includes('Review b'));
});

test('review launch revalidates exact plan issues, stores queue and opens a local report route',async()=>{
  const React=require('react'),store=storage(),pushes=[],updates=[];let reads=0;
  const Button=loadComponent('src/components/management/CandidateReviewButton.tsx',{
    react:{...React,useState:initial=>[initial,value=>updates.push(value)]},
    'next/navigation':{useRouter:()=>({push:href=>pushes.push(href)})},
    '@/lib/api':{getRepairCandidates:async()=>{reads++;return {issues:[candidates[1],candidates[2]]}}},
    '@/lib/candidateReview':review,
  },{sessionStorage:store,crypto:{randomUUID:()=>key}});
  const element=Button({plan:{name:'Plan 1',facility_impacts:[{repaired_issue_ids:[ids[0],ids[1]]}]}});
  element.props.children[0].props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,1);assert.deepEqual(pushes,[review.reviewHref('T-2',key)]);
  const saved=review.readReview(store,key,'T-2');
  assert.deepEqual(copy(saved.issueIds),[ids[1]]);assert.equal(saved.currentIssueId,ids[1]);
  assert.ok(!updates.some(value=>typeof value==='string'&&value.startsWith('Unable')));
});

/* global __dirname */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.join(__dirname,'..'),raw=JSON.parse(fs.readFileSync(path.join(root,'kl-east-demo.json'),'utf8'));
function compile(file,req){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:req,Error});return m.exports;}
const n=compile('network.ts',()=>raw),a=compile('access.ts',()=>n),cases=[];
function test(name,fn){try{fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.message});}}
const origin=[101.7310841,3.22541875],destination=[101.73433705,3.22556645];
test('Reported U-turn is reproduced; optional footpath access reduces onward distance without removing the restricted gate',()=>{
 const p=a.planJourney('walking',origin,destination);assert.ok(p.direct[0].route.distance>770);assert.ok(p.alternative);
 assert.ok(p.alternative.startGap>8&&p.alternative.startGap<11);assert.ok(p.alternative.results[0].route.distance<480);
 assert.equal(raw.edges.find(e=>e.id===p.alternative.from.edgeId).highway,'footway');
 assert.equal(p.alternative.connectorVerified,false);assert.ok(raw.edges.every(e=>!e.osmNodeIds.includes('10923710841')));
 for(const r of p.alternative.results)if(r.route)assert.deepEqual(r.route.coordinates[0],p.alternative.from.coordinate);
});
test('Stair destination remains ineligible for wheelchair and is not moved to a nearby road',()=>{
 const p=a.planJourney('wheelchair',origin,destination);assert.equal(p.alternative,null);assert.equal(p.direct.length,1);assert.equal(p.direct[0].route,null);
});
function disconnected(){
 const points={a:[101.730,3.225],b:[101.730,3.226],c:[101.7301,3.225],d:[101.732,3.225]};
 const edge=(id,start,end)=>({id,start,end,geometry:[points[start],points[end]],osmNodeIds:[start,end],osmWayId:'1',facilityId:null,mappedHasSteps:false,baseStepFree:true,direction:'both',highway:'footway',layer:'0',roadName:'Test mapped footpath',accessBasis:'fictional_demo_assumption'});
 return {...raw,nodes:Object.entries(points).map(([id,coordinate])=>({id,coordinate})),edges:[edge('stub','a','b'),edge('connected','c','d')],facilities:[],landmarks:[]};
}
test('Disconnected nearest stub offers an explicit connected nearby access, never an invented connecting edge',()=>{
 const data=disconnected(),p=a.planJourney('walking',data.nodes[0].coordinate,data.nodes[3].coordinate,data);
 assert.ok(p.direct.every(r=>r.route===null));assert.ok(p.alternative);assert.equal(p.alternative.from.edgeId,'connected');
 assert.ok(p.alternative.startGap>10);assert.ok(p.alternative.results[0].route.segments.every(s=>s.sourceEdgeId==='connected'));
 assert.equal(data.edges.length,2);
});
test('No reachable access or wheelchair connectivity remains an honest unavailable result',()=>{
 const data=disconnected();const p=a.planJourney('walking',[101.740,3.234],data.nodes[3].coordinate,data);assert.equal(p.alternative,null);assert.equal(p.direct.length,0);
 const wheelchair=a.planJourney('wheelchair',data.nodes[0].coordinate,data.nodes[3].coordinate,data);assert.equal(wheelchair.alternative,null);assert.equal(wheelchair.direct[0].route,null);
});
test('Ordinary connected journey does not get an unnecessary access transfer',()=>{
 const data=disconnected(),p=a.planJourney('walking',data.nodes[2].coordinate,data.nodes[3].coordinate,data);assert.ok(p.direct[0].route);assert.equal(p.alternative,null);
});
test('Unmapped coordinate selection outside the pilot remains rejected and compass directions are geographic',()=>{
 assert.throws(()=>a.planJourney('walking',[0,0],destination));assert.equal(a.compassDirection([101.73,3.225],[101.73,3.226]),'N');assert.equal(a.compassDirection([101.73,3.225],[101.731,3.225]),'E');
});
console.log(JSON.stringify(cases,null,2));process.exitCode=cases.some(c=>!c.passed)?1:0;

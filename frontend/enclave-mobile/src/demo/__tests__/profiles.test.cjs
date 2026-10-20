/* global __dirname */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.join(__dirname,'..'),raw=JSON.parse(fs.readFileSync(path.join(root,'kl-east-demo.json'),'utf8'));
const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'network.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:()=>raw});
const n=m.exports,a=[101.7307337,3.2254158],b=[101.732159,3.2277914],cases=[];
function check(name,fn){try{fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.message});}}
check('Walking offers all three requested route choices',()=>{
 const r=n.calculateProfileRoutes('walking',a,b);assert.equal(r.map(x=>x.mode).join(','),'shortest,avoid_damage,accessible');
 assert.equal(n.labels.accessible,'Demo step-free route');assert.ok(r.every(x=>!x.route||x.route.profile==='walking'));
});
check('Wheelchair offers only step-free travel and excludes stairs/damage',()=>{
 const r=n.calculateProfileRoutes('wheelchair',a,b);assert.equal(r.length,1);assert.equal(r[0].mode,'accessible');assert.ok(r[0].route);
 assert.equal(r[0].route.profile,'wheelchair');assert.ok(r[0].route.segments.every(s=>s.stepFree&&!s.hasSteps));
 assert.ok(r[0].route.facilities.every(f=>!n.isBlocked(f,n.initialScenario())));
});
check('Missing wheelchair coverage remains unavailable instead of using ordinary walking',()=>{
 const d=structuredClone(raw);d.edges=d.edges.map(e=>({...e,mappedHasSteps:true,baseStepFree:false}));
 const r=n.calculateProfileRoutes('wheelchair',a,b,d);assert.equal(r.length,1);assert.equal(r[0].route,null);assert.ok(n.calculateProfileRoutes('walking',a,b,d)[0].route);
});
check('Demo verification is never presented as field-verified route metadata',()=>{
 for(const p of ['walking','wheelchair'])for(const {route} of n.calculateProfileRoutes(p,a,b))if(route)assert.equal(route.fieldVerified,false);
});
check('Wheelchair timing is a separate illustrative estimate',()=>{
 const walk=n.calculateProfileRoutes('walking',a,b)[2].route,chair=n.calculateProfileRoutes('wheelchair',a,b)[0].route;
 assert.equal(chair.distance,walk.distance);assert.ok(Math.abs(chair.seconds-chair.distance/0.9)<0.001);
});
check('Driving cannot accidentally use the pedestrian routing engine',()=>assert.throws(()=>n.calculateProfileRoutes('driving',a,b)));
console.log(JSON.stringify(cases,null,2));process.exitCode=cases.some(c=>!c.passed)?1:0;

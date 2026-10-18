/* global __dirname */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.join(__dirname,'..');
function compile(file,req){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:req});return m.exports;}
const network=compile('network.ts',()=>JSON.parse(fs.readFileSync(path.join(root,'kl-east-demo.json'),'utf8')));
const nav=compile('navigationProgress.ts',()=>network);
const p=(x,y)=>[101.73+x/(111195.08*Math.cos(3.225*Math.PI/180)),3.225+y/111195.08];
const coords=[p(0,0),p(100,0),p(100,100),p(200,100)];
const route={coordinates:coords,maneuvers:[{instruction:'Continue straight.',coordinate:coords[0],distanceFromStart:0},
 {instruction:'Turn left onto Garden Road.',coordinate:coords[1],distanceFromStart:100,type:15},
 {instruction:'Cross the private local road when traffic is clear; this is an unmarked crossing.',coordinate:p(100,30),distanceFromStart:130},
 {instruction:'Turn right onto Park Road.',coordinate:coords[2],distanceFromStart:200,type:10}]};
const cases=[];function test(name,fn){try{fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.message});}}
test('Backend turns and unmarked crossing instructions survive, straight geometry vertices are not instructions',()=>{
 const model=nav.navigationModel(route);assert.equal(model.instructions.length,4);
 assert.deepEqual(Array.from(model.instructions,x=>x.kind),['left','crossing','right','arrive']);
 assert.equal(nav.nextInstruction(model,80).text,'Turn left onto Garden Road.');
 assert.equal(nav.nextInstruction(model,110).kind,'crossing');assert.equal(nav.nextInstruction(model,140).kind,'right');
});
test('GPS is projected along the path and gives a measured along-route distance',()=>{
 const model=nav.navigationModel(route), match=nav.matchPosition(model,p(45,2),40,3);
 assert.ok(Math.abs(match.along-45)<.1);assert.ok(Math.abs(match.deviation-2)<.1);
 assert.ok(Math.abs(model.total-match.along-255)<.1);
});
test('Nearby return leg cannot jump route progress hundreds of meters forward',()=>{
 const model=nav.navigationModel({coordinates:[p(0,0),p(100,0),p(100,4),p(0,4)]});
 const match=nav.matchPosition(model,p(45,3),40,2);assert.ok(match.along<80);assert.ok(match.deviation<4);
 const initial=nav.matchPosition(model,p(0,3),null);assert.ok(initial.along<10);
});
test('Long GPS gaps allow plausible forward movement, short gaps reject teleportation',()=>{
 const model=nav.navigationModel({coordinates:[p(0,0),p(500,0)]});
 assert.ok(nav.matchPosition(model,p(140,0),20,2).deviation>70);
 assert.ok(nav.matchPosition(model,p(140,0),20,45).deviation<1);
});
test('Noisy GPS or one transient departure never triggers a reroute',()=>{
 let state={hits:0,since:0,lastAttempt:null};
 for(const time of [1000,5000]){const next=nav.offRouteEvidence(state,70,8,time);assert.equal(next.shouldReroute,false);state=next.evidence;}
 const noisy=nav.offRouteEvidence(state,100,80,10000);assert.equal(noisy.shouldReroute,false);assert.equal(noisy.evidence.hits,0);
 assert.equal(nav.offRouteEvidence(state,100,null,10000).shouldReroute,false);
 assert.equal(nav.offRouteEvidence(state,20,8,10000).evidence.hits,0);
});
test('Sustained accurate departures trigger after eight seconds and respect cooldown',()=>{
 let state={hits:0,since:0,lastAttempt:null},next;
 for(const time of [1000,5000,9000]){next=nav.offRouteEvidence(state,65,8,time);state=next.evidence;}
 assert.equal(next.shouldReroute,true);
 assert.equal(nav.offRouteEvidence({...state,lastAttempt:9000},65,8,15000).shouldReroute,false);
 assert.equal(nav.offRouteEvidence({...state,lastAttempt:9000},65,8,40000).shouldReroute,true);
 assert.equal(nav.offRouteEvidence(state,40,22,10000).offRoute,false);
});
test('Cached geometry without server steps still derives left and right turns on the actual path',()=>{
 const model=nav.navigationModel({coordinates:coords});
 assert.deepEqual(Array.from(model.instructions,x=>x.kind),['left','right','arrive']);
 assert.equal(model.instructions[0].text,'Turn left.');
});
console.log(JSON.stringify(cases,null,2));process.exitCode=cases.some(c=>!c.passed)?1:0;

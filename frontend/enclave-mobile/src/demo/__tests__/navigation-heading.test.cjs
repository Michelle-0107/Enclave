/* global __dirname */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.join(__dirname,'..');
function compile(file,req){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:req});return m.exports;}
const network=compile('network.ts',()=>JSON.parse(fs.readFileSync(path.join(root,'kl-east-demo.json'),'utf8'))),nav=compile('navigationHeading.ts',()=>network);
const point=(x,y)=>[101.73+x/(111195.08*Math.cos(3.225*Math.PI/180)),3.225+y/111195.08];
const initial=()=>({anchor:null,heading:null,timestamp:0});
const fix=(x,y,time,course=null,speed=null,accuracy=5)=>({coordinate:point(x,y),accuracy,timestamp:time,course,speed});
const cases=[];function test(name,fn){try{fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.message});}}
test('GPS travel course drives the arrow independently of the planned route',()=>{
 let state=nav.movementHeading(initial(),fix(0,0,1000,270,1.2));assert.equal(state.heading,270);
 state=nav.movementHeading(state,fix(0,0,2000,90,1.2));assert.equal(state.heading,90);
});
test('Heading subtracts the actual map bearing when following, panning or rotating the map',()=>{
 assert.equal(nav.markerRotation(270,270),0);assert.equal(nav.markerRotation(270,0),270);assert.equal(nav.markerRotation(270,90),180);assert.equal(nav.markerRotation(5,355),10);
});
test('Missing course derives north and east from sufficiently accurate walking displacement',()=>{
 let state=nav.movementHeading(initial(),fix(0,0,1000));state=nav.movementHeading(state,fix(0,8,9000));assert.ok(Math.abs(state.heading)<.01);
 state=nav.movementHeading(state,fix(8,8,17000));assert.ok(Math.abs(state.heading-90)<.01);
});
test('Stationary GPS noise cannot invent a movement heading',()=>{
 let state=nav.movementHeading(initial(),fix(0,0,1000,0,0));assert.equal(state.heading,null);
 state=nav.movementHeading(state,fix(1,1,2000,190,0));assert.equal(state.heading,null);
 state=nav.movementHeading(state,fix(-1,0,3000));assert.equal(state.heading,null);
});
test('Bad accuracy, old fixes and implausible jumps cannot reverse an established direction',()=>{
 let state=nav.movementHeading(initial(),fix(0,0,1000,90,1));
 state=nav.movementHeading(state,fix(-50,0,2000,null,null,40));assert.equal(state.heading,90);
 state=nav.movementHeading(state,fix(-50,0,500,270,1));assert.equal(state.heading,90);
 state=nav.movementHeading(state,fix(-50,0,3000));assert.equal(state.heading,90);
});
console.log(JSON.stringify(cases,null,2));process.exitCode=cases.some(c=>!c.passed)?1:0;

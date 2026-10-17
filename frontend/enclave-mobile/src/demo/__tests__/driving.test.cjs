/* global __dirname */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.join(__dirname,'..'),raw=JSON.parse(fs.readFileSync(path.join(root,'kl-east-demo.json'),'utf8'));
function compile(file,requireMock){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:requireMock});return m.exports;}
const network=compile('network.ts',()=>raw),{drivingDirectionsUrl}=compile('driving.ts',()=>network);const cases=[];
function check(name,fn){try{fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.message});}}
check('Driving URL uses explicit driving mode with correctly ordered encoded coordinates',()=>{
 const u=new URL(drivingDirectionsUrl([101.730,3.225],[101.733,3.228]));assert.equal(u.origin,'https://www.google.com');assert.equal(u.pathname,'/maps/dir/');
 assert.equal(u.searchParams.get('api'),'1');assert.equal(u.searchParams.get('travelmode'),'driving');assert.equal(u.searchParams.get('origin'),'3.225,101.73');assert.equal(u.searchParams.get('destination'),'3.228,101.733');assert.equal(u.searchParams.get('dir_action'),'navigate');
});
check('No keys, user accounts or fictional road restrictions enter the external URL',()=>{
 const u=new URL(drivingDirectionsUrl([101.730,3.225],[101.733,3.228]));assert.deepEqual([...u.searchParams.keys()].sort(),['api','destination','dir_action','origin','travelmode']);
});
check('Driving rejects invalid or coincident user locations',()=>{
 assert.throws(()=>drivingDirectionsUrl([0,0],[101.730,3.225]));assert.throws(()=>drivingDirectionsUrl([NaN,3.225],[101.730,3.225]));assert.throws(()=>drivingDirectionsUrl([101.730,3.225],[101.730,3.225]));
});
console.log(JSON.stringify(cases,null,2));process.exitCode=cases.some(c=>!c.passed)?1:0;

/* global __dirname */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
let nativeAvailable=true,loads=0;
const m={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..','navigationVoice.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {module:m,exports:m.exports,require:name=>name==='expo'?{requireOptionalNativeModule:()=>nativeAvailable?{}:null}:name==='react-native'?{Platform:{OS:'android'}}:(loads++,{})});
const {createNavigationVoice,voiceAvailable,turnAnnouncement}=m.exports;
const cases=[];
async function test(name,fn){try{await fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.stack});}}
(async()=>{
 await test('Old APK module detection never imports an unavailable speech module',()=>{nativeAvailable=false;assert.equal(voiceAvailable(),false);assert.equal(loads,0);nativeAvailable=true;assert.equal(voiceAvailable(),true);});
 await test('GPS fixes in the same announcement phase do not queue repeated speech',async()=>{
  const spoken=[];let stopped=0;const voice=createNavigationVoice(async()=>({stop:async()=>stopped++,speak:text=>spoken.push(text)}));
  await voice.say('turn-1-near','In 20 meters. Turn left.',()=>assert.fail());await voice.say('turn-1-near','In 15 meters. Turn left.',()=>assert.fail());
  await voice.say('turn-1-now','Now. Turn left.',()=>assert.fail());assert.equal(spoken.length,2);assert.equal(stopped,2);
 });
 await test('Muting or exiting before asynchronous module load completes cancels speech',async()=>{
  let finish;const spoken=[];const voice=createNavigationVoice(()=>new Promise(resolve=>finish=resolve));const pending=voice.say('one','Turn left',()=>assert.fail());
  voice.stop();finish({stop:async()=>{},speak:text=>spoken.push(text)});await pending;assert.equal(spoken.length,0);
 });
 await test('A new route replaces a pending prompt instead of speaking stale directions',async()=>{
  const finishes=[],spoken=[];const voice=createNavigationVoice(()=>new Promise(resolve=>finishes.push(resolve)));
  const a=voice.say('old','Turn left',()=>assert.fail()),b=voice.say('new','Turn right',()=>assert.fail());const speech={stop:async()=>{},speak:text=>spoken.push(text)};
  finishes[1](speech);await b;finishes[0](speech);await a;assert.deepEqual(spoken,['Turn right']);
 });
 await test('Native load, stop, and TTS errors surface without crashing navigation',async()=>{
  let errors=0;await createNavigationVoice(async()=>{throw Error('missing');}).say('one','Turn',()=>errors++);
  await createNavigationVoice(async()=>({stop:async()=>{throw Error('engine');},speak:()=>assert.fail()})).say('two','Turn',()=>errors++);
  await createNavigationVoice(async()=>({stop:async()=>{},speak:(text,options)=>options.onError()})).say('three','Turn',()=>errors++);assert.equal(errors,3);
 });
 await test('Turn announcements use ahead, approach, near and now thresholds',()=>{
  assert.equal(turnAnnouncement('Turn left',90).phase,'ahead');assert.equal(turnAnnouncement('Turn left',50).phase,'approach');assert.equal(turnAnnouncement('Turn left',20).phase,'near');assert.equal(turnAnnouncement('Turn left',8).text,'Now. Turn left');
 });
 console.log(JSON.stringify(cases,null,2));process.exitCode=cases.some(x=>!x.passed)?1:0;
})();

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript');
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/serviceAreaBoundary.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,module:mod});
test('service boundary is a closed dashed line at the selected bounds without filling or clipping routes',()=>{
 const sources=[],layers=[];const map={addSource:(...args)=>sources.push(args),addLayer:layer=>layers.push(layer)};
 mod.exports.addServiceAreaBoundary(map,[100,2,101,3]);
 assert.equal(sources.length,1);assert.equal(layers.length,1);assert.equal(layers[0].type,'line');
 assert.equal(JSON.stringify(sources[0][1].data.geometry.coordinates),'[[100,2],[101,2],[101,3],[100,3],[100,2]]');
 assert.equal(JSON.stringify(layers[0].paint['line-dasharray']),'[4,3]');
});

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),test=require('node:test');
const ts=require('../node_modules/typescript');
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/restrictionZones.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,module:mod});
const {unionRestrictionRectangles:union,restrictionZoneFeatures:features}=mod.exports;
const ringArea=r=>Math.abs(r.slice(1).reduce((s,p,i)=>s+r[i][0]*p[1]-p[0]*r[i][1],0)/2);
const area=polygons=>polygons.reduce((s,p)=>s+ringArea(p[0])-p.slice(1).reduce((a,h)=>a+ringArea(h),0),0);
const box=([w,s,e,n])=>[[w,s],[e,s],[e,n],[w,n],[w,s]];
test('overlapping road cells dissolve into a single boundary without expanding the affected area',()=>{
 const result=union([[0,0,2,2],[1,0,3,2],[1,1,3,3]]);
 assert.equal(result.length,1);assert.equal(result[0].length,1);assert.equal(area(result),8);
 assert.ok(result[0][0].length<13);
});
test('disjoint cells and corner touches remain distinct polygons',()=>{
 for(const rectangles of [[[0,0,1,1],[2,0,3,1]],[[0,0,1,1],[1,1,2,2]]]){
  const result=union(rectangles);assert.equal(result.length,2);assert.equal(area(result),2);
 }
});
test('a closed ring of road cells retains its unblocked interior hole',()=>{
 const result=union([[0,0,3,1],[0,2,3,3],[0,1,1,2],[2,1,3,2]]);
 assert.equal(result.length,1);assert.equal(result[0].length,2);assert.equal(area(result),8);
});
test('real geographic coordinates do not cause a thin road zone to lose its orientation',()=>{
 const polygons=union([[101.73,3.225,101.7301,3.2251],[101.73005,3.22505,101.73015,3.22515]]);
 assert.equal(polygons.length,1);assert.equal(polygons[0].length,1);
});
test('repaired and remaining zones are separate, arbitrary polygons are not replaced by bounding boxes, input stays intact',()=>{
 const input=[{facility_id:'repaired',exclusion_rings:[box([0,0,2,2]),box([1,0,3,2])]},
 {facility_id:'remaining',exclusion_rings:[box([1,0,3,2]),[[0,0],[2,0],[1,2],[0,0]]]}];
 const before=JSON.stringify(input),result=features(input,new Set(['repaired']));
 assert.equal(result.length,3);assert.equal(result.filter(f=>f.properties.repaired).length,1);
 assert.equal(area(result.filter(f=>f.properties.repaired).map(f=>f.geometry.coordinates)),6);
 assert.equal(result.find(f=>f.geometry.coordinates[0].length===4).properties.repaired,false);
 assert.equal(JSON.stringify(input),before);
});
test('deterministic small rectangle collections preserve exact raster union area and closed boundaries',()=>{
 let seed=37;const random=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
 for(let trial=0;trial<100;trial++){
  const rectangles=Array.from({length:12},()=>{const x=random(8),y=random(8);return[x,y,x+1+random(3),y+1+random(3)];});
  let expected=0;for(let y=0;y<11;y++)for(let x=0;x<11;x++)if(rectangles.some(([w,s,e,n])=>x>=w&&x<e&&y>=s&&y<n))expected++;
  const result=union(rectangles);assert.equal(area(result),expected,`trial ${trial}`);
  for(const polygon of result)for(const ring of polygon)assert.deepEqual(ring[0],ring.at(-1));
 }
});

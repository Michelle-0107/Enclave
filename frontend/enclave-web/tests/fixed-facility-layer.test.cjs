const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/fixedFacilityLayer.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports});
const {addFixedFacilityLayer}=mod.exports;
test('fixed facility layers preserve geographic coordinates during camera moves and retain popup/cleanup behavior',()=>{
 const sources=new Map(),layers=new Map(),listeners=new Map(),popups=[];
 const map={addSource:(id,data)=>sources.set(id,data),addLayer:layer=>layers.set(layer.id,layer),getSource:id=>sources.get(id),getLayer:id=>layers.get(id),removeSource:id=>sources.delete(id),removeLayer:id=>layers.delete(id),
 on:(event,id,fn)=>listeners.set(id,fn),off:(event,id)=>listeners.delete(id),panTo(point){this.center=point},zoomTo(zoom){this.zoom=zoom}};
 class Popup{constructor(){popups.push(this)}setLngLat(point){this.point=point;return this}setText(text){this.text=text;return this}addTo(){return this}remove(){this.removed=true}}
 const pins=[{id:'road-a',coordinate:[101.73,3.225],label:'!',description:'Road A damage',color:'#d42b35'},{id:'road-b',coordinate:[101.732,3.226],label:'R1',description:'Road B hypothetical repair',color:'#199366'}];
 const control=addFixedFacilityLayer(map,{Popup},'facilities',pins),before=JSON.stringify(sources.get('facilities').data);
 map.panTo([101.74,3.23]);map.zoomTo(18);assert.equal(JSON.stringify(sources.get('facilities').data),before);
 const circle=layers.get('facilities-circle');assert.equal(circle.type,'circle');assert.equal(circle.paint['circle-pitch-alignment'],'map');assert.equal(JSON.stringify(circle.paint['circle-translate']),'[0,0]');
 listeners.get('facilities-circle')({features:[{properties:{id:'road-a'}}]});assert.deepEqual(popups[0].point,pins[0].coordinate);assert.equal(popups[0].text,pins[0].description);
 control.showPopup('road-b');assert.equal(popups[0].removed,true);assert.deepEqual(popups[1].point,pins[1].coordinate);
 control.remove();assert.equal(sources.size,0);assert.equal(layers.size,0);assert.equal(listeners.size,0);assert.equal(popups[1].removed,true);
});

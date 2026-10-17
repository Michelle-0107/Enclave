/* global __dirname */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.join(__dirname,'..'),raw=JSON.parse(fs.readFileSync(path.join(root,'kl-east-demo.json'),'utf8'));
const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'network.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:()=>raw});
const n=m.exports,cases=[];function check(name,fn){try{fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.message});}}
const points={1:[101.730,3.225],2:[101.731,3.225],3:[101.7305,3.2254],4:[101.7305,3.224]};
function fixture(){
 const d=structuredClone(raw);d.nodes=Object.entries(points).map(([id,coordinate])=>({id,coordinate}));d.facilities=[];d.landmarks=[];
 d.edges=[['direct','1','2'],['stairs','1','3'],['upper','3','2'],['lower1','1','4'],['lower2','4','2']].map(([id,start,end],i)=>({id,start,end,facilityId:null,mappedHasSteps:false,baseStepFree:true,direction:'both',geometry:[points[start],points[end]],osmNodeIds:[start,end],osmWayId:String(100+i),highway:'footway',layer:'0',roadName:id,accessBasis:'fictional_demo_assumption'}));
 for(const [id,kind,edgeId,damaged] of [['fault','crossing','direct',true],['stair','stairs','stairs',false]]){
  const e=d.edges.find(e=>e.id===edgeId);e.facilityId=id;d.facilities.push({id,kind,name:id,edgeId,damaged,reporters:damaged?2:0,source:'fictional_facility',restrictionRadiusMeters:3,gridCell:[1,1],coordinate:e.geometry[0].map((x,i)=>(x+e.geometry[1][i])/2)});
 }
 return n.validateDataset(d);
}
const d=fixture(),routes=n.calculateRoutes(points[1],points[2],d),byMode=Object.fromEntries(routes.map(r=>[r.mode,r.route]));
check('Whole-area dataset has no preset journey and distributes facilities across all quadrants',()=>{
 assert.equal('originId' in raw,false);assert.equal('destinationId' in raw,false);assert.ok(raw.edges.length>=1500);assert.ok(raw.facilities.length>=100);
 assert.ok(new Set(raw.facilities.map(f=>f.gridCell.join(','))).size>=40);
 for(const [left,bottom] of [[true,true],[true,false],[false,true],[false,false]])assert.ok(raw.facilities.some(f=>(f.coordinate[0]<101.731)===left&&(f.coordinate[1]<3.226)===bottom));
 for(const name of ['KL East Mall','The Veo KL East','KYS KL East International School','KL East Park'])assert.ok(raw.landmarks.some(p=>p.name===name));
});
check('All three modes calculate dynamically from chosen coordinates',()=>{
 assert.ok(byMode.shortest.distance<byMode.avoid_damage.distance);assert.ok(byMode.avoid_damage.distance<byMode.accessible.distance);
 assert.ok(byMode.shortest.facilities.some(f=>f.id==='fault'));assert.ok(byMode.avoid_damage.segments.some(s=>s.hasSteps));assert.ok(byMode.accessible.segments.every(s=>s.stepFree&&!s.hasSteps));
});
check('All modes use identical snapped endpoints without bypassing restrictions',()=>{
 for(const {route} of routes){assert.deepEqual(JSON.stringify(route.originSnap.coordinate),JSON.stringify(points[1]));assert.deepEqual(JSON.stringify(route.destinationSnap.coordinate),JSON.stringify(points[2]));}
 const midpoint=d.facilities[0].coordinate;const r=n.calculateRoutes(midpoint,points[2],d);assert.ok(r[0].route);assert.equal(r[1].route,null);assert.equal(r[2].route,null);
});
check('One reporter does not activate avoidance; two reporters do',()=>{
 const state=n.initialScenario(d);state.reporterCounts.fault=1;const r=n.calculateRoutes(points[1],points[2],d,state);
 assert.ok(Math.abs(r[1].route.distance-r[0].route.distance)<0.001);assert.ok(byMode.avoid_damage.distance>r[1].route.distance);
});
check('Only facilities intersecting the traversed road section are reported',()=>{
 const r=n.calculateRoutes([101.73002,3.225],[101.73020,3.225],d);
 assert.ok(r.every(x=>x.route&&x.route.facilities.length===0));assert.ok(r.every(x=>x.route.distance<21));
});
check('Same-edge interior endpoints route directly rather than via road junctions',()=>{
 const r=n.calculateRoutes([101.73020,3.225],[101.73080,3.225],d);
 assert.ok(Math.abs(r[0].route.distance-n.meters([101.73020,3.225],[101.73080,3.225]))<0.01);
 assert.ok(r[1].route.distance>r[0].route.distance);
});
check('Choosing a new destination actually changes the path',()=>{
 const r=n.calculateRoutes(points[1],points[4],d)[0].route;assert.ok(Math.abs(r.distance-byMode.shortest.distance)>10);assert.equal(JSON.stringify(r.coordinates.at(-1)),JSON.stringify(points[4]));
});
check('A step-free route cannot escape from inside stair-only access',()=>{
 const r=n.calculateRoutes(d.facilities[1].coordinate,points[2],d);assert.ok(r[0].route);assert.equal(r[2].route,null);
});
check('Mapped one-way walking restrictions are respected',()=>{
 const one=fixture();one.facilities=[];one.edges=[{...one.edges[0],facilityId:null,direction:'forward'}];
 assert.ok(n.calculateRoutes(points[1],points[2],one)[0].route);assert.ok(n.calculateRoutes(points[2],points[1],one).every(x=>x.route===null));
});
check('Disconnected components yield unavailable, never a straight fallback',()=>{
 const separated=fixture();separated.facilities=[];separated.edges=[{...separated.edges[0],facilityId:null},{...separated.edges[2],start:'3',end:'4',geometry:[points[3],points[4]],osmNodeIds:['3','4']}];assert.ok(n.calculateRoutes(points[1],points[4],separated).every(x=>!x.route));
});
check('Out-of-area, off-network and coincident selections fail explicitly',()=>{
 for(const p of [[0,0],[NaN,3.22],[101.738,3.233]])assert.throws(()=>n.snapToRoad(p,d));
 assert.throws(()=>n.calculateRoutes(points[1],points[1],d));
 const straight=fixture();straight.edges=[straight.edges[0]];straight.facilities=[straight.facilities[0]];
 assert.throws(()=>n.calculateRoutes([101.7299,3.2251],[101.7298,3.2252],straight));
});
check('Selection exposes snapping distance without extending road geometry through buildings',()=>{
 const chosen=n.selectLocation('User choice',[101.7305,3.2249],d);assert.ok(chosen.snap.distance>0&&chosen.snap.distance<40);assert.equal(chosen.snap.coordinate[1],3.225);
 const route=n.calculateRoutes(chosen.coordinate,points[2],d)[0].route;assert.equal(route.coordinates[0][1],3.225);
});
check('Local search uses real POIs or explicitly entered coordinates',()=>{
 assert.ok(n.searchPlaces('KL East Mall').some(p=>p.name==='KL East Mall'));assert.equal(n.searchPlaces('unmapped invented landmark').length,0);
 const coord=n.searchPlaces('3.225, 101.730');assert.equal(coord[0].coordinate[0],101.730);assert.equal(n.searchPlaces('0,0').length,0);
});
check('Dataset and scenario are not mutated by requests',()=>{
 const before=JSON.stringify(d);n.calculateRoutes(points[2],points[1],d);assert.equal(JSON.stringify(d),before);
 const state=n.initialScenario(d);state.repairedIds=['fault'];assert.ok(n.calculateRoutes(points[1],points[2],d,state)[2].route.distance<byMode.accessible.distance);
 assert.ok(n.calculateRoutes(points[1],points[2],d)[2].route.distance>byMode.shortest.distance);
});
check('Invalid geometry, provenance, identifiers and off-road facilities fail closed',()=>{
 const invalid=fixture();invalid.nodes.push(invalid.nodes[0]);assert.throws(()=>n.validateDataset(invalid));
 const moved=fixture();moved.facilities[0].coordinate=[101.735,3.232];assert.throws(()=>n.validateDataset(moved));
 const conflict=fixture();conflict.edges[0].mappedHasSteps=true;assert.throws(()=>n.validateDataset(conflict));
});
check('No simulated repair can silently change structural stairs',()=>{
 const state=n.initialScenario(d);state.repairedIds=['fault'];const r=n.calculateRoutes(points[1],points[3],d,state)[2].route;
 assert.ok(r&&r.segments.every(s=>!s.hasSteps));assert.throws(()=>n.calculateRoutes(points[1],points[2],d,{...state,repairedIds:['stair']}));
});
check('Area-wide engine agrees with independent Bellman-Ford on actual mapped-node pairs',()=>{
 const state=n.initialScenario();
 function oracle(start,end,mode){
  const best=new Map([[start,0]]);
  for(let pass=0;pass<raw.nodes.length;pass++){let changed=false;
   for(const e of raw.edges){const f=raw.facilities.find(f=>f.id===e.facilityId);
    if(mode!=='shortest'&&f?.damaged&&f.reporters>=2)continue;
    if(mode==='accessible'&&(e.mappedHasSteps||!e.baseStepFree||f?.kind==='stairs'))continue;
    const cost=e.geometry.slice(1).reduce((sum,p,i)=>sum+n.meters(e.geometry[i],p),0);
    for(const [a,b] of [[e.start,e.end],...(e.direction==='both'?[[e.end,e.start]]:[])]){
     const from=e.direction==='backward'?b:a,to=e.direction==='backward'?a:b;
     if((best.get(from)??Infinity)+cost<(best.get(to)??Infinity)-0.0000001){best.set(to,best.get(from)+cost);changed=true;}
    }
   }if(!changed)break;
  }return best.get(end);
 }
 let available=0;
 const idsAtCoordinate=new Map();for(const e of raw.edges)for(let i=0;i<e.geometry.length;i++){const key=e.geometry[i].join(',');if(!idsAtCoordinate.has(key))idsAtCoordinate.set(key,new Set());idsAtCoordinate.get(key).add(e.osmNodeIds[i]);}
 const candidates=raw.edges.filter(e=>n.meters(e.geometry[0],e.geometry.at(-1))>25&&idsAtCoordinate.get(e.geometry[0].join(',')).size===1&&idsAtCoordinate.get(e.geometry.at(-1).join(',')).size===1);
 for(let j=0;j<12;j++){
  const edge=candidates[Math.floor(j*candidates.length/12)];const a=raw.nodes.find(p=>p.id===edge.start),b=raw.nodes.find(p=>p.id===edge.end);
  const got=n.calculateRoutes(a.coordinate,b.coordinate,raw,state);
  for(const result of got){const expected=oracle(a.id,b.id,result.mode);if(expected===undefined)assert.equal(result.route,null);else{available++;assert.ok(result.route&&Math.abs(result.route.distance-expected)<0.02,`${result.mode} ${a.id} → ${b.id}`);}}
 }assert.ok(available>=3,'Compare reachable as well as disconnected actual source nodes');
});
console.log(JSON.stringify({cases,fixtureDistances:routes.map(r=>({mode:r.mode,meters:Math.round(r.route.distance)})),dataset:{nodes:raw.nodes.length,edges:raw.edges.length,facilities:raw.facilities.length,places:raw.landmarks.length}},null,2));
process.exitCode=cases.some(c=>!c.passed)?1:0;

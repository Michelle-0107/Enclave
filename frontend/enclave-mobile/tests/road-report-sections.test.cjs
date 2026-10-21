const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function compile(relative,deps={},tail=''){
 const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText+tail,
 {module,exports:module.exports,require:name=>{if(name in deps)return deps[name];throw Error('Unexpected dependency '+name)},console,Error,Promise,setTimeout,clearTimeout});return module.exports;
}
const helper=compile('src/lib/road-report-sections.ts');
const createPoint=(id,from,to)=>({id,name:'Test road - Section '+id,facility_type:'path_surface',latitude:3.225,longitude:(from+to)/2,created_at:'2026-10-15T00:00:00Z',
 road_section:{area_id:'kl-east-pilot',road_name:'Test road',osm_way_id:'10',section_index:1,length_meters:100,field_verified:false,geometry:[[from,3.225],[to,3.225]]}});
const first=createPoint('section-a',101.73,101.7309),second=createPoint('section-b',101.7309,101.731);
const photo={description:'Synthetic road surface damage',coordinates:{latitude:3.225,longitude:101.73088}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('a point on a long section is not assigned to an adjacent short section just because its midpoint is closer',()=>{
 const a=helper.distanceToRoadSection(first,photo.coordinates.latitude,photo.coordinates.longitude);
 const b=helper.distanceToRoadSection(second,photo.coordinates.latitude,photo.coordinates.longitude);
 assert.ok(a<0.000001);assert.ok(b>2);assert.ok(Math.abs(second.longitude-photo.coordinates.longitude)<Math.abs(first.longitude-photo.coordinates.longitude));
 assert.equal(helper.distanceToRoadSection({...first,road_section:null},3.225,101.73),null);
});

function harness({oldBackend=false,pending=[],extraFacilities=[],places=[],placeLookupFails=false,placeLookupStatus=503,placePages=[]}={}){
 const values=[],deps=[],effects=[],cleanups=[];let cursor=0;
 const hooks={useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return[values[i],next=>values[i]=typeof next==='function'?next(values[i]):next]},
 useEffect(fn,next){const i=cursor++;if(!deps[i]||next.some((v,index)=>v!==deps[i][index])){cleanups[i]?.();deps[i]=next;effects.push(()=>cleanups[i]=fn())}},useRef:value=>({current:value})};
 class ApiError extends Error{constructor(message,status){super(message);this.status=status}}
 const calls=[],submitted=[];
 const api={ApiError,locationsApi:{lookup:async()=>{if(placeLookupFails)throw new ApiError('Place lookup temporarily unavailable',placeLookupStatus);if(placePages.length)return placePages.shift();return{area_id:'kl-east-pilot',storage:'database',items:places,has_more:false}}},navigationApi:{getArea:async()=>({id:'kl-east-pilot',bbox:[101.721,3.217,101.741,3.235]})},facilitiesApi:{
  getAll:async()=>({items:oldBackend?[first]:extraFacilities,pagination:{has_more:false}}),
  getRoadSections:async(token,latitude,longitude,options)=>{
   calls.push({token,latitude,longitude,options});if(oldBackend)throw new ApiError('not found',404);
   if(pending.length)return pending.shift();
   return options.offset===0?{items:[second],pagination:{has_more:true,offset:0,returned:1}}:{items:[first],pagination:{has_more:false,offset:1,returned:1}};
  }},communityIssuesApi:{getAll:async()=>({items:[{id:'issue-b',facility_id:second.id,fault_kind:'damage',status:'open',reporter_count:1}],pagination:{has_more:false}})},reportsApi:{submit:()=>{throw Error('No actual upload expected')}}};
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 const Component=compile('src/screens/ReportScreen.tsx',{
  react:hooks,'react/jsx-runtime':jsx,'react-native':{StyleSheet:{create:value=>value},View:'View',Text:'Text',Image:'Image',ActivityIndicator:'ActivityIndicator',Pressable:'Pressable',Alert:{alert(){}}},
  './ReportPhotoScreen':{},'./ReportLocationScreen':{},'./ReportSuccessScreen':{},'../lib/api':api,'../lib/road-report-sections':helper,
  '../components/DataSkeleton':{SkeletonList:'SkeletonList'},
  '../components/EnclaveLoading':{__esModule:true,default:'EnclaveLoading'},
  '../lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'fixture-token'}}})}}},'../theme':{colors:{}},
 },';module.exports.TestSelection=IssueSelection;').TestSelection;
 return{calls,submitted,render(details=photo){cursor=0;const tree=Component({details,photoUri:'file:///synthetic.jpg',onSubmit:value=>submitted.push(value)});effects.splice(0).forEach(fn=>fn());return tree;}};
}
function nodes(tree){if(!tree||typeof tree!=='object')return[];if(Array.isArray(tree))return tree.flatMap(nodes);return[tree,...nodes(tree.props?.children)]}
function text(tree){if(tree==null)return'';if(typeof tree!=='object')return String(tree);return Array.isArray(tree)?tree.map(text).join(' '):text(tree.props?.children)}

test('report picker loads backend points, sorts by actual section geometry and links the selected section issue only',async()=>{
 const app=harness();app.render();await tick();let tree=app.render();
 assert.equal(app.calls.length,2);assert.equal(app.calls[0].latitude,photo.coordinates.latitude);assert.equal(app.calls[1].options.offset,1);
 let choices=nodes(tree).filter(node=>node.props?.accessibilityRole==='radio');
 assert.ok(text(choices[0]).includes(first.name));assert.ok(text(choices[1]).includes(second.name));
 choices[1].props.onPress();tree=app.render();assert.ok(text(tree).includes('Matching open issue: 1 residents reported'));
 const button=nodes(tree).find(node=>node.type==='Pressable'&&text(node)==='Submit report');
 assert.equal(button.props.disabled,false);button.props.onPress();
 assert.equal(app.submitted.length,1);assert.equal(app.submitted[0].facility.id,second.id);assert.equal(app.submitted[0].issueId,'issue-b');
});

test('older backend keeps existing facilities usable with an explicit road-point availability message',async()=>{
 const app=harness({oldBackend:true});app.render();await tick();const tree=app.render();
 assert.ok(text(tree).includes('Road report points are unavailable on this backend version'));
 assert.ok(nodes(tree).some(node=>node.props?.accessibilityRole==='radio'));
});

test('changing the pin cancels old road-point results before they can replace the new selection list',async()=>{
 let finish;const stale=new Promise(resolve=>finish=resolve),app=harness({pending:[stale]});
 app.render();await tick();app.render({...photo,coordinates:{...photo.coordinates,longitude:101.73087}});await tick();
 finish({items:[],pagination:{has_more:false}});await tick();
 const tree=app.render({...photo,coordinates:{...photo.coordinates,longitude:101.73087}});
 assert.equal(nodes(tree).filter(node=>node.props?.accessibilityRole==='radio').length,2);
});

test('facility choices show the top three, expand all and retain a chosen hidden facility after folding',async()=>{
 const extras=['extra-a','extra-b','extra-c'].map((id,i)=>({...first,id,name:'Nearby facility '+i,longitude:101.7306+i*0.0001,road_section:null}));
 const app=harness({extraFacilities:extras});app.render();await tick();let tree=app.render();
 const choices=t=>nodes(t).filter(n=>n.props?.accessibilityRole==='radio');
 assert.equal(choices(tree).length,3);assert.ok(!/Ã|Â|â/.test(text(tree)));
 nodes(tree).find(n=>n.type==='Pressable'&&text(n).startsWith('Show more facilities')).props.onPress();tree=app.render();assert.equal(choices(tree).length,5);
 choices(tree)[4].props.onPress();tree=app.render();
 nodes(tree).find(n=>n.type==='Pressable'&&text(n)==='Show fewer facilities').props.onPress();tree=app.render();
 assert.equal(choices(tree).length,4);assert.ok(choices(tree).some(n=>n.props.accessibilityState.checked));
 assert.ok(text(tree).includes('Report preview'));
});
test('an existing station or mall from shared locations can be selected and submitted by its stable ID',async()=>{
 const place={id:'station-point',name:'Taman Melati Station',kind:'place',latitude:3.225,longitude:101.73088};
 const app=harness({places:[place]});app.render();await tick();let tree=app.render();
 const station=nodes(tree).find(n=>n.props?.accessibilityRole==='radio'&&text(n).includes(place.name));assert.ok(station);
 station.props.onPress();tree=app.render();const submit=nodes(tree).find(n=>n.type==='Pressable'&&text(n)==='Submit report');
 assert.equal(submit.props.disabled,false);submit.props.onPress();assert.equal(app.submitted[0].facility.id,place.id);
 assert.ok(text(tree).includes('Place or facility'));
});
test('report search explicitly sets visible placeholder, input and selection colors',()=>{
 const colors={navy:'#202C46',muted:'#687083',white:'#FFFFFF',border:'#E3E1DC'};
 const Picker=compile('src/navigation/SharedLocationPicker.tsx',{
  react:{useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect(){}},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  'react-native':{View:'View',Text:'Text',TextInput:'TextInput',Pressable:'Pressable'},'../lib/api':{},'../lib/supabase':{},'../theme':{colors},
    '../components/DataSkeleton':{SkeletonList:'SkeletonList'},
 }).default;
 const input=nodes(Picker({point:null,onChoose(){}})).find(n=>n.type==='TextInput');
 assert.equal(input.props.placeholderTextColor,colors.muted);assert.equal(input.props.selectionColor,colors.navy);
 assert.equal(input.props.style.color,colors.navy);assert.equal(input.props.style.backgroundColor,colors.white);
});

test('a named-place lookup outage does not disable reporting an existing facility or road section',async()=>{
 const app=harness({placeLookupFails:true});app.render();await tick();let tree=app.render();
 const choices=nodes(tree).filter(n=>n.props?.accessibilityRole==='radio');assert.equal(choices.length,2);
 assert.ok(text(tree).includes('Named places are temporarily unavailable'));
 choices[0].props.onPress();tree=app.render();const submit=nodes(tree).find(n=>n.type==='Pressable'&&text(n)==='Submit report');
 assert.equal(submit.props.disabled,false);submit.props.onPress();assert.equal(app.submitted[0].facility.id,first.id);
});

test('named-place authentication denials stop submission instead of using the outage fallback',async()=>{
 for(const status of [401,403]){
  const app=harness({placeLookupFails:true,placeLookupStatus:status});app.render();await tick();const tree=app.render();
  assert.equal(nodes(tree).filter(n=>n.props?.accessibilityRole==='radio').length,0);
  assert.ok(!text(tree).includes('Named places are temporarily unavailable'));
  assert.equal(nodes(tree).find(n=>n.type==='Pressable'&&text(n)==='Submit report').props.disabled,true);
 }
});
test('partial named-place pages are discarded when a later page belongs to another area',async()=>{
 const place={id:'partial-station',name:'Partial station result',kind:'place',latitude:3.225,longitude:101.73088};
 const app=harness({placePages:[{area_id:'kl-east-pilot',storage:'database',items:[place],has_more:true},{area_id:'wrong-area',storage:'database',items:[],has_more:false}]});
 app.render();await tick();const tree=app.render(),choices=nodes(tree).filter(n=>n.props?.accessibilityRole==='radio');
 assert.equal(choices.length,2);assert.ok(!text(tree).includes(place.name));assert.ok(text(tree).includes('Named places are temporarily unavailable'));
});

test('whole-road references are excluded while independent sections and non-road buildings remain selectable',async()=>{
 const roadReference={...first,id:'whole-road',name:'Road reference',report_target:'road_reference',road_section:null};
 const roadPlace={id:'whole-road',name:'Road reference',kind:'place',latitude:3.225,longitude:101.73088,metadata:{report_target:'road_reference'}};
 const station={id:'station',name:'Existing Station',kind:'place',latitude:3.225,longitude:101.73088,metadata:{}};
 const app=harness({extraFacilities:[roadReference],places:[roadPlace,station]});app.render();await tick();const tree=app.render();
 const choices=nodes(tree).filter(n=>n.props?.accessibilityRole==='radio');
 assert.ok(!choices.some(n=>text(n).includes('Road reference')));assert.ok(choices.some(n=>text(n).includes('Existing Station')));
 assert.ok(choices.some(n=>text(n).includes(first.name)));
});

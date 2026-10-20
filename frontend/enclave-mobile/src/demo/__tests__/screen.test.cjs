/* global __dirname */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.join(__dirname,'..');const raw=JSON.parse(fs.readFileSync(path.join(root,'kl-east-demo.json'),'utf8'));
function compile(name,requires){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:requires,fetch:()=>{throw Error('Resident demo must not call live APIs');},console,Error});return m.exports;}
const network=compile('network.ts',()=>raw);const driving=compile('driving.ts',()=>network);const access=compile('access.ts',()=>network);const progress=compile('navigationProgress.ts',()=>network);let states=[],cursor=0,exited=false,reported=false,cameraCalls=[],openedUrls=[],serverCalls=[],responder=null;
function serverResponse(payload){const adjusted=Math.abs(payload.origin.longitude-101.7310841)<1e-7;const selected=adjusted?(payload.start_candidates[0]||payload.origin):payload.origin;const modes=payload.profile==='wheelchair'?['accessible']:['shortest','avoid_damage','accessible'];return{area_id:'kl-east-pilot',requested_origin:payload.origin,selected_origin:selected,start_adjustment_meters:adjusted?35:0,adjusted_start:adjusted,options:modes.map((mode,i)=>({mode,unavailable_reason:null,route:{route_id:`demo-${serverCalls.length}-${mode}`,generated_at:new Date().toISOString(),area:'kl-east-pilot',routing_engine:'osm_roadside',road_fallback_used:true,crossing_policy:'mapped_facilities_only',mapped_crossing_count:0,route_mode:mode,geometry:{type:'LineString',coordinates:[[selected.longitude,selected.latitude],[payload.destination.longitude,payload.destination.latitude]]},distance_meters:160+i*25,duration_seconds:160,origin_snap_distance_meters:0,destination_snap_distance_meters:0,maneuvers:[],community_issue_avoidance:'not_applied',obstacle_count:0,obstacle_snapshot_at:null,obstacle_source:null,confirmation_threshold:2,data_source:'openstreetmap_unverified',field_verified:false,accessibility_status:mode==='accessible'?'synthetic_network':'not_requested',warnings:['Demo-only route'],attribution:'OpenStreetMap contributors',attribution_url:'https://www.openstreetmap.org/copyright',demo_facility_ids:[raw.facilities[0].id]}}))};}
const react={useEffect:()=>{},useCallback:fn=>fn,useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],next=>states[i]=typeof next==='function'?next(states[i]):next];},useMemo:fn=>fn(),useRef(initial){const i=cursor++;if(!(i in states))states[i]={current:initial===null?{fitBounds:(bounds,options)=>{assert.ok(Array.isArray(bounds)&&bounds.length===4&&bounds.every(Number.isFinite));assert.ok(options.padding);cameraCalls.push(bounds);},easeTo:x=>cameraCalls.push(x)}:initial};return states[i];}};
const Screen=compile('DemoMapScreen.tsx',name=>{
 if(name==='../navigation/NamedMapPoint')return{__esModule:true,default:'NamedMapPoint'};
 if(name==='../navigation/PlaceSearch')return{__esModule:true,default:'PlaceSearch'};
 if(name==='../savedPlaces/SavedPlacesControl')return{__esModule:true,default:'SavedPlacesControl'};
 if(name==='../lib/api')return{demoAreasApi:{getRoutes:async(token,areaId,payload)=>{serverCalls.push({token,areaId,payload});return responder?responder(payload):serverResponse(payload);}}};
 if(name==='../lib/supabase')return{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'fixture-token'}},error:null})}}};
 if(name==='expo-location')return {};
 if(name==='react')return react;
 if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 if(name==='react-native')return{Pressable:'Pressable',Text:'Text',TextInput:'TextInput',View:'View',Keyboard:{dismiss:()=>{}},Linking:{openURL:async url=>openedUrls.push(url)},StyleSheet:{create:x=>x}};
 if(name==='../navigation/NativeMap')return{NativeMap:'Map'};
 if(name==='../navigation/NamedMapPoint')return{__esModule:true,default:'NamedMapPoint'};
 if(name==='@maplibre/maplibre-react-native')return{Camera:'Camera',GeoJSONSource:'GeoJSONSource',Layer:'Layer',Map:'Map',Marker:'Marker'};
 if(name==='@expo/vector-icons')return{MaterialCommunityIcons:'MaterialCommunityIcons'};
 if(name==='./access')return access;if(name==='./JourneyGuidance')return{__esModule:true,default:'JourneyGuidance'};
 if(name==='../theme')return{colors:{navy:'#202C46',muted:'#687083',white:'#FFFFFF',border:'#E3E1DC',lavender:'#E9E7F1'}};
 if(name==='./network')return network;if(name==='./driving')return driving;if(name==='./navigationProgress')return progress;throw Error('Unexpected import '+name);
}).default;
function tree(){cursor=0;return Screen({areaId:'kl-east-pilot',onShowLiveMap:()=>exited=true,onReportPress:()=>reported=true});}
function all(t){if(!t||typeof t!=='object')return[];if(Array.isArray(t))return t.flatMap(all);return[t,...all(t.props?.children)];}
function text(t){if(t==null)return'';if(typeof t!=='object')return String(t);if(Array.isArray(t))return t.map(text).join(' ');return text(t.props?.children);}
function find(t,predicate){const item=all(t).find(predicate);assert.ok(item,'UI control not found');return item;}
function button(t,label){return find(t,n=>n.type==='Pressable'&&(n.props.accessibilityLabel===label||text(n)===label));}
function mapTap(t,coordinate){find(t,n=>n.type==='Map').props.onPress({nativeEvent:{lngLat:coordinate}});}
async function chooseJourney(){let t=tree();mapTap(t,[101.7307337,3.2254158]);t=tree();mapTap(t,[101.732159,3.2277914]);t=tree();await button(t,'Choose route').props.onPress();return tree();}
const cases=[],pending=[];function test(name,fn){pending.push(async()=>{states=[];cursor=0;exited=false;reported=false;cameraCalls=[];openedUrls=[];serverCalls=[];responder=null;try{await fn();cases.push({name,passed:true});}catch(e){cases.push({name,passed:false,error:e.message});}});}
test('Resident screen starts with blank inputs, no route or predefined endpoints',()=>{
 const t=tree();const inputs=all(t).filter(n=>n.type==='TextInput');assert.equal(inputs.length,2);assert.ok(inputs.every(n=>n.props.value===''));
 assert.equal(all(t).filter(n=>n.type==='Marker').length,0);assert.ok(!all(t).some(n=>n.props?.id==='demo-selected-route'));
 assert.ok(text(t).includes('Around your neighbourhood.'));
});
test('Management repair/count/cost controls are absent',()=>{
 const t=tree();const controls=all(t).filter(n=>n.type==='Pressable').map(text).join(' ');assert.ok(!/simulate|repair|RM\s|cost/i.test(controls));assert.ok(!all(t).some(n=>n.props?.accessibilityRole==='checkbox'));
});
test('Default map shows reported damage only; optional overlays keep every facility and place available',()=>{
 let t=tree();const visible=find(t,n=>n.props?.id==='demo-facilities').props.data.features;
 assert.equal(visible.length,35);assert.ok(visible.every(f=>f.properties.blocked));
 assert.ok(!all(t).some(n=>n.props?.id==='demo-places'||n.props?.id==='demo-navigation-facilities'||n.props?.id==='demo-navigation-lines'));
 assert.ok(text(t).includes('Map legend'));assert.ok(text(t).includes('Stairs'));assert.ok(text(t).includes('Show facility markers'));
 button(t,'Show facility markers').props.onPress();t=tree();const f=find(t,n=>n.props?.id==='demo-facilities');const p=find(t,n=>n.props?.id==='demo-places');
 assert.equal(f.props.data.features.length,138);assert.equal(p.props.data.features.length,249);assert.ok(text(t).includes('138'));assert.ok(text(t).includes('35'));
 assert.equal(find(t,n=>n.props?.id==='demo-facility-labels').props.layout['text-font'].join(','),'Noto Sans Regular');
});
test('Choosing route before selecting both endpoints explains the missing choice',async()=>{
 let t=tree();await button(t,'Choose route').props.onPress();t=tree();assert.ok(text(t).includes('Select both locations'));assert.equal(all(t).filter(n=>n.props?.accessibilityRole==='radio').length,0);
});
test('Map taps choose arbitrary start then end, then ask the authenticated backend for three routes',async()=>{
 const t=await chooseJourney();assert.equal(all(t).filter(n=>n.type==='Marker').length,2);assert.equal(all(t).filter(n=>n.props?.accessibilityRole==='radio').length,3);
 assert.ok(all(t).some(n=>n.props?.id==='demo-selected-route'));assert.ok(text(t).includes('Facilities on this route'));assert.ok(cameraCalls.length);
 assert.equal(serverCalls.length,1);assert.equal(serverCalls[0].token,'fixture-token');assert.equal(serverCalls[0].areaId,'kl-east-pilot');assert.equal(serverCalls[0].payload.profile,'walking');
});
test('Hiding facility icons preserves the chosen route, endpoints and routing metadata',async()=>{
 let t=await chooseJourney();const geometry=JSON.stringify(find(t,n=>n.props?.id==='demo-selected-route').props.data);
 button(t,'Show facility markers').props.onPress();t=tree();
 assert.equal(find(t,n=>n.props?.id==='demo-facilities').props.data.features.length,raw.facilities.length);
 button(t,'Show facility markers').props.onPress();t=tree();
 assert.equal(JSON.stringify(find(t,n=>n.props?.id==='demo-selected-route').props.data),geometry);
 assert.equal(all(t).filter(n=>n.type==='Marker').length,2);assert.equal(serverCalls.length,1);
 assert.ok(text(t).includes('Facilities on this route'));
});

test('Editing an endpoint invalidates cached coordinates and the old route',async()=>{
 let t=await chooseJourney();find(t,n=>n.type==='TextInput'&&n.props.accessibilityLabel==='Starting point').props.onChangeText('KL East Mall');t=tree();
 assert.ok(!all(t).some(n=>n.props?.id==='demo-selected-route'));assert.equal(all(t).filter(n=>n.type==='Marker').length,1);
 await button(t,'Choose route').props.onPress();t=tree();assert.ok(text(t).includes('Select both locations'));
});
test('Real-place search resolves coordinates only when a suggestion is selected',()=>{
 let t=tree();find(t,n=>n.type==='TextInput'&&n.props.accessibilityLabel==='Starting point').props.onChangeText('KL East Mall');t=tree();
 assert.equal(all(t).filter(n=>n.type==='Marker').length,0);const search=find(t,n=>n.type==='PlaceSearch');search.props.onChoose(search.props.local.find(p=>p.label==='KL East Mall'));t=tree();assert.equal(all(t).filter(n=>n.type==='Marker').length,1);
 assert.equal(find(t,n=>n.type==='TextInput'&&n.props.accessibilityLabel==='Starting point').props.value,'KL East Mall');
});
test('Facility selection stops event propagation and does not silently choose endpoints',()=>{
 let t=tree(),stopped=false;const f=raw.facilities[0];find(t,n=>n.props?.id==='demo-facilities').props.onPress({stopPropagation:()=>stopped=true,nativeEvent:{features:[{properties:{id:f.id}}]}});t=tree();
 assert.ok(stopped);assert.ok(text(t).includes(f.name));assert.equal(all(t).filter(n=>n.type==='Marker').length,0);
 assert.deepEqual(find(t,n=>n.props?.id==='demo-selection-highlight').props.data.features[0].geometry.coordinates,f.coordinate);
 button(t,'Use as start').props.onPress();t=tree();assert.equal(all(t).filter(n=>n.type==='Marker').length,1);
});
test('Simulated crossing selection shows its geometry and demo label; route facility reaches guidance',async()=>{
 let t=tree();button(t,'Show facility markers').props.onPress();t=tree();const f=raw.navigationFacilities.find(f=>f.routingSource==='simulation');let stopped=false;
 find(t,n=>n.props?.id==='demo-navigation-facilities').props.onPress({stopPropagation:()=>stopped=true,nativeEvent:{features:[{properties:{id:f.id}}]}});
 t=tree();assert.ok(stopped);assert.ok(text(t).includes('Simulated infrastructure'));
 assert.ok(find(t,n=>n.props?.id==='demo-navigation-lines').props.data.features.some(x=>x.id===f.id));
 responder=payload=>{const r=serverResponse(payload);for(const option of r.options)option.route.demo_facility_ids.push(f.id);return r;};
 t=await chooseJourney();assert.ok(text(t).includes(f.name));
 button(t,'Start Enclave guidance').props.onPress();t=tree();
 const guidance=find(t,n=>n.type==='JourneyGuidance');assert.ok(guidance.props.route.navigationFacilities.some(x=>x.id===f.id));
});
test('Invalid point is rejected instead of drawing a cross-area connector',()=>{
 let t=tree();mapTap(t,[0,0]);t=tree();assert.ok(text(t).includes('inside the current service area'));assert.equal(all(t).filter(n=>n.type==='Marker').length,0);
});
test('Selecting a different mode updates route state without changing endpoint choices',async()=>{
 let t=await chooseJourney();find(t,n=>n.props?.accessibilityRole==='radio'&&text(n).includes('Demo step-free route')).props.onPress();t=tree();
 assert.ok(find(t,n=>n.props?.accessibilityRole==='radio'&&text(n).includes('Demo step-free route')).props.accessibilityState.checked);
 assert.equal(all(t).filter(n=>n.type==='Marker').length,2);
});
test('Report and live-map buttons use existing app callbacks without writing demo records',()=>{
 const t=tree();button(t,'Report an issue').props.onPress();button(t,'Open live community map').props.onPress();assert.ok(reported&&exited);
});
test('Travel selector offers Car, Walking and Wheelchair with walking initially selected',()=>{
 const t=tree();const tabs=all(t).filter(n=>n.props?.accessibilityRole==='tab');assert.equal(tabs.length,3);
 assert.ok(tabs.find(n=>n.props.accessibilityLabel==='Walking').props.accessibilityState.selected);
});
test('Wheelchair sends an accessible profile to the backend and offers only its synthetic step-free route',async()=>{
 let t=await chooseJourney();button(t,'Wheelchair').props.onPress();t=tree();
 assert.equal(all(t).filter(n=>n.type==='Marker').length,2);assert.ok(!all(t).some(n=>n.props?.id==='demo-selected-route'));
 await button(t,'Choose route').props.onPress();t=tree();const options=all(t).filter(n=>n.props?.accessibilityRole==='radio');
 assert.equal(options.length,1);assert.ok(text(options[0]).includes('Demo step-free route'));assert.ok(text(t).includes('not field verified'));
 assert.equal(serverCalls.length,2);assert.equal(serverCalls[1].payload.profile,'wheelchair');
});
test('Step-free route displays its simulated facilities while unrelated facilities remain hidden',async()=>{
 let t=tree();button(t,'Wheelchair').props.onPress();
 const facility=raw.accessibilityFacilities.find(f=>f.kind==='footbridge');
 responder=payload=>{const result=serverResponse(payload);for(const option of result.options)option.route.demo_facility_ids.push(facility.id);return result;};
 t=await chooseJourney();const source=find(t,n=>n.props?.id==='demo-navigation-facilities');
 assert.equal(source.props.data.features.length,1);assert.equal(source.props.data.features[0].properties.symbol,'SF');
 assert.equal(source.props.data.features[0].properties.id,facility.id);assert.ok(text(t).includes('SF: simulated'));
 assert.ok(!all(t).some(n=>n.props?.id==='demo-places'));assert.ok(text(t).includes(facility.name));
 button(t,'Start Enclave guidance').props.onPress();t=tree();
 assert.ok(find(t,n=>n.type==='JourneyGuidance').props.route.navigationFacilities.some(f=>f.id===facility.id&&f.stepFree));
});

test('Car does not relabel or display old walking routes and only opens driving directions after pressing its button',async()=>{
 let t=await chooseJourney();button(t,'Car').props.onPress();t=tree();assert.equal(openedUrls.length,0);assert.ok(!all(t).some(n=>n.props?.id==='demo-selected-route'));
 assert.equal(all(t).filter(n=>n.props?.accessibilityRole==='radio').length,0);assert.equal(all(t).filter(n=>n.type==='Marker').length,2);
 button(t,'Open driving navigation').props.onPress();assert.equal(openedUrls.length,1);const url=new URL(openedUrls[0]);assert.equal(url.searchParams.get('travelmode'),'driving');
 assert.equal(url.searchParams.get('origin'),'3.2254158,101.7307337');assert.ok(text(t).includes('not sent to Google Maps'));
});
test('Car and walking preserve raw off-network pins for explicit access planning',()=>{
 let t=tree();button(t,'Car').props.onPress();t=tree();mapTap(t,[101.738,3.233]);t=tree();assert.equal(all(t).filter(n=>n.type==='Marker').length,1);
 assert.ok(!text(t).includes('Road access'));button(t,'Walking').props.onPress();t=tree();
 assert.equal(all(t).filter(n=>n.type==='Marker').length,1);assert.ok(!text(t).includes('no nearby walking access'));
});
test('Transport icons share one family, size and fixed-height button layout',()=>{
 const t=tree(),icons=all(t).filter(n=>n.type==='MaterialCommunityIcons');assert.equal(icons.length,3);assert.ok(icons.every(n=>n.props.size===24));
 const tabs=all(t).filter(n=>n.props?.accessibilityRole==='tab');assert.ok(tabs.every(n=>n.props.style[0].height===78));
});
test('Backend nearby-start suggestion requires consent before updating the start and beginning guidance',async()=>{
 let t=tree();const a=[101.7310841,3.22541875],b=[101.73433705,3.22556645];mapTap(t,a);t=tree();mapTap(t,b);t=tree();await button(t,'Choose route').props.onPress();t=tree();
 assert.ok(text(t).includes('nearby connected starting point'));assert.ok(all(t).some(n=>n.props?.id==='demo-suggested-start'));
 assert.deepEqual(find(t,n=>n.props?.id==='demo-endpoint-0').props.lngLat,a);
 button(t,'Accept and update start').props.onPress();t=tree();assert.ok(all(t).some(n=>n.props?.id==='demo-original-start'));
 button(t,'Go to adjusted starting point').props.onPress();t=tree();assert.ok(all(t).some(n=>n.type==='JourneyGuidance'));
});
test('Backend maneuver text and type are retained by the navigation route',async()=>{
 responder=payload=>{const response=serverResponse(payload);for(const option of response.options)option.route.maneuvers=[{instruction:'Turn left onto Garden Road.',spoken_instruction:'Turn left.',coordinate:[payload.origin.longitude,payload.origin.latitude],distance_from_start_meters:0,begin_shape_index:0,type:15}];return response;};
 let t=await chooseJourney();button(t,'Start Enclave guidance').props.onPress();t=tree();const guide=find(t,n=>n.type==='JourneyGuidance');
 assert.equal(guide.props.route.maneuvers[0].instruction,'Turn left onto Garden Road.');assert.equal(guide.props.route.maneuvers[0].type,15);assert.equal(guide.props.route.maneuvers[0].distanceFromStart,0);
});

test('Start opens a fullscreen navigation modal; Android back and Exit return to planning',async()=>{
 let t=await chooseJourney();button(t,'Start Enclave guidance').props.onPress();t=tree();
 const modal=find(t,n=>n.props?.presentationStyle==='fullScreen');assert.equal(modal.props.visible,true);
 const guide=find(t,n=>n.type==='JourneyGuidance');assert.equal(typeof guide.props.presentation.styleUrl,'string');
 guide.props.presentation.onClose();t=tree();assert.ok(!all(t).some(n=>n.type==='JourneyGuidance'));
 button(t,'Start Enclave guidance').props.onPress();t=tree();find(t,n=>n.props?.presentationStyle==='fullScreen').props.onRequestClose();
 assert.ok(!all(tree()).some(n=>n.type==='JourneyGuidance'));
});

test('GPS reroute keeps the selected avoid-damage mode and destination and uses no silent start adjustment',async()=>{
 let t=await chooseJourney();find(t,n=>n.props?.accessibilityRole==='radio'&&text(n).includes('Avoid damaged facilities')).props.onPress();t=tree();button(t,'Start Enclave guidance').props.onPress();t=tree();
 const destination=Array.from(find(t,n=>n.props?.id==='demo-endpoint-1').props.lngLat),gps=[101.7308,3.2257];
 const result=await find(t,n=>n.type==='JourneyGuidance').props.onReroute(gps);assert.equal(result,true);t=tree();
 assert.equal(serverCalls.length,2);assert.equal(serverCalls[1].payload.profile,'walking');assert.equal(serverCalls[1].payload.start_candidates.length,0);
 assert.equal(serverCalls[1].payload.destination.longitude,destination[0]);assert.equal(serverCalls[1].payload.destination.latitude,destination[1]);
 assert.equal(find(t,n=>n.type==='JourneyGuidance').props.route.mode,'avoid_damage');assert.deepEqual(Array.from(find(t,n=>n.props?.id==='demo-endpoint-0').props.lngLat),gps);
});

test('Wheelchair reroute failure retains the existing accessible route instead of falling back to walking',async()=>{
 let t=await chooseJourney();button(t,'Wheelchair').props.onPress();t=tree();await button(t,'Choose route').props.onPress();t=tree();button(t,'Start Enclave guidance').props.onPress();t=tree();
 const guide=find(t,n=>n.type==='JourneyGuidance'),oldId=guide.props.route.id;
 responder=payload=>{const response=serverResponse(payload);for(const option of response.options){option.route=null;option.unavailable_reason='No step-free route from this position.';}return response;};
 await assert.rejects(guide.props.onReroute([101.7308,3.2257]),/No step-free route/);t=tree();
 assert.equal(serverCalls.at(-1).payload.profile,'wheelchair');assert.equal(find(t,n=>n.type==='JourneyGuidance').props.route.id,oldId);assert.equal(find(t,n=>n.type==='JourneyGuidance').props.route.mode,'accessible');
});

test('Closing navigation invalidates a pending reroute response',async()=>{
 let t=await chooseJourney();const original=Array.from(find(t,n=>n.props?.id==='demo-endpoint-0').props.lngLat);button(t,'Start Enclave guidance').props.onPress();t=tree();let finish,payload;
 responder=body=>{payload=body;return new Promise(resolve=>finish=resolve);};const response=find(t,n=>n.type==='JourneyGuidance').props.onReroute([101.7308,3.2257]);
 await new Promise(resolve=>setImmediate(resolve));button(tree(),'Close route guidance').props.onPress();finish(serverResponse(payload));assert.equal(await response,false);t=tree();
 assert.ok(!all(t).some(n=>n.type==='JourneyGuidance'));assert.deepEqual(Array.from(find(t,n=>n.props?.id==='demo-endpoint-0').props.lngLat),original);
});

test('Changing route mode invalidates an old in-flight reroute',async()=>{
 let t=await chooseJourney();button(t,'Start Enclave guidance').props.onPress();t=tree();let finish,payload;
 responder=body=>{payload=body;return new Promise(resolve=>finish=resolve);};const response=find(t,n=>n.type==='JourneyGuidance').props.onReroute([101.7308,3.2257]);await new Promise(resolve=>setImmediate(resolve));
 find(tree(),n=>n.props?.accessibilityRole==='radio'&&text(n).includes('Avoid damaged facilities')).props.onPress();finish(serverResponse(payload));assert.equal(await response,false);t=tree();
 assert.ok(find(t,n=>n.props?.accessibilityRole==='radio'&&text(n).includes('Avoid damaged facilities')).props.accessibilityState.checked);assert.ok(!all(t).some(n=>n.type==='JourneyGuidance'));
});

test('Arrival invalidates a pending reroute so an old response cannot restart the journey',async()=>{
 let t=await chooseJourney();button(t,'Start Enclave guidance').props.onPress();t=tree();const guide=find(t,n=>n.type==='JourneyGuidance'),oldId=guide.props.route.id;let finish,payload;
 responder=body=>{payload=body;return new Promise(resolve=>finish=resolve);};const response=guide.props.onReroute([101.7308,3.2257]);await new Promise(resolve=>setImmediate(resolve));
 guide.props.onComplete();finish(serverResponse(payload));assert.equal(await response,false);t=tree();assert.equal(find(t,n=>n.type==='JourneyGuidance').props.route.id,oldId);
});

test('Off-area GPS never makes a backend reroute request',async()=>{
 let t=await chooseJourney();button(t,'Start Enclave guidance').props.onPress();t=tree();await assert.rejects(find(t,n=>n.type==='JourneyGuidance').props.onReroute([0,0]),/outside the selected service area/);assert.equal(serverCalls.length,1);
});

test('Following GPS does not fight user map gestures and can be resumed explicitly',async()=>{
 let t=await chooseJourney();button(t,'Start Enclave guidance').props.onPress();t=tree();find(t,n=>n.type==='JourneyGuidance').props.onPosition([101.7308,3.2257]);t=tree();const count=cameraCalls.length;
 find(t,n=>n.type==='View'&&n.props.onTouchStart).props.onTouchStart();find(t,n=>n.type==='JourneyGuidance').props.onPosition([101.7309,3.2257]);t=tree();assert.equal(cameraCalls.length,count);
 button(t,'Follow my location').props.onPress();assert.equal(cameraCalls.length,count+1);
});

void(async()=>{for(const run of pending)await run();console.log(JSON.stringify(cases,null,2));process.exitCode=cases.some(c=>!c.passed)?1:0;})();

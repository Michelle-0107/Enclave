/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const mobile = path.resolve(__dirname, '..');
const ts = createRequire(path.join(mobile, 'package.json'))('typescript');
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const native = Object.fromEntries(['ActivityIndicator','Image','Modal','Pressable','ScrollView','Text','View'].map(name => [name,name]));
native.StyleSheet = { create: value => value };
function hooks() {
  let cursor = 0; const state = [], pending = [], effects = new Set();
  return { begin() { cursor = 0; }, flush() { for (const fn of pending.splice(0)) fn(); }, react: {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current:initial }; return state[index]; },
    useEffect(effect) { const index = cursor++; if (!effects.has(index)) { effects.add(index); pending.push(effect); } },
  } };
}
function load(file, getDependency, extra = '') {
  const output = ts.transpileModule(fs.readFileSync(path.join(mobile,file),'utf8') + extra, {
    compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX, esModuleInterop:true },
  }).outputText;
  const mod = { exports:{} };
  vm.runInNewContext(output, { module:mod,exports:mod.exports,require:getDependency,console,Error });
  return mod.exports;
}
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree,...nodes(tree.props?.children)]; }
function text(tree) { if (tree == null) return ''; if (typeof tree !== 'object') return String(tree); return Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children); }
function find(tree, predicate) { const found = nodes(tree).find(predicate); assert.ok(found,'Expected UI control'); return found; }
function button(tree,label) { return find(tree,item=>item.type==='Pressable'&&(item.props.accessibilityLabel===label||text(item).trim()===label)); }
const tick = () => new Promise(resolve=>setImmediate(resolve));
function fixture(related = null) {
  const runtime=hooks(), opened=[], receipts=[]; let failRead=false, failSession=false;
  const data={id:7,title:'Management update',message:'Full announcement.\nPlease use the north entrance.',related_report_id:related,is_read:false,created_at:new Date().toISOString()};
  const Screen=load('src/screens/NotificationsScreen.tsx', name=>{
    if(name==='react')return runtime.react;
    if(name==='react/jsx-runtime')return jsx;
    if(name==='react-native')return native;
    if(name==='../theme')return{colors:{}};
    if(name==='../lib/supabase')return{supabase:{auth:{getSession:async()=>{if(failSession)throw Error('Offline');return{data:{session:{access_token:'synthetic'}}};}}}};
    if(name==='../lib/api')return{notificationsApi:{getAll:async()=>({items:[data]}),markRead:async(token,id)=>{receipts.push([token,id]);if(failRead)throw Error('Offline');}}};
    if(name.endsWith('.png'))return'synthetic-image';
    throw Error('Unexpected import '+name);
  }).default;
  function render(){runtime.begin();const tree=Screen({onNotificationPress:item=>opened.push(item)});runtime.flush();return tree;}
  return{render,opened,receipts,failRead:()=>{failRead=true;},failSession:()=>{failSession=true;}};
}
async function main(){
  let passed=0;
  const announcement=fixture();announcement.render();await tick();
  let tree=announcement.render();button(tree,'Unread. Management update').props.onPress();await tick();tree=announcement.render();
  assert.equal(announcement.opened.length,0);assert.equal(find(tree,item=>item.type==='Modal').props.visible,true);
  assert.ok(text(tree).includes('Full announcement.\nPlease use the north entrance.'));
  assert.ok(!nodes(tree).some(item=>item.type==='Pressable'&&text(item).trim()==='View my reports'));
  assert.equal(JSON.stringify(announcement.receipts),'[["synthetic",7]]');
  console.log('PASS: announcement opens full text, marks the correct notification read and never navigates to map');passed++;
  find(tree,item=>item.type==='Modal').props.onRequestClose();tree=announcement.render();
  assert.equal(find(tree,item=>item.type==='Modal').props.visible,false);button(tree,'Management update');
  console.log('PASS: Android Back closes details and leaves the read notification in its list');passed++;
  const related=fixture(42);related.render();await tick();tree=related.render();button(tree,'Unread. Management update').props.onPress();await tick();tree=related.render();
  assert.equal(related.opened.length,0);button(tree,'View my reports').props.onPress();
  assert.equal(related.opened.length,1);assert.equal(related.opened[0].target.type,'reports');assert.equal(related.opened[0].target.reportId,undefined);
  assert.equal(find(related.render(),item=>item.type==='Modal').props.visible,false);
  console.log('PASS: related-report notification navigates only after the explicit button; numeric DB ID is never treated as ticket ID');passed++;
  for(const failure of ['failRead','failSession']){
    const offline=fixture();offline.render();await tick();tree=offline.render();offline[failure]();
    button(tree,'Unread. Management update').props.onPress();await tick();
    assert.equal(find(offline.render(),item=>item.type==='Modal').props.visible,true);assert.equal(offline.opened.length,0);
  }
  console.log('PASS: failed session/read-receipt request does not discard the notification or trigger navigation');passed++;
  const runtime=hooks();
  const app=load('App.tsx',name=>{
    if(name==='react')return runtime.react;
    if(name==='react/jsx-runtime')return jsx;
    if(name==='react-native')return native;
    if(name==='react-native-safe-area-context')return{SafeAreaProvider:'SafeAreaProvider',SafeAreaView:'SafeAreaView',useSafeAreaInsets:()=>({bottom:0,top:0})};
    if(name==='expo-status-bar')return{StatusBar:'StatusBar'};
    if(name==='@expo/vector-icons')return{Ionicons:'Ionicons'};
    if(name==='./src/theme')return{colors:{}};
    if(name==='./src/lib/session')return{clearAccessToken:async()=>{}};
    if(name==='./src/lib/supabase')return{supabase:{}};
    if(name.startsWith('./src/'))return{__esModule:true,default:path.basename(name),defaultNotificationPreferences:{},defaultFollowedAreas:[]};
    throw Error('Unexpected import '+name);
  },'\nexports.ResidentAppForTest=ResidentApp;').ResidentAppForTest;
  function appTree(){runtime.begin();return app({onLogOut(){}});}
  button(appTree(),'Notifications').props.onPress();tree=appTree();
  let screen=find(tree,item=>item.type==='NotificationsScreen');screen.props.onNotificationPress({target:{type:'announcement'}});
  tree=appTree();find(tree,item=>item.type==='NotificationsScreen');assert.ok(!nodes(tree).some(item=>item.type==='DemoMapScreen'||item.type==='MapScreen'));
  screen=find(tree,item=>item.type==='NotificationsScreen');screen.props.onNotificationPress({target:{type:'reports'}});
  find(appTree(),item=>item.type==='MyReportsScreen');
  console.log('PASS: actual App handler keeps announcements on Notifications and sends explicit report actions to My Reports');passed++;
  console.log(`${passed} notification navigation checks passed.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});

import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const extension=fileURLToPath(new URL('../extension/',import.meta.url));
const VERSION=JSON.parse(readFileSync(extension+'manifest.json','utf8')).version;
const names=['Design explorations · Figma','项目周报与进展','GitHub · Pull requests','Documentation','产品思考与工作笔记','Inbox · Mail','New Tab'];
const hosts=['figma.com','docs.example.com','github.com','developer.chrome.com','notion.so','mail.google.com','chrome://newtab'];
const items=names.map((title,i)=>({id:i+1,title,url:hosts[i].startsWith('chrome:')?hosts[i]:'https://'+hosts[i]}));
const idle=['旧版设计稿 · Figma','季度规划草稿','Stack Overflow · Swift concurrency','Chrome Tabs API','会议纪要 9/12'];
const idleHosts=['figma.com','docs.example.com','stackoverflow.com','developer.chrome.com','notion.so'];
const hour=3600000, now=Date.now();
// Window 1: the recent seven plus three idle tabs; window 2: two idle tabs and copies of open pages.
const open=[
  ...items.map((t,i)=>({...t,windowId:1,lastActive:now-i*60000,active:i===0})),
  ...idle.map((title,i)=>({id:20+i,windowId:i<3?1:2,title,url:'https://'+idleHosts[i]+'/archive',lastActive:now-[90,52,40,26,15][i]*hour})),
  {id:30,windowId:2,title:names[2],url:'https://'+hosts[2],lastActive:now-3*hour,active:true},
  {id:31,windowId:2,title:names[0],url:'https://'+hosts[0],lastActive:now-30*hour},
  {id:32,windowId:1,title:names[0],url:'https://'+hosts[0],lastActive:now-50*hour,pinned:true},
  {id:33,windowId:2,title:names[5],url:'https://'+hosts[5],lastActive:now-2*hour},
  {id:34,windowId:2,title:names[5],url:'https://'+hosts[5],lastActive:now-5*hour},
].map((t,index)=>({...t,index}));
// Tab groups in window 1, an unnamed one in window 2, with ungrouped tabs between and after them.
const groups=[{id:1,title:'home',color:'red'},{id:2,title:'cad',color:'grey'},{id:3,title:'开源文档评测结果分析',color:'green'},{id:4,title:'',color:'blue'}];
const grouped={1:1,2:1,3:2,4:2,6:3,7:3,31:4,33:4};
for(const t of open) t.groupId=grouped[t.id]??-1;
function installPreview(items,open,groups) {
  const flag=()=>{
    const groups={};open.forEach(t=>(groups[t.url]??=[]).push(t));
    for(const g of Object.values(groups)){
      g.sort((a,b)=>(!!b.active-!!a.active)||b.lastActive-a.lastActive);
      g.forEach((t,i)=>{t.duplicate=g.length<2?'':i===0||t.active||t.pinned?'keep':'close';});
    }
  };
  const idle=(min=12*3600000)=>open.filter(t=>!t.active&&!t.pinned&&Date.now()-t.lastActive>=min).sort((a,b)=>a.lastActive-b.lastActive).map(t=>({...t,idle:Date.now()-t.lastActive}));
  const close=ids=>{const closed=open.filter(t=>ids.includes(t.id));open=open.filter(t=>!ids.includes(t.id));flag();return {ok:true,closed};};
  flag();
  const state={items,settings:{scope:'all',previews:true,autoDiscard:true,discardAfter:60},discardSummary:{time:Date.now(),discarded:9,prompted:1,unchecked:2,trigger:'startup'},native:{connected:true,trusted:true,version:VERSION}};
  window.previewActions=[];
  window.chrome.runtime={getManifest:()=>({version:VERSION}),async sendMessage(message) {
    window.previewActions.push(message);
    if(message.type==='state') return structuredClone({...state,inactiveCount:idle().length,duplicateCount:open.filter(t=>t.duplicate==='close').length});
    if(message.type==='inactive') return {ok:true,now:Date.now(),items:structuredClone(idle(0))};
    if(message.type==='all-tabs') return {ok:true,now:Date.now(),items:structuredClone(open),groups:structuredClone(groups)};
    if(message.type==='close-inactive') return close(idle(message.minIdle).map(t=>t.id).filter(id=>message.ids.includes(id)));
    if(message.type==='close-duplicates') return close(open.filter(t=>t.duplicate==='close'&&message.ids.includes(t.id)).map(t=>t.id));
    if(message.type==='close-tab') return close([message.id]);
    if(message.type==='restore-closed'){open.push(...message.items.map((t,i)=>({...t,id:100+open.length+i,lastActive:Date.now()})));flag();return {ok:true,restored:message.items.length};}
    if(message.type==='settings') state.settings={scope:message.scope,previews:message.previews,autoDiscard:message.autoDiscard,discardAfter:message.discardAfter};
    return {ok:true};
  }};
}
const mock=`const VERSION=${JSON.stringify(VERSION)};(${installPreview.toString()})(${JSON.stringify(items)},${JSON.stringify(open)},${JSON.stringify(groups)});`;
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/mock.js'){res.setHeader('Content-Type','text/javascript');res.end(mock);return;}
  if(pathname==='/'||pathname==='/popup.html'||pathname==='/tabs.html'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const page=pathname==='/tabs.html'?'tabs':'popup';
    const source=readFileSync(extension+page+'.html','utf8').replace(`<script src="${page}.js"`,`<script src="mock.js"></script><script src="${page}.js"`);
    res.end(source);return;
  }
  const allow={'/popup.css':'text/css','/popup.js':'text/javascript','/tabs.css':'text/css','/tabs.js':'text/javascript','/core.mjs':'text/javascript','/icon128.png':'image/png'};
  if(!allow[pathname]){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',allow[pathname]);res.end(readFileSync(extension+pathname));
});
server.listen(4177,'127.0.0.1',()=>console.log('Fixture preview: http://127.0.0.1:4177'));

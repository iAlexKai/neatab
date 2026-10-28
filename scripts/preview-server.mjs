import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const extension=fileURLToPath(new URL('../extension/',import.meta.url));
const names=['Design explorations · Figma','项目周报与进展','GitHub · Pull requests','Documentation','产品思考与工作笔记','Inbox · Mail','New Tab'];
const hosts=['figma.com','docs.example.com','github.com','developer.chrome.com','notion.so','mail.google.com','chrome://newtab'];
const items=names.map((title,i)=>({id:i+1,title,url:hosts[i].startsWith('chrome:')?hosts[i]:'https://'+hosts[i]}));
const idle=['旧版设计稿 · Figma','季度规划草稿','Stack Overflow · Swift concurrency','Chrome Tabs API','会议纪要 9/12'];
const idleHosts=['figma.com','docs.example.com','stackoverflow.com','developer.chrome.com','notion.so'];
const inactive=idle.map((title,i)=>({id:20+i,windowId:i<3?1:2,title,url:'https://'+idleHosts[i],lastActive:Date.now()-[90,40,26,15,13][i]*3600000}));
function installPreview(items,inactive) {
  const state={items,inactive,inactiveCount:inactive.length,settings:{scope:'all',previews:true},native:{connected:true,trusted:true,version:'1.3.0'}};
  window.previewActions=[];
  window.chrome.runtime={getManifest:()=>({version:'1.3.0'}),async sendMessage(message) {
    window.previewActions.push(message);
    if(message.type==='state') return structuredClone({...state,inactiveCount:state.inactive.length});
    if(message.type==='inactive') return {ok:true,now:Date.now(),items:structuredClone(state.inactive)};
    if(message.type==='close-inactive'){const closed=state.inactive.filter(t=>message.ids.includes(t.id));state.inactive=state.inactive.filter(t=>!message.ids.includes(t.id));return {ok:true,closed};}
    if(message.type==='restore-closed'){state.inactive.push(...message.items);state.inactive.sort((a,b)=>a.lastActive-b.lastActive);return {ok:true,restored:message.items.length};}
    if(message.type==='settings') state.settings={scope:message.scope,previews:message.previews};
    return {ok:true};
  }};
}
const mock=`(${installPreview.toString()})(${JSON.stringify(items)},${JSON.stringify(inactive)});`;
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/mock.js'){res.setHeader('Content-Type','text/javascript');res.end(mock);return;}
  if(pathname==='/'||pathname==='/popup.html'||pathname==='/inactive.html'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const page=pathname==='/inactive.html'?'inactive':'popup';
    const source=readFileSync(extension+page+'.html','utf8').replace(`<script src="${page}.js"`,`<script src="mock.js"></script><script src="${page}.js"`);
    res.end(source);return;
  }
  const allow={'/popup.css':'text/css','/popup.js':'text/javascript','/inactive.css':'text/css','/inactive.js':'text/javascript','/core.mjs':'text/javascript','/icon128.png':'image/png'};
  if(!allow[pathname]){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',allow[pathname]);res.end(readFileSync(extension+pathname));
});
server.listen(4177,'127.0.0.1',()=>console.log('Fixture preview: http://127.0.0.1:4177'));

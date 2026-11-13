import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../build/Neatab.app/Contents/MacOS/Neatab',import.meta.url));
const child=spawn(path,['--native-host'],{stdio:['pipe','pipe','pipe']});
let bytes=Buffer.alloc(0),messages=[],errors='';
child.stderr.on('data',data=>errors+=data.toString());
child.stdout.on('data',data=>{
  bytes=Buffer.concat([bytes,data]);
  while(bytes.length>=4){const size=bytes.readUInt32LE();if(bytes.length<4+size)break;
    messages.push(JSON.parse(bytes.subarray(4,4+size).toString()));bytes=bytes.subarray(4+size);
  }
});
function frame(message){const json=Buffer.from(JSON.stringify(message));const header=Buffer.alloc(4);header.writeUInt32LE(json.length);return Buffer.concat([header,json]);}
async function until(predicate){const start=Date.now();while(!predicate()){if(Date.now()-start>5000)throw new Error('Host timeout: '+errors);await new Promise(r=>setTimeout(r,10));}}
try{
  await until(()=>messages.some(m=>m.type==='ready'));
  const packet=frame({type:'snapshot',enabled:false,items:[{id:42,windowId:1,title:'中文 · 🪄',url:'https://example.com',preview:null,discarded:false,audible:false}]});
  // Deliberately split both header and Unicode payload across pipe writes.
  child.stdin.write(packet.subarray(0,2));child.stdin.write(packet.subarray(2,packet.length-2));child.stdin.write(packet.subarray(packet.length-2));
  child.stdin.write(frame({type:'ping'}));
  await until(()=>messages.some(m=>m.type==='pong'));
  const pong=messages.find(m=>m.type==='pong');assert.equal(pong.count,1);assert.equal(pong.enabled,false);
  child.stdin.end();
  await new Promise((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(new Error('Exit '+code+': '+errors)));});
  assert.equal(bytes.length,0);
  console.log('Real native host: startup, fragmented JSON, snapshot, reply, clean shutdown passed.');
}catch(error){child.kill();console.error(error);process.exitCode=1;}

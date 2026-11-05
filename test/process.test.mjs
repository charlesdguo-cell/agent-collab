import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAgent} from '../lib/agents.mjs';

test('real MCP stdio process initializes and lists task-scoped tools without inference',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),'mcp'],{stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();
 child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}})+'\n'+JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');
 await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 const messages=output.trim().split('\n').map(JSON.parse);assert.equal(messages[0].result.serverInfo.name,'agent-collab');assert.ok(messages[1].result.tools.some(t=>t.name==='consult_open'));
});
test('subprocess adapter persists exact session and rejects incomplete success even with exit zero',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'collab-process-')),bin=join(dir,'fake-agent');
 try{
  writeFileSync(bin,`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'exact'})+'\\n');process.stdout.write(JSON.stringify({type:'turn.completed'}));});`,{mode:0o755});
  let saved;const r=await runAgent({runtime:'codex',project:dir},'execute','test',{config:{codexBin:bin},onSession:s=>saved=s});assert.equal(saved,'exact');assert.equal(r.session,'exact');
  writeFileSync(bin,`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'thread.started',thread_id:'exact'}));});`,{mode:0o755});
  await assert.rejects(runAgent({runtime:'codex',project:dir},'execute','test',{config:{codexBin:bin}}),/完整成功/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

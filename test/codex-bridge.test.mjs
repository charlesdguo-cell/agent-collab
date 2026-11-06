import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runConversation,unattendedResponse} from '../lib/codex-bridge.mjs';
test('unattended client responses never grant permissions or invent user answers',()=>{
 for(const m of ['item/commandExecution/requestApproval','item/fileChange/requestApproval'])assert.deepEqual(unattendedResponse(m),{decision:'decline'});
 assert.deepEqual(unattendedResponse('item/permissions/requestApproval').permissions,{});
 assert.equal(unattendedResponse('mcpServer/elicitation/request').action,'decline');
 assert.deepEqual(unattendedResponse('item/tool/requestUserInput'),{answers:{}});
 assert.equal(unattendedResponse('item/tool/call').success,false);
 assert.equal(unattendedResponse('unknown/request'),undefined);
});
test('real stdio protocol continues after a declined approval and reports its limitation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'collab-client-'));
 try{
  const bin=join(dir,'fake-codex');writeFileSync(bin,`#!${process.execPath}
import('node:readline').then(({createInterface})=>createInterface({input:process.stdin}).on('line',line=>{
const m=JSON.parse(line),send=x=>console.log(JSON.stringify(x));
if(m.method==='initialize')send({id:m.id,result:{}});
if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'same-thread'}}});
if(m.method==='turn/start'){send({id:m.id,result:{}});send({id:91,method:'item/commandExecution/requestApproval',params:{command:'restricted-command'}});}
if(m.id===91){if(m.result?.decision!=='decline')process.exit(7);send({method:'item/completed',params:{threadId:'same-thread',item:{type:'agentMessage',text:JSON.stringify({reply:'Command not approved; no update performed.',next:null})}}});send({method:'turn/completed',params:{threadId:'same-thread',turn:{status:'completed'}}});}
}));`,{mode:0o755});
  const r=await runConversation({runtime:'codex',project:dir},'conversation','check',{config:{codexBin:bin,timeoutMs:5000}});
  assert.equal(r.completed,true);assert.match(r.text,/no update performed/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('diagnostic Store opens existing state without chmod, migration or writable connection',async()=>{
 const {Store}=await import('../lib/store.mjs');const {statSync,chmodSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'collab-readonly-'));const file=join(dir,'state.sqlite');
 try{let s=new Store(file);s.run('INSERT INTO meta VALUES(?,?)','key','value');s.close();chmodSync(file,0o400);
 const before=statSync(file);s=new Store(file,{readOnly:true});assert.equal(s.one('SELECT value FROM meta WHERE key=?','key').value,'value');assert.throws(()=>s.run('INSERT INTO meta VALUES(?,?)','other','no'));s.close();assert.equal(statSync(file).mode,before.mode);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('new and resumed autonomy turns use the reply/next protocol without semantic confirmations',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'collab-autonomy-protocol-'));
 try {
  const bin=join(dir,'fake-codex');writeFileSync(bin,`#!${process.execPath}
import('node:readline').then(({createInterface})=>createInterface({input:process.stdin}).on('line',line=>{
const m=JSON.parse(line),send=x=>console.log(JSON.stringify(x));
if(m.method==='initialize')send({id:m.id,result:{}});
if(['thread/start','thread/resume'].includes(m.method)){
 if(m.params.sandbox!=='danger-full-access'||m.params.approvalPolicy!=='on-request'||!m.params.developerInstructions.includes('已移除旧版'))process.exit(7);
 if(m.method==='thread/resume'&&m.params.threadId!=='original-thread')process.exit(8);
 send({id:m.id,result:{thread:{id:'original-thread'}}});
}
if(m.method==='turn/start'){
 if(m.params.threadId!=='original-thread'||m.params.outputSchema.properties.confirmation||m.params.outputSchema.required.includes('confirmation'))process.exit(9);
 send({id:m.id,result:{}});
 send({method:'item/completed',params:{threadId:'original-thread',item:{type:'agentMessage',text:JSON.stringify({reply:'Completed',next:null})}}});
 send({method:'turn/completed',params:{threadId:'original-thread',turn:{status:'completed'}}});
}
}));`,{mode:0o755});
  for(const session of [undefined,'original-thread']){
   const result=await runConversation({runtime:'codex',project:dir,session},'conversation','Continue authorized work',{config:{codexBin:bin,executionMode:'owner-autonomy',timeoutMs:5000}});
   assert.equal(result.session,'original-thread');assert.equal(result.completed,true);assert.deepEqual(JSON.parse(result.text),{reply:'Completed',next:null});assert.deepEqual(result.clientRequests,[]);
  }
 } finally{rmSync(dir,{recursive:true,force:true});}
});

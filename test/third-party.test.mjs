import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../lib/store.mjs';
import {Service} from '../lib/service.mjs';
import {decode} from '../lib/conversations.mjs';
const cfg={appId:'cli_test',chatId:'oc_test',owner:'ou_owner',botId:'ou_bot',project:'/tmp',runtime:'codex'};
const event=(text,id,extra={})=>({app:cfg.appId,chat:cfg.chatId,id,sender:'ou_owner',senderType:'user',text,mentioned:true,...extra});
const wire=(exchange,message,extra={})=>'question\n[agent-collab:v1]'+JSON.stringify({exchange,message,inReplyTo:null,to:cfg.botId,kind:'request',expectsReply:true,turn:0,deadline:Date.now()+60000,...extra});
function setup(runner,path=':memory:'){
 const s=new Store(path);let n=0;
 const transport={send:async out=>out.receive_id_type==='open_id'?{messageId:'dm_'+(++n),chatId:'oc_dm'}:'om_'+(++n)};
 const svc=new Service(s,transport,cfg,runner);return {s,svc,transport};
}
test('A to B to third-party C preserves parent and returns substantive final on original exchange',async()=>{
 let round=0;const seen=[];const {s,svc}=setup(async(t,k,p)=>{seen.push(p);return {session:'same',text:JSON.stringify(++round===1?{reply:'',next:{recipient:'ou_third',body:'Please review',channel:'topic'}}:{reply:'C recommends A.',next:null})};});
 const r=svc.receive(event(wire('parent','m1'),'request',{root:'root',sender:'ou_peer',senderType:'app'}));await svc.tick();
 const childOut=s.all('SELECT * FROM outbox').at(-1),child=decode(childOut.body).envelope;
 assert.notEqual(child.exchange,'parent');assert.equal(child.kind,'request');assert.equal(childOut.root,'root');assert.match(childOut.body,/<at user_id="ou_third">/);
 assert.equal(s.one('SELECT peer FROM exchanges WHERE id=?','parent').peer,'ou_peer');
 svc.receive(event(wire(child.exchange,'final',{inReplyTo:child.message,turn:child.turn+1,expectsReply:false,kind:'close'}),'answer',{root:'root',sender:'ou_third',senderType:'app'}));await svc.tick();
 const final=decode(s.all('SELECT * FROM outbox').at(-1).body).envelope;
 assert.equal(final.exchange,'parent');assert.equal(final.to,'ou_peer');assert.equal(final.expectsReply,false);
 assert.match(seen[1],/"terminal":true/);assert.equal(s.task(r.task).session,'same');assert.ok(s.all('SELECT state FROM exchanges').every(x=>x.state==='closed'));s.close();
});
test('plain third-party bot and human answers correlate only to outstanding same-topic request',async()=>{
 for(const senderType of ['app','user']){
  let round=0;const {s,svc}=setup(async()=>({session:'same',text:JSON.stringify(++round===1?{reply:'',next:{recipient:'ou_third',body:'Your opinion?'}}:{reply:'Returned opinion',next:null})}));
  svc.receive(event(wire('parent','m1'),'request',{root:'root',sender:'ou_peer',senderType:'app'}));await svc.tick();
  assert.equal(svc.receive(event('unrelated','other',{root:'different',sender:'ou_third',senderType,mentioned:false})).ignored,'unrelated');
  const request=s.all('SELECT * FROM outbox').at(-1);
  if(senderType==='app')assert.equal(svc.receive(event('old/progress traffic','unquoted',{root:'root',sender:'ou_third',senderType,mentioned:false})).ignored,'unaddressed-bot');
  const response=event('My actual opinion','answer',{root:'root',parent:request.remote,sender:'ou_third',senderType,mentioned:false});
  assert.ok(svc.receive(response).queued);await svc.tick();
  assert.equal(decode(s.all('SELECT * FROM outbox').at(-1).body).envelope.to,'ou_peer');
  const count=s.all('SELECT * FROM jobs').length,duplicate=svc.receive(response);assert.ok(duplicate.duplicate||duplicate.ignored);assert.equal(s.all('SELECT * FROM jobs').length,count);s.close();
 }
});
test('private replies quote delivered request and reversed replies preserve two original sessions after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'collab-private-')),path=join(dir,'state.sqlite');let s,svc;
 try{
  ({s,svc}=setup(async t=>({session:'session-'+t.id,text:JSON.stringify({reply:'',next:{recipient:'ou_person',body:'Opinion for '+t.title,channel:'private'}})}),path));
  const a=svc.receive(event('first','root-a'));await svc.tick();const b=svc.receive(event('second','root-b'));await svc.tick();
  const contacts=s.all('SELECT * FROM conversation_deliveries ORDER BY rowid');assert.equal(contacts.length,2);
  assert.ok(s.all("SELECT * FROM outbox WHERE receive_id_type='open_id'").every(x=>!x.root&&x.chat==='ou_person'));
  s.close();const resumed=[];
  ({s,svc}=setup(async(t,k,p)=>{resumed.push({task:t.id,session:t.session,prompt:p});return {session:t.session,text:JSON.stringify({reply:'Resolved '+t.title,next:null})};},path));
  const response=(d,id,extra={})=>event('Private answer',id,{chat:'oc_dm',chatType:'p2p',parent:d.remote,root:null,sender:'ou_person',mentioned:false,...extra});
  assert.equal(svc.receive(response(contacts[0],'spoof',{sender:'ou_wrong'})).ignored,'unmatched-private-reply');
  assert.equal(svc.receive(response(contacts[0],'wrong-chat',{chat:'oc_another'})).ignored,'unmatched-private-reply');
  assert.equal(svc.receive(response(contacts[0],'no-quote',{parent:null})).ignored,'unmatched-private-reply');
  assert.ok(svc.receive(response(contacts[1],'answer-b')).queued);await svc.tick();
  assert.ok(svc.receive(response(contacts[0],'answer-a')).queued);await svc.tick();
  assert.deepEqual(resumed.map(x=>x.task),[b.task,a.task]);assert.ok(resumed.every(x=>x.session==='session-'+x.task));
  assert.equal(svc.receive(response(contacts[0],'late')).ignored,'unmatched-private-reply');
  const finals=s.all("SELECT * FROM outbox WHERE body LIKE 'Resolved%'");assert.deepEqual(finals.map(x=>x.root),['root-b','root-a']);
 }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});
test('failed private send cannot establish a fictional reply route; cancelled origin stays stopped',async()=>{
 const {s,svc,transport}=setup(async()=>({session:'s',text:JSON.stringify({reply:'',next:{recipient:'ou_person',body:'review',channel:'private'}})}));
 transport.send=async out=>{if(out.receive_id_type==='open_id')throw Error('offline');return 'ack';};
 const r=svc.receive(event('ask','root'));await svc.tick();await svc.flush();
 const d=s.one('SELECT * FROM conversation_deliveries');assert.equal(d.remote,null);
 assert.equal(svc.receive(event('answer','bad',{chat:'oc_dm',chatType:'p2p',parent:'nonexistent',sender:'ou_person'})).ignored,'unmatched-private-reply');
 transport.send=async()=>({messageId:'delivered',chatId:'oc_dm'});s.run("UPDATE outbox SET state='pending' WHERE id=?",d.outbox);await svc.flush();
 s.run("UPDATE tasks SET state='cancelled' WHERE id=?",r.task);
 const reply=svc.receive(event('answer','stopped',{chat:'oc_dm',chatType:'p2p',parent:'delivered',sender:'ou_person'}));assert.equal(reply.blocked,'cancelled');assert.equal(s.task(r.task).state,'cancelled');s.close();
});
test('child handoff inherits exhausted turn budget and deadline instead of resetting them',async()=>{
 const {s,svc}=setup(async()=>({session:'s',text:JSON.stringify({reply:'',next:{recipient:'ou_third',body:'forward'}})}));
 svc.receive(event(wire('parent','m',{turn:6}),'request',{root:'root',sender:'ou_peer',senderType:'app'}));await svc.tick();
 const parent=s.one('SELECT * FROM exchanges WHERE id=?','parent'),child=s.one('SELECT * FROM exchanges WHERE id<>?','parent');
 assert.equal(child.deadline,parent.deadline);assert.equal(child.turn,7);
 // A budget-exhausted child cannot return another automatic request.
 const result=svc.receive(event(wire(child.id,'more',{inReplyTo:child.last_sent,turn:8}),'budget',{root:'root',sender:'ou_third',senderType:'app'}));
 assert.equal(result.closed,true);assert.equal(s.all('SELECT * FROM jobs').length,1);assert.ok(s.all('SELECT state FROM exchanges').every(x=>x.state==='closed'));s.close();
});
test('private transport uses open_id and never replies under original group root',async()=>{
 const {Feishu}=await import('../lib/feishu.mjs');const f=new Feishu({...cfg,appSecret:'fake-test-secret'});let request;
 f.client={im:{message:{create:async r=>{request=r;return {code:0,data:{message_id:'dm',chat_id:'oc_dm'}};},reply:async()=>{throw Error('must not reply');}}}};
 const result=await f.send({id:'uuid',chat:'ou_person',root:null,body:'Question',receive_id_type:'open_id'});
 assert.equal(request.params.receive_id_type,'open_id');assert.equal(request.data.receive_id,'ou_person');assert.deepEqual(result,{messageId:'dm',chatId:'oc_dm'});
});
test('stale private quote and group-channel reply cannot close a newer private request',async()=>{
 let round=0;const {s,svc}=setup(async()=>({session:'same',text:JSON.stringify({reply:'',next:{recipient:'ou_person',body:'Question '+(++round),channel:'private'}})}));
 svc.receive(event('ask','root'));await svc.tick();let out=s.all("SELECT * FROM outbox WHERE receive_id_type='open_id'").at(-1),w=decode(out.body).envelope;
 const firstRemote=out.remote;
 const response=wire(w.exchange,'answer',{kind:'reply',inReplyTo:w.message,turn:w.turn+1});
 assert.equal(svc.receive(event(response,'wrong-channel',{root:'root',sender:'ou_person',senderType:'app'})).ignored,'delivery-mismatch');
 assert.ok(svc.receive(event(response,'dm-answer',{chat:'oc_dm',chatType:'p2p',parent:out.remote,sender:'ou_person',senderType:'app'})).queued);
 assert.equal(svc.receive(event('duplicate before next question','consumed',{chat:'oc_dm',chatType:'p2p',parent:out.remote,sender:'ou_person'})).ignored,'unmatched-private-reply');await svc.tick();
 const stale=svc.receive(event('late answer','stale',{chat:'oc_dm',chatType:'p2p',parent:firstRemote,sender:'ou_person'}));assert.equal(stale.ignored,'unmatched-private-reply');
 out=s.all("SELECT * FROM outbox WHERE receive_id_type='open_id'").at(-1);
 assert.ok(svc.receive(event('new answer','fresh',{chat:'oc_dm',chatType:'p2p',parent:out.remote,sender:'ou_person'})).queued);s.close();
});
test('private replay checkpoint starts at delivered request, not restart time',async()=>{
 const {s,svc,transport}=setup(async()=>({session:'s',text:JSON.stringify({reply:'',next:{recipient:'ou_person',body:'Question',channel:'private'}})}));
 svc.receive(event('ask','root'));await svc.tick();
 const checkpoint=Number(s.one("SELECT value FROM meta WHERE key='sync:dm:oc_dm'").value);
 // Simulate a much older delivery checkpoint and a later first reconciliation.
 s.run("UPDATE meta SET value=? WHERE key='sync:dm:oc_dm'",String(checkpoint-3600));
 const starts=[];transport.replay=async(container,type,start)=>{starts.push({container,start});return {items:[],complete:true};};
 transport.thread=async()=>null;await svc.reconcile();assert.equal(starts.find(x=>x.container==='oc_dm').start,checkpoint-3602);s.close();
});
test('nested clarification closes third party then resumes every waiting ancestor',async()=>{
 let round=0;const {s,svc}=setup(async()=>({session:'same',text:JSON.stringify(++round===1?{reply:'',next:{recipient:'ou_c',body:'Consult C'}}:round===2?{reply:'',next:{recipient:'ou_d',body:'Clarify with D'}}:{reply:'Substantive final '+round,next:null})}));
 svc.receive(event(wire('parent-a','a1'),'a-in',{root:'root',sender:'ou_a',senderType:'app'}));await svc.tick();
 let w=decode(s.all('SELECT * FROM outbox').at(-1).body).envelope;
 svc.receive(event(wire(w.exchange,'c1',{kind:'reply',inReplyTo:w.message,turn:w.turn+1}),'c-in',{root:'root',sender:'ou_c',senderType:'app'}));await svc.tick();
 w=decode(s.all('SELECT * FROM outbox').at(-1).body).envelope;
 svc.receive(event(wire(w.exchange,'d1',{kind:'close',inReplyTo:w.message,turn:w.turn+1,expectsReply:false}),'d-in',{root:'root',sender:'ou_d',senderType:'app'}));await svc.tick();
 const cFinal=decode(s.all('SELECT * FROM outbox').at(-1).body).envelope;assert.equal(cFinal.to,'ou_c');
 await svc.tick();const aFinal=decode(s.all('SELECT * FROM outbox').at(-1).body).envelope;assert.equal(aFinal.to,'ou_a');assert.equal(aFinal.exchange,'parent-a');
 assert.equal(round,4);assert.ok(s.all('SELECT state FROM exchanges').every(x=>x.state==='closed'));s.close();
});

test('late private final survives restart and resumes expired parent without another question',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'collab-late-')),path=join(dir,'state.sqlite');let s,svc;
 try{
  ({s,svc}=setup(async()=>({session:'persistent',text:JSON.stringify({reply:'',next:{recipient:'ou_person',body:'Research',channel:'private'}})}),path));
  svc.receive(event(wire('parent','m1'),'request',{root:'root',sender:'ou_peer',senderType:'app'}));await svc.tick();
  const d=s.one('SELECT * FROM conversation_deliveries');s.run("UPDATE exchanges SET deadline=?,state='awaiting_final' WHERE id<>?",Date.now()-1,'parent');s.run('UPDATE exchanges SET deadline=? WHERE id=?',Date.now()-1,'parent');s.close();
  let calls=0;({s,svc}=setup(async t=>{calls++;assert.equal(t.session,'persistent');return {session:t.session,text:JSON.stringify({reply:'Complete researched answer',next:null})};},path));
  const response=event('Research findings','late-private',{chat:'oc_dm',chatType:'p2p',parent:d.remote,root:null,sender:'ou_person',mentioned:false});
  assert.ok(svc.receive(response).queued);await svc.tick();assert.equal(calls,1);
  const out=s.all('SELECT * FROM outbox').at(-1),envelope=decode(out.body).envelope;
  assert.equal(out.root,'root');assert.equal(envelope.exchange,'parent');assert.equal(envelope.expectsReply,false);assert.match(out.body,/Complete researched answer/);
  assert.equal(svc.receive({...response,id:'duplicate-copy'}).ignored,'unmatched-private-reply');s.close();s=null;
 }finally{s?.close();rmSync(dir,{recursive:true,force:true});}
});

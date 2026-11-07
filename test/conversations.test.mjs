import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../lib/store.mjs';
import {Service} from '../lib/service.mjs';
import {decode,EXCHANGE_TTL_MS} from '../lib/conversations.mjs';
const cfg={appId:'cli_test',chatId:'oc_test',owner:'ou_owner',botId:'ou_bot',project:'/tmp',runtime:'codex'};
const event=(text,id,extra={})=>({app:cfg.appId,chat:cfg.chatId,id,sender:'ou_owner',senderType:'user',text,mentioned:true,...extra});
function fixture(runner){const s=new Store(':memory:');let n=0;const svc=new Service(s,{send:async()=>`om_out_${++n}`},cfg,runner|| (async t=>({session:t.session||'s-'+t.id,text:JSON.stringify({reply:'answer',next:null})})));return {s,svc};}
test('ordinary mentions, colleague followups and parent-only quotes share one session',async()=>{
 const calls=[];const {s,svc}=fixture(async t=>{calls.push(t.session);return {session:'persistent',text:JSON.stringify({reply:'answer',next:null})};});
 const first=svc.receive(event('Why?', 'om_root'));await svc.tick();
 const answer=s.all("SELECT * FROM outbox WHERE state='sent'").at(-1);
 const follow=svc.receive(event('Continue','om_follow',{root:null,parent:answer.remote,sender:'ou_colleague',mentioned:false}));assert.equal(follow.task,first.task);await svc.tick();
 assert.deepEqual(calls,[null,'persistent']);assert.ok(s.all('SELECT * FROM outbox').every(x=>x.root==='om_root'));s.close();
});
test('parallel topics do not block each other; same session remains serial',async()=>{
 let unblock;const calls=[];const {s,svc}=fixture(async t=>{calls.push(t.id);if(t.title==='slow'&&calls.length===1)await new Promise(r=>unblock=r);return {session:'s-'+t.id,text:JSON.stringify({reply:'done',next:null})};});
 const a=svc.receive(event('slow','a'));const running=svc.tick();await new Promise(r=>setImmediate(r));
 svc.receive(event('more','a2',{root:'a'}));const b=svc.receive(event('fast','b'));await svc.tick();assert.deepEqual(calls,[a.task,b.task]);unblock();await running;await svc.tick();assert.deepEqual(calls,[a.task,b.task,a.task]);s.close();
});
function wire(id,message,kind='request',extra={}){return 'question\n[agent-collab:v1]'+JSON.stringify({exchange:id,message,inReplyTo:null,to:'ou_bot',kind,expectsReply:true,turn:0,deadline:Date.now()+60000,...extra});}
test('AI final closes one exchange; duplicates and late responses do not wake agent; new exchange works',async()=>{
 const {s,svc}=fixture();const e=event(wire('x','m1'),'bot1',{sender:'ou_peer',senderType:'app',root:'topic'});
 assert.ok(svc.receive(e).queued);await svc.tick();const final=s.all('SELECT * FROM outbox').at(-1);assert.equal(decode(final.body).envelope.expectsReply,false);
 assert.ok(svc.receive(e).duplicate);assert.equal(svc.receive({...e,id:'late',text:wire('x','m2')}).ignored,'closed-or-mismatched-exchange');
 assert.ok(svc.receive({...e,id:'new',text:wire('new','m3')}).queued);assert.equal(s.all('SELECT * FROM tasks').length,1);s.close();
});
test('AI replies require exact outstanding request and authenticated peer',async()=>{
 const {s,svc}=fixture(async t=>({session:'s',text:JSON.stringify({reply:'',next:{recipient:'ou_peer',body:'Please review A'}})}));
 svc.receive(event('ask peer','root'));await svc.tick();const out=decode(s.all('SELECT * FROM outbox').at(-1).body).envelope;
 const response=event(wire(out.exchange,'response','reply',{inReplyTo:out.message,turn:out.turn+1,expectsReply:false}),'received',{root:'root',sender:'ou_peer',senderType:'app'});
 assert.equal(svc.receive({...response,id:'bad',sender:'ou_other'}).ignored,'closed-or-mismatched-exchange');
 assert.equal(svc.receive(response).closed,true);assert.equal(s.all('SELECT * FROM jobs').length,2);assert.equal(JSON.parse(s.all('SELECT * FROM jobs').at(-1).input).terminal,true);assert.equal(svc.receive({...response,id:'again'}).ignored,'closed-or-mismatched-exchange');s.close();
});
test('receipts, unaddressed bots, own echo, and malformed metadata never trigger inference',()=>{
 const {s,svc}=fixture();for(const e of [event(wire('x','m','receipt'),'a',{sender:'ou_peer',senderType:'app'}),event('hello','b',{sender:'ou_peer',senderType:'app',mentioned:false}),event(wire('x','m'),'c',{sender:'ou_bot',senderType:'app'}),event('bad\n[agent-collab:v1]{}','d',{sender:'ou_peer',senderType:'app'})])assert.ok(svc.receive(e).ignored);assert.equal(s.all('SELECT * FROM jobs').length,0);s.close();
});
test('group role updates keep source and group isolation; role text is not owner authority',()=>{
 const {s,svc}=fixture();svc.receive(event('/role frontend','role',{sender:'ou_peer'}));svc.receive(event('/role backend','role2',{sender:'ou_peer'}));
 const roles=svc.conversations.roles();assert.equal(roles.length,1);assert.equal(roles[0].source,'role2');assert.equal(roles[0].body,'backend');
 svc.receive(event('/role admin','other',{chat:'oc_other',sender:'ou_peer'}));assert.equal(svc.conversations.roles()[0].body,'backend');assert.equal(svc.receive(event('切换项目：/tmp','change',{sender:'ou_peer'})).rejected,'owner-only');s.close();
});
test('failure notification stays in the original topic',async()=>{const {s,svc}=fixture(async()=>{throw Error('test failure');});svc.receive(event('test','root'));await svc.tick();assert.equal(s.all('SELECT * FROM outbox').at(-1).root,'root');s.close();});
test('official receive_v1 bot sender type is admitted as bot, not human',async()=>{
 const {normalize}=await import('../lib/feishu.mjs');
 const e=normalize(cfg.appId,{sender:{sender_type:'bot',sender_id:{open_id:'ou_peer'}},message:{message_type:'text',message_id:'platform-bot',chat_id:cfg.chatId,content:JSON.stringify({text:'@_user_1 '+wire('official','id')}),mentions:[{key:'@_user_1',id:{open_id:cfg.botId},mentioned_type:'bot'}]}},cfg.botId);
 const {s,svc}=fixture();assert.equal(e.senderType,'app');assert.ok(svc.receive(e).queued);s.close();
});
test('ended AI request resumes local dependent work once without a bot ping',async()=>{
 let round=0;const {s,svc}=fixture(async()=>({session:'same',text:JSON.stringify(++round===1?{reply:'',next:{recipient:'ou_peer',body:'choose A or B'}}:{reply:'Applied the agreed choice.',next:null})}));
 svc.receive(event('please ask','root'));await svc.tick();const w=decode(s.all('SELECT * FROM outbox').at(-1).body).envelope;
 svc.receive(event(wire(w.exchange,'final','close',{inReplyTo:w.message,turn:w.turn+1,expectsReply:false}),'final-in',{root:'root',sender:'ou_peer',senderType:'app'}));await svc.tick();
 assert.equal(round,2);assert.equal(decode(s.all('SELECT * FROM outbox').at(-1).body).envelope,null);s.close();
});
test('pause in a conversational topic stops only that topic',()=>{const {s,svc}=fixture();const a=svc.receive(event('task','root'));svc.receive(event('暂停这个任务','pause',{root:'root'}));assert.equal(s.task(a.task).state,'paused');assert.equal(s.claimJob(),undefined);s.close();});
test('receiver-local platform mention wins over sender-local bot alias',()=>{
 const {s,svc}=fixture();
 const e=event(wire('alias','m','request',{to:'ou_other_app_alias'}),'alias-in',{sender:'ou_peer',senderType:'app',mentioned:true,root:'alias-root'});
 assert.ok(svc.receive(e).queued);
 assert.equal(svc.receive({...e,id:'not-mentioned',mentioned:false,text:wire('another','m')}).ignored,'unaddressed-bot');s.close();
});
test('first mention receives bounded original topic context without changing sender identity',async()=>{
 let prompt;const {s,svc}=fixture(async(t,k,p)=>{prompt=p;return {session:'s',text:JSON.stringify({reply:'answer',next:null})};});
 const reads=[];svc.transport.topicContext=async root=>{reads.push(root);return {available:true,items:[{id:root,text:'Original design question'}]};};
 svc.receive(event('what about this?','mention',{root:'old-root'}));await svc.tick();
 assert.deepEqual(reads,['old-root']);assert.match(prompt,/Original design question/);assert.match(prompt,/ou_owner/);
 svc.receive(event('continue','follow',{root:'old-root'}));await svc.tick();assert.equal(reads.length,1);s.close();
});
test('Codex new-task wording uses conversational bridge; reviewed resume keeps same session',async()=>{
 const {s,svc}=fixture();const r=svc.receive(event('新任务：implement feature','new-root'));await svc.tick();
 assert.equal(s.all('SELECT * FROM jobs')[0].kind,'conversation');const session=s.task(r.task).session;
 svc.receive(event('暂停这个任务','p',{root:'new-root'}));assert.equal(s.task(r.task).state,'paused');
 assert.equal(svc.receive(event('已核对，继续这个任务','bad',{root:'new-root',sender:'ou_other'})).rejected,'owner-only');
 assert.ok(svc.receive(event('已核对，继续这个任务','r',{root:'new-root'})).queued);await svc.tick();assert.equal(s.task(r.task).session,session);
 svc.receive(event('取消这个任务','c',{root:'new-root'}));assert.equal(svc.receive(event('已核对，继续这个任务','r2',{root:'new-root'})).rejected,'not-resumable');s.close();
});
test('history app_id cannot masquerade as receiver-local bot open_id',()=>{
 const {s,svc}=fixture();const r=svc.receive(event(wire('history','m'),'hist',{sender:'cli_sender',senderType:'app'}));assert.equal(r.ignored,'unresolved-platform-sender');assert.equal(s.all('SELECT * FROM jobs').length,0);s.close();
});
test('topic read retains original message and marks missing reply permission as partial',async()=>{
 const {Feishu}=await import('../lib/feishu.mjs');const f=new Feishu({...cfg,appSecret:'fake-test-secret'});
 f.client={im:{message:{get:async()=>({code:0,data:{items:[{message_id:'root',thread_id:'thread',msg_type:'text',body:{content:JSON.stringify({text:'original'})}}]}}),list:async()=>{throw Error('missing history scope');}}}};
 const r=await f.topicContext('root');assert.equal(r.available,true);assert.equal(r.partial,true);assert.equal(r.items[0].text,'original');
});
test('unsupported conversation runtime never silently launches Codex',async()=>{
 const {runConversation}=await import('../lib/codex-bridge.mjs');await assert.rejects(runConversation({runtime:'claude'},'conversation','test'),/仅支持 Codex/);
});
test('local Codex starts only after real root delivery, retries deduplicate and followups keep session',async()=>{
 const {s,svc}=fixture();const topics=svc.conversations;
 const a=topics.localStart({requestId:'local-1',title:'Discuss',request:'Compare A and B'});
 assert.equal(a.root,null);assert.equal(s.all('SELECT * FROM jobs').length,0);
 assert.equal(topics.localStart({requestId:'local-1',request:'Compare A and B'}).task,a.task);
 await svc.tick();const first=topics.localStatus(a.task);assert.equal(first.root,'om_out_1');assert.equal(first.jobs.length,1);assert.equal(first.jobs[0].state,'done');
 const session=s.task(a.task).session;
 topics.localFollow({task:a.task,requestId:'follow-1',request:'Explain the tradeoff'});
 topics.localFollow({task:a.task,requestId:'follow-1',request:'Explain the tradeoff'});
 await svc.tick();assert.equal(s.task(a.task).session,session);assert.equal(topics.localStatus(a.task).jobs.length,2);
 assert.throws(()=>topics.localFollow({task:a.task,requestId:'follow-1',request:'different'}),/已用于/);
 assert.ok(s.all('SELECT * FROM outbox').slice(1).every(x=>x.root==='om_out_1'));s.close();
});
test('failed local root delivery never triggers model or creates a fictional topic',async()=>{
 const {s,svc}=fixture();svc.transport.send=async()=>{throw Error('unavailable');};
 const a=svc.conversations.localStart({requestId:'offline',request:'test'});await svc.tick();await svc.tick();
 const result=svc.conversations.localStatus(a.task);assert.equal(result.root,null);assert.equal(result.delivery.state,'failed');assert.equal(result.jobs.length,0);s.close();
});

test('final arriving beyond the exchange deadline resumes original session exactly once',async()=>{
 let round=0;const sessions=[];const {s,svc}=fixture(async t=>{sessions.push(t.session);return {session:'persistent',text:JSON.stringify(++round===1?{reply:'',next:{recipient:'ou_peer',body:'Research this'}}:{reply:'Research report delivered',next:null})};});
 const started=svc.receive(event('research','late-root'));await svc.tick();
 const w=decode(s.all('SELECT * FROM outbox').at(-1).body).envelope;
 s.run('UPDATE exchanges SET deadline=? WHERE id=?',Date.now()-1,w.exchange);
 const reply=event(wire(w.exchange,'late-final','close',{inReplyTo:w.message,turn:8,expectsReply:false,deadline:Date.now()-1}),'late-final-event',{root:'late-root',sender:'ou_peer',senderType:'app'});
 assert.ok(svc.receive(reply).queued);assert.ok(svc.receive(reply).duplicate);
 assert.equal(svc.receive({...reply,id:'late-final-copy'}).ignored,'closed-or-mismatched-exchange');
 await svc.tick();assert.equal(round,2);assert.deepEqual(sessions,[null,'persistent']);
 assert.equal(s.all('SELECT * FROM jobs').length,2);assert.equal(s.task(started.task).session,'persistent');
 const final=s.all('SELECT * FROM outbox').at(-1);assert.equal(final.body,'Research report delivered');assert.equal(final.root,'late-root');s.close();
});
test('expired follow-up cannot continue dialogue but a later exact final is still accepted',async()=>{
 const {s,svc}=fixture(async()=>({session:'s',text:JSON.stringify({reply:'',next:{recipient:'ou_peer',body:'Research'}})}));
 svc.receive(event('ask','root'));await svc.tick();const w=decode(s.all('SELECT * FROM outbox').at(-1).body).envelope;
 s.run('UPDATE exchanges SET deadline=? WHERE id=?',Date.now()-1,w.exchange);
 const make=(id,extra={})=>event(wire(w.exchange,id,'reply',{inReplyTo:w.message,turn:w.turn+1,deadline:Date.now()-1,...extra}),id,{root:'root',sender:'ou_peer',senderType:'app'});
 assert.equal(svc.receive(make('more')).reason,'deadline-awaiting-final');assert.equal(s.all('SELECT * FROM jobs').length,1);
 assert.equal(s.one('SELECT state FROM exchanges WHERE id=?',w.exchange).state,'awaiting_final');
 assert.equal(svc.receive({...make('wrong'),sender:'ou_other'}).ignored,'closed-or-mismatched-exchange');
 assert.equal(svc.receive(make('stale',{inReplyTo:'not-the-request',expectsReply:false})).ignored,'unmatched-reply');
 assert.ok(svc.receive(make('final',{kind:'close',expectsReply:false})).queued);s.close();
});
test('late finals never reactivate cancelled, paused, uncertain or failed tasks',async()=>{
 for(const state of ['cancelled','paused','uncertain','failed']){
  const {s,svc}=fixture(async()=>({session:'s',text:JSON.stringify({reply:'',next:{recipient:'ou_peer',body:'Research'}})}));
  const r=svc.receive(event('ask','root'));await svc.tick();const w=decode(s.all('SELECT * FROM outbox').at(-1).body).envelope;
  s.run('UPDATE exchanges SET deadline=? WHERE id=?',Date.now()-1,w.exchange);s.run('UPDATE tasks SET state=? WHERE id=?',state,r.task);
  const received=svc.receive(event(wire(w.exchange,'final','close',{inReplyTo:w.message,turn:w.turn+1,expectsReply:false,deadline:Date.now()-1}),'final',{root:'root',sender:'ou_peer',senderType:'app'}));
  assert.equal(received.blocked,state);assert.equal(s.all('SELECT * FROM jobs').length,1);assert.equal(s.task(r.task).state,state);s.close();
 }
});

test('history app_id alias of an already recorded bot result cannot poison replay checkpoint',async()=>{
 const {s,svc}=fixture();svc.receive(event(wire('x','m'),'already-recorded',{sender:'ou_peer',senderType:'app',root:'root'}));await svc.tick();
 s.run("INSERT OR REPLACE INTO meta VALUES('sync:error','old identity gap')");
 svc.transport.thread=async()=>null;
 svc.transport.replay=async()=>({complete:true,items:[{message_id:'already-recorded',sender:{id:'cli_peer'}}]});
 svc.transport.fromHistory=()=>{throw Error('Known platform id must deduplicate before identity resolution');};
 const jobs=s.all('SELECT * FROM jobs').length;await svc.reconcile();
 assert.equal(s.one("SELECT value FROM meta WHERE key='sync:error'"),undefined);assert.equal(s.all('SELECT * FROM jobs').length,jobs);s.close();
});
test('unseen history app_id still blocks replay instead of guessing bot identity',async()=>{
 const {s,svc}=fixture();s.run("UPDATE meta SET value='1' WHERE key='sync:group'");svc.transport.thread=async()=>null;
 svc.transport.replay=async()=>({complete:true,items:[{message_id:'unseen'}]});svc.transport.fromHistory=()=>event(wire('x','m'),'unseen',{sender:'cli_peer',senderType:'app'});
 await svc.reconcile();assert.match(s.one("SELECT value FROM meta WHERE key='sync:error'").value,/历史 bot/);assert.equal(s.one("SELECT value FROM meta WHERE key='sync:group'").value,'1');assert.equal(s.all('SELECT * FROM jobs').length,0);s.close();
});

 test('new requests last 30 days; half-day offline requests and long-deadline replies are accepted',async()=>{
 const {s,svc}=fixture(async()=>({session:'month-session',text:JSON.stringify({reply:'',next:{recipient:'ou_peer',body:'review'}})}));
 const before=Date.now();svc.receive(event('ask','month-root'));await svc.tick();
 const w=decode(s.all('SELECT * FROM outbox').at(-1).body).envelope;
 assert.equal(EXCHANGE_TTL_MS,30*24*60*60*1000);
 assert.ok(w.deadline>=before+EXCHANGE_TTL_MS&&w.deadline<=Date.now()+EXCHANGE_TTL_MS);
 const response=event(wire(w.exchange,'month-response','reply',{inReplyTo:w.message,turn:w.turn+1,deadline:w.deadline}),'month-response',{root:'month-root',sender:'ou_peer',senderType:'app'});
 assert.ok(svc.receive(response).queued);
 const remaining=EXCHANGE_TTL_MS-12*60*60*1000;
 assert.ok(svc.receive(event(wire('offline','offline-request','request',{deadline:Date.now()+remaining}),'offline-request',{root:'offline-root',sender:'ou_peer',senderType:'app'})).queued);
 assert.ok(s.one("SELECT deadline FROM exchanges WHERE id='offline'").deadline>Date.now()+remaining-1000);
 assert.equal(svc.receive(event(wire('expired-month','expired','request',{deadline:Date.now()-1}),'expired-month',{root:'expired-root',sender:'ou_peer',senderType:'app'})).ignored,'expired');
 s.close();
 });

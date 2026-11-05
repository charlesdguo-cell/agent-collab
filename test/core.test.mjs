import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../lib/store.mjs';
import {Service} from '../lib/service.mjs';
import {invocation,parseAgentEvent} from '../lib/agents.mjs';
import {startTaskApi} from '../lib/local-api.mjs';
import {normalize} from '../lib/feishu.mjs';
const config={appId:'cli_test',chatId:'oc_test',owner:'ou_owner',botId:'ou_bot'};
function fixture(path=':memory:'){
 const s=new Store(path),t=s.createTask({title:'Login',project:'/tmp',runtime:'codex',owner:'ou_owner'});
 s.run('UPDATE tasks SET session=? WHERE id=?','session-exact',t.id);
 const c=s.open({task:t.id,app:config.appId,chat:config.chatId,approver:'ou_decider',proposal:'Option A'});
 const out=s.one('SELECT id FROM outbox');s.delivered(out.id,'om_root',config.appId);
 return {s,t,c,event:(text,id='om_in',sender='ou_decider')=>({app:config.appId,chat:config.chatId,id,root:'om_root',sender,senderType:'user',text})};
}
test('thread resolves exact task; duplicate replies enqueue once',()=>{
 const {s,t,event}=fixture();assert.equal(s.ingest(event('why A?'),config.owner).task,t.id);assert.equal(s.ingest(event('why A?'),config.owner).duplicate,true);assert.equal(s.all('SELECT * FROM jobs').length,1);s.close();
});
test('same root in another app or chat never routes',()=>{
 const {s,event}=fixture();assert.equal(s.resolve({...event('x'),app:'cli_other'}),null);assert.equal(s.resolve({...event('x'),chat:'oc_other'}),null);s.close();
});
test('quoted bot reply resolves consult',()=>{
 const {s,c,event}=fixture();const id=s.send(config.chatId,'om_root','answer');s.delivered(id,'om_answer',config.appId);
 assert.equal(s.resolve({...event('next'),root:null,parent:'om_answer'}).id,c.id);s.close();
});
test('approval needs designated sender, exact version and correct thread',()=>{
 const {s,c,event}=fixture();assert.match(s.ingest(event(`/approve ${c.id} 1`,'a','ou_stranger'),config.owner).rejected,/负责人/);
 s.revise(c.id,'Option B');assert.match(s.ingest(event(`/approve ${c.id} 1`,'b'),config.owner).rejected,/版本/);
 assert.match(s.ingest({...event(`/approve ${c.id} 2`,'c'),root:null},config.owner).rejected,/话题/);
 assert.equal(s.ingest(event(`/approve ${c.id} 2`,'d'),config.owner).approved,true);assert.equal(s.all("SELECT * FROM jobs WHERE kind='execute'").length,1);s.close();
});
test('cancelled task cannot be resumed by late approval',()=>{
 const {s,t,c,event}=fixture();s.ingest(event(`/cancel ${t.id}`,'cancel','ou_owner'),config.owner);
 assert.ok(s.ingest(event(`/approve ${c.id} 1`,'late'),config.owner).rejected);assert.equal(s.task(t.id).state,'cancelled');assert.equal(s.claimJob(),undefined);s.close();
});
test('teammate cannot cancel owner task',()=>{
 const {s,t,event}=fixture();assert.ok(s.ingest(event(`/cancel ${t.id}`),config.owner).rejected);assert.equal(s.task(t.id).state,'waiting');s.close();
});
test('multiple blockers must all approve before execution',()=>{
 const {s,t,c,event}=fixture();const c2=s.open({task:t.id,app:config.appId,chat:config.chatId,approver:'ou_decider',proposal:'B'});
 const out=s.one("SELECT id FROM outbox WHERE consult=?",c2.id);s.delivered(out.id,'om_root2',config.appId);
 s.ingest(event(`/approve ${c.id} 1`,'a'),config.owner);assert.equal(s.claimJob(),undefined);
 s.ingest({...event(`/approve ${c2.id} 1`,'b'),root:'om_root2'},config.owner);assert.equal(s.claimJob().kind,'execute');s.close();
});
test('discussion processing blocks concurrent approval and session write',()=>{
 const {s,c,event}=fixture();s.ingest(event('why'),config.owner);const job=s.claimJob();assert.ok(job);assert.equal(s.claimJob(),undefined);
 assert.match(s.ingest(event(`/approve ${c.id} 1`,'approve'),config.owner).rejected,/正在处理/);s.close();
});
test('restart preserves waiting and dedup ledger',()=>{
 const dir=mkdtempSync(join(tmpdir(),'collab-')),path=join(dir,'db');const {s,t,event}=fixture(path);s.ingest(event('question'),config.owner);s.close();
 const s2=new Store(path);assert.equal(s2.task(t.id).session,'session-exact');assert.equal(s2.ingest(event('question'),config.owner).duplicate,true);assert.equal(s2.claimJob().kind,'discuss');s2.close();rmSync(dir,{recursive:true});
});
test('crash during execution is uncertain, never silently replayed',()=>{
 const {s,t,c,event}=fixture();s.ingest(event(`/approve ${c.id} 1`),config.owner);s.claimJob();assert.equal(s.recover(),1);assert.equal(s.task(t.id).state,'uncertain');assert.equal(s.claimJob(),undefined);s.close();
});
test('bot messages ignored to prevent feedback loops',()=>{
 const {s,event}=fixture();assert.equal(s.ingest({...event('hello'),senderType:'app'},config.owner).ignored,'bot');assert.equal(s.all('SELECT * FROM jobs').length,0);s.close();
});
test('failed outbox retries twice with same id then stops',async()=>{
 const {s}=fixture();const id=s.send(config.chatId,'om_root','test');const ids=[];
 const svc=new Service(s,{send:async o=>{ids.push(o.id);throw Error('network');}},config);
 await svc.flush();await svc.flush();await svc.flush();assert.deepEqual(ids,[id,id]);assert.equal(s.one('SELECT state FROM outbox WHERE id=?',id).state,'failed');s.close();
});
test('simulated three-round discussion resumes original session then executes once',async()=>{
 const {s,t,c,event}=fixture();const calls=[];let serial=0;
 const svc=new Service(s,{send:async()=>`om_out_${++serial}`},config,async(task,kind,prompt)=>{calls.push({session:task.session,kind});return {session:task.session,text:kind==='discuss'?JSON.stringify({reply:'simulated answer',proposal:'Option A'}):'verified simulated answer',completed:true};});
 for(let i=0;i<3;i++){svc.receive(event('question '+i,'q'+i));await svc.tick();}
 svc.receive(event(`/approve ${c.id} 1`,'approved'));await svc.tick();await svc.tick();
 assert.deepEqual(calls.map(c=>c.kind),['discuss','discuss','discuss','execute']);assert.ok(calls.every(c=>c.session==='session-exact'));assert.equal(s.task(t.id).state,'done');s.close();
});
test('consultation API scopes a token to one task and rejects browser origin',async()=>{
 const {s,t,c}=fixture();const api=await startTaskApi(s,config),key=api.issue(t.id);
 const post=(body,secret=key,extra={})=>fetch(api.url+'/consult/revise',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret,...extra},body:JSON.stringify(body)});
 try{
  assert.equal((await post({id:c.id,proposal:'B'})).status,200);
  assert.equal((await post({id:c.id,proposal:'C'},'wrong')).status,400);
  assert.equal((await post({id:c.id,proposal:'C'},key,{Origin:'http://evil.test'})).status,400);
  const t2=s.createTask({title:'Other',project:'/tmp',runtime:'claude',owner:'ou_owner'});
  const c2=s.open({task:t2.id,app:config.appId,chat:config.chatId,approver:'ou_decider',proposal:'Z'});
  assert.equal((await post({id:c2.id,proposal:'hack'})).status,400);
  api.revoke(key);assert.equal((await post({id:c.id,proposal:'D'})).status,400);
 }finally{await new Promise(r=>api.server.close(r));s.close();}
});
test('runtime adapters target exact session and never use bypass permissions',()=>{
 for(const runtime of ['codex','claude'])for(const kind of ['discuss','execute']){
  const x=invocation({runtime,session:'specific'},kind);assert.ok(x.args.includes('specific'));assert.ok(!x.args.includes('--last'));assert.ok(!x.args.includes('--continue'));assert.ok(!x.args.some(a=>a.includes('dangerously')));
 }
 assert.ok(invocation({runtime:'codex',session:'s'},'discuss').args.includes('sandbox_mode="read-only"'));
 const discussion=invocation({runtime:'codex'},'discuss').args;
 // Codex validates transport even when an MCP server is disabled.
 assert.ok(discussion.includes('mcp_servers.team_consult.enabled=false'));
 assert.ok(discussion.some(a=>a.startsWith('mcp_servers.team_consult.command=')));
 assert.ok(discussion.some(a=>a.startsWith('mcp_servers.team_consult.args=')));
 const execution=invocation({runtime:'codex'},'execute').args;
 assert.ok(execution.includes('mcp_servers.team_consult.enabled_tools=["consult_open","consult_revise","consult_status"]'));
 assert.ok(execution.includes('mcp_servers.team_consult.default_tools_approval_mode="prompt"'));
 for(const name of ['consult_open','consult_revise','consult_status'])assert.ok(execution.includes(`mcp_servers.team_consult.tools.${name}.approval_mode="approve"`));
});
test('agent result parsers distinguish failed turn from process exit',()=>{
 const s={};parseAgentEvent('codex',{type:'thread.started',thread_id:'s'},s);assert.equal(s.session,'s');assert.ok(!s.completed);
 parseAgentEvent('codex',{type:'turn.failed'},s);assert.ok(s.error);
 const c={};parseAgentEvent('claude',{type:'result',subtype:'error_max_turns',session_id:'c'},c);assert.equal(c.completed,false);
});
test('Feishu event keeps root parent sender and strips only own mention',()=>{
 const e=normalize('cli_x',{sender:{sender_type:'user',sender_id:{open_id:'ou_user'}},message:{message_type:'text',message_id:'om_x',chat_id:'oc_x',root_id:'om_root',parent_id:'om_parent',content:JSON.stringify({text:'@_user_1 hello'}),mentions:[{key:'@_user_1',id:{open_id:'ou_bot'}}]}},'ou_bot');
 assert.equal(e.text,'hello');assert.equal(e.root,'om_root');assert.equal(e.parent,'om_parent');assert.equal(e.sender,'ou_user');assert.equal(e.mentioned,true);
});
test('onboarding queues once even after repeated start',async()=>{
 const s=new Store(':memory:'),svc=new Service(s,{history:async()=>({items:[]})},config);
 await svc.introduce();await svc.introduce();assert.equal(s.all('SELECT * FROM outbox').length,1);s.close();
});
test('pause preserves unresolved decision and owner resume cannot bypass it',()=>{
 const {s,t,c,event}=fixture();s.ingest(event(`/pause ${t.id}`,'pause','ou_owner'),config.owner);
 assert.equal(s.consult(c.id).state,'waiting');s.ingest(event(`/resume ${t.id}`,'resume','ou_owner'),config.owner);
 assert.equal(s.task(t.id).state,'waiting');assert.equal(s.claimJob(),undefined);s.close();
});
test('new owner task stays bound to its group root for execution results',async()=>{
 const s=new Store(':memory:');const svc=new Service(s,{send:async()=> 'om_out'},{...config,project:'/tmp',runtime:'claude'},async()=>({session:'claude-exact',text:'done',completed:true}));
 const e={app:config.appId,chat:config.chatId,id:'om_request',sender:config.owner,senderType:'user',mentioned:true,text:'新任务：test'};
 const r=svc.receive(e);assert.ok(r.created);assert.equal(svc.receive(e).duplicate,true);await svc.tick();
 const out=s.all('SELECT * FROM outbox');assert.ok(out.every(o=>o.root==='om_request'));
 svc.receive({...e,id:'om_follow',root:'om_request',text:'改一下标题'});assert.equal(s.claimJob().task,r.created);s.close();
});
test('revised discussion invalidates old proposal approval',async()=>{
 const {s,t,c,event}=fixture();let n=0;const svc=new Service(s,{send:async()=>`om_reply_${++n}`},config,async()=>({session:'session-exact',text:JSON.stringify({reply:'change to B',proposal:'Option B'}),completed:true}));
 svc.receive(event('choose B'));await svc.tick();assert.equal(s.consult(c.id).version,2);
 assert.match(svc.receive(event(`/approve ${c.id} 1`,'old')).rejected,/版本/);assert.equal(s.task(t.id).state,'waiting');s.close();
});
test('offline thread replay deduplicates and never advances an incomplete checkpoint',async()=>{
 const {s,event}=fixture();let complete=false;
 const transport={thread:async()=> 'omt_actual',replay:async(container)=>({items:container==='omt_actual'?[event('offline reply','om_offline')]:[],complete:container==='omt_actual'?complete:true}),fromHistory:m=>m};
 const svc=new Service(s,transport,config);await svc.reconcile();assert.equal(s.all('SELECT * FROM jobs').length,1);
 assert.equal(s.one("SELECT value FROM meta WHERE key='sync:om_root'"),undefined);assert.ok(s.one("SELECT value FROM meta WHERE key='sync:error'"));
 complete=true;await svc.reconcile();assert.equal(s.all('SELECT * FROM jobs').length,1);assert.ok(s.one("SELECT value FROM meta WHERE key='sync:om_root'"));assert.equal(s.one("SELECT value FROM meta WHERE key='sync:error'"),undefined);s.close();
});
test('unrelated group chatter is neither stored nor routed',()=>{
 const s=new Store(':memory:'),svc=new Service(s,{},config);const r=svc.receive({app:config.appId,chat:config.chatId,id:'om_unrelated',sender:'ou_other',senderType:'user',text:'lunch?'});
 assert.equal(r.ignored,'unrelated');assert.equal(s.all('SELECT * FROM messages').length,0);s.close();
});
test('group configuration changes require installer and leave original tasks unchanged',()=>{
 const {s,t,event}=fixture();let saved;const svc=new Service(s,{}, {...config,runtime:'codex',project:'/original'});svc.persistConfig=c=>saved=c;
 assert.equal(svc.receive({...event('改用Claude','a','ou_other'),mentioned:true}).rejected,'owner-only');
 assert.equal(svc.receive({...event('改用Claude','b','ou_owner'),mentioned:true}).configuration,true);
 assert.equal(saved.runtime,'claude');assert.equal(s.task(t.id).runtime,'codex');s.close();
});

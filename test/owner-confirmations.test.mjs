import {test} from 'node:test';import assert from 'node:assert/strict';import {Store} from '../lib/store.mjs';import {Service} from '../lib/service.mjs';import {conversationPolicy} from '../lib/execution-policy.mjs';
const c={appId:'cli_test',chatId:'oc_group',owner:'ou_owner',botId:'ou_bot',runtime:'codex',project:'/tmp',executionMode:'owner-autonomy'};
const e=(text,id,extra={})=>({app:c.appId,chat:c.chatId,text,id,sender:'ou_owner',senderType:'user',mentioned:true,...extra});
function setup(){const s=new Store(':memory:');let calls=0;const svc=new Service(s,{send:async()=> 'om_sent'},c,async(t,k,p)=>({session:'same',text:JSON.stringify(++calls===1?{reply:'',next:null,confirmation:'删除本项目重要旧数据；不可逆，已备份。'}:{reply:'Applied decision',next:null,confirmation:null})}));return {s,svc,calls:()=>calls};}
test('autonomy is explicit per-installation, not a global policy change',()=>{assert.deepEqual(conversationPolicy({}),{});assert.equal(conversationPolicy({executionMode:'inherit'}).sandbox,'workspace-write');const p=conversationPolicy(c);assert.equal(p.sandbox,'danger-full-access');assert.equal(p.approvalPolicy,'on-request');assert.match(p.developerInstructions,/升级版本本身不属于高风险/);});
test('high-risk confirmation is private, owner-only, durable and resumes the same session once',async()=>{
 const {s,svc,calls}=setup();const r=svc.receive(e('work','root'));await svc.tick();const a=s.one('SELECT * FROM owner_confirmations'),out=s.one('SELECT * FROM outbox WHERE id=?',a.outbox);
 assert.equal(out.receive_id_type,'open_id');assert.equal(out.chat,'ou_owner');assert.equal(calls(),1);
 const answer=e('/confirm '+a.id,'yes',{chat:'oc_dm',chatType:'p2p'});
 assert.equal(svc.receive({...answer,chatType:'group'}).rejected,'private-owner-only');assert.equal(svc.receive({...answer,sender:'ou_other'}).rejected,'private-owner-only');assert.equal(svc.receive({...answer,senderType:'app'}).rejected,'private-owner-only');
 assert.ok(svc.receive(answer).queued);assert.equal(svc.receive(answer).ignored,'resolved-confirmation');await svc.tick();assert.equal(calls(),2);assert.equal(s.task(r.task).session,'same');assert.equal(s.all('SELECT * FROM jobs').length,2);s.close();
});
test('denial is carried as denial, cancelled tasks never resume',async()=>{
 for(const cancelled of [false,true]){const {s,svc}=setup();const r=svc.receive(e('work','root'));await svc.tick();const a=s.one('SELECT * FROM owner_confirmations');if(cancelled)s.run("UPDATE tasks SET state='cancelled' WHERE id=?",r.task);
 const reply=svc.receive(e('/reject '+a.id,'no',{chat:'oc_dm',chatType:'p2p'}));if(cancelled)assert.equal(reply.blocked,'cancelled');else {assert.equal(reply.approved,false);const input=JSON.parse(s.all('SELECT * FROM jobs').at(-1).input);assert.equal(input.event.ownerConfirmation.approved,false);}
 s.close();}
});
test('native approval waits for exact private owner reply, never blanket-approves or queues duplicate work',async()=>{
 const {s,svc}=setup();const task=s.createTask({title:'Native',project:'/tmp',runtime:'codex',owner:c.owner});const ctrl=new AbortController();let resolved=false;
 const wait=svc.confirmations.native(task,{replyRoot:'root'},'item/commandExecution/requestApproval',{command:'dangerous-test-only'},ctrl.signal).then(v=>{resolved=true;return v;});
 const a=s.one('SELECT * FROM owner_confirmations');assert.equal(resolved,false);await svc.flush();assert.equal(resolved,false);
 assert.equal(svc.receive(e('/confirm '+a.id,'yes',{chat:'oc_dm',chatType:'p2p'})).queued,false);assert.deepEqual(await wait,{decision:'accept'});assert.equal(s.all('SELECT * FROM jobs').length,0);s.close();
});
test('native abort expires confirmation; late yes cannot execute it',async()=>{
 const {s,svc}=setup();const task=s.createTask({title:'Native',project:'/tmp',runtime:'codex',owner:c.owner}),ctrl=new AbortController();const wait=svc.confirmations.native(task,{replyRoot:'root'},'item/fileChange/requestApproval',{reason:'test'},ctrl.signal);await svc.flush();const a=s.one('SELECT * FROM owner_confirmations');ctrl.abort();assert.deepEqual(await wait,{decision:'decline'});assert.equal(svc.receive(e('/confirm '+a.id,'late',{chat:'oc_dm',chatType:'p2p'})).ignored,'resolved-confirmation');s.close();
});
test('delivered private confirmation joins replay sources and exact chat is enforced',async()=>{
 const {s,svc}=setup();svc.transport.send=async()=>({messageId:'dm_request',chatId:'oc_owner_dm'});svc.receive(e('work','root'));await svc.tick();const a=s.one('SELECT * FROM owner_confirmations');assert.equal(a.dm_chat,'oc_owner_dm');
 assert.equal(svc.receive(e('/confirm '+a.id,'wrongchat',{chat:'oc_other_dm',chatType:'p2p'})).rejected,'private-owner-only');
 const sources=[];svc.transport.thread=async()=>null;svc.transport.replay=async container=>{sources.push(container);return {complete:true,items:[]};};await svc.reconcile();assert.ok(sources.includes('oc_owner_dm'));s.close();
});
test('repeated native operations require separate action confirmations',()=>{
 const {s,svc}=setup();const task=s.createTask({title:'two commands',project:'/tmp',runtime:'codex',owner:c.owner});
 const a=svc.confirmations.request(task,'root','same operation',{mode:'native'}),b=svc.confirmations.request(task,'root','same operation',{mode:'native'});assert.notEqual(a,b);s.close();
});

test('only the bound human can enable this installation autonomy by private command',()=>{
 const {s,svc}=setup();let saved;svc.persistConfig=c=>{saved=c;};
 assert.equal(svc.receive(e('开启自主执行','bot',{chat:'oc_dm',chatType:'p2p',senderType:'app'})).rejected,'owner-only');
 assert.equal(saved,undefined);assert.equal(svc.receive(e('开启自主执行','human',{chat:'oc_dm',chatType:'p2p'})).configured,true);assert.equal(saved.executionMode,'owner-autonomy');
 assert.equal(svc.receive(e('恢复默认执行权限','reset',{chat:'oc_dm',chatType:'p2p'})).configured,true);assert.equal(saved.executionMode,'inherit');s.close();
});

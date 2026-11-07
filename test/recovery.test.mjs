import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../lib/store.mjs';
import {Service} from '../lib/service.mjs';
import {Feishu} from '../lib/feishu.mjs';
const cfg={appId:'cli_test',appSecret:'test-only',chatId:'oc_test',owner:'ou_owner',botId:'ou_bot',project:'/tmp',runtime:'codex'};
const event=(id,extra={})=>({app:cfg.appId,chat:cfg.chatId,id,root:'root',sender:'ou_peer',senderType:'app',text:'Check dependency; no acknowledgement needed',mentioned:true,...extra});
test('plain addressed bot notice is processed once, may be silent, and cannot create ping-pong',async()=>{
 const s=new Store(':memory:');let count=0;const svc=new Service(s,{send:async()=> 'sent'},cfg,async(t,k,p)=>{count++;assert.match(p,/"notice":true/);return {session:'session',text:'{"reply":"","next":null}'};});
 const r=svc.receive(event('notice'));assert.ok(r.queued);assert.ok(svc.receive(event('notice')).duplicate);
 assert.equal(svc.receive(event('same-text')).ignored,'duplicate-notice');
 assert.equal(svc.receive(event('unaddressed',{mentioned:false})).ignored,'unaddressed-bot');
 await svc.tick();assert.equal(count,1);assert.equal(s.all('SELECT * FROM outbox').length,0);
 assert.throws(()=>svc.conversations.complete(s.task(r.task),{notice:true,replyRoot:'root'},{text:'{"reply":"","next":{"recipient":"ou_peer","body":"again"}}'}),/结束消息/);s.close();
});
test('history resolves bot identity through same-app platform record, not a name or app-id guess',async()=>{
 const f=new Feishu(cfg),s=new Store(':memory:'),svc=new Service(s,{},cfg);
 const m={message_id:'history',root_id:'root',chat_id:cfg.chatId,msg_type:'text',sender:{id:'cli_peer',id_type:'app_id',sender_type:'app'},mentions:[{key:'@_user_1',id:cfg.botId}],body:{content:'{"text":"@_user_1 Check dependencies"}'}};
 f.client={im:{message:{list:async()=>({code:0,data:{items:[structuredClone(m)]}})}},request:async()=>({code:0,data:{items:[{message_id:'history',sender:{id:'cli_peer',open_bot_id:'ou_peer'}}]}})};
 const batch=await f.replay(cfg.chatId,'chat',1),e=f.fromHistory(batch.items[0],null);assert.equal(e.sender,'ou_peer');assert.ok(svc.receive(e).queued);
 assert.equal(svc.receive({...e,id:'self',sender:cfg.botId}).ignored,'self-or-unknown');
 assert.equal(svc.receive({...e,id:'unresolved',sender:'cli_peer'}).ignored,'unresolved-platform-sender');
 f.client.request=async()=>({code:0,data:{items:[{message_id:'history',sender:{id:'cli_wrong',open_bot_id:'ou_peer'}}]}});
 const bad=await f.replay(cfg.chatId,'chat',1);assert.equal(f.fromHistory(bad.items[0],null).sender,'cli_peer');s.close();
});
test('offline new topic discovered from group root replays replies and survives restart without duplicates',async()=>{
 const s=new Store(':memory:');let online=false;const calls=[];
 const transport={thread:async()=> 'thread',fromHistory:m=>m.event,replay:async(container,type,start)=>{calls.push({container,start});if(!online)throw Error('offline');return {complete:true,items:container===cfg.chatId?[{message_id:'root',thread_id:'thread',create_time:String(Date.now()-7200000)}]:[{message_id:'notice',event:event('notice')}]};}};
 const svc=new Service(s,transport,cfg);s.run("UPDATE meta SET value=? WHERE key='sync:group'",String(Math.floor(Date.now()/1000)-8000));
 const checkpoint=s.one("SELECT value FROM meta WHERE key='sync:group'").value;
 await svc.reconcile();assert.equal(s.one("SELECT value FROM meta WHERE key='sync:group'").value,checkpoint);assert.match(s.one("SELECT value FROM meta WHERE key='sync:error'").value,/offline/);
 online=true;await svc.reconcile();assert.equal(s.all('SELECT * FROM jobs').length,1);assert.ok(calls.some(c=>c.container==='thread'&&c.start<Number(checkpoint)+1000));
 const next=new Service(s,transport,cfg);await next.reconcile();assert.equal(s.all('SELECT * FROM jobs').length,1);assert.equal(s.one("SELECT value FROM meta WHERE key='sync:error'"),undefined);s.close();
});
test('one failed source does not prevent another topic from catching up',async()=>{
 const s=new Store(':memory:');const transport={fromHistory:m=>m.event,replay:async container=>{if(container===cfg.chatId)throw Error('group offline');return {complete:true,items:[{message_id:'notice',event:event('notice')}]};}};
 const svc=new Service(s,transport,cfg);s.run('INSERT INTO sync_threads VALUES(?,?,?,?,?)',cfg.appId,cfg.chatId,'root','thread',Date.now()-100000);
 await svc.reconcile();assert.equal(s.all('SELECT * FROM jobs').length,1);assert.match(s.one("SELECT value FROM meta WHERE key='sync:error'").value,/group offline/);s.close();
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../lib/store.mjs';
import {Announcements,announcementText} from '../lib/announcements.mjs';
import {Service} from '../lib/service.mjs';
import {Feishu} from '../lib/feishu.mjs';
const cfg={appId:'cli_test',chatId:'oc_group',owner:'ou_owner',botId:'ou_bot',runtime:'codex',project:'/tmp'};
const announcement=(text='Gavin handles technology',revision='2')=>({text,revision,source:'feishu:docx-announcement:oc_group'});
const block=(id,text,children=[])=>({block_id:id,text:{elements:[{text_run:{content:text}}]},children});
test('announcement reads are single-flight and job-driven with bounded TTL',async()=>{
 const s=new Store(':memory:');let now=1000,calls=0,release;
 const a=new Announcements(s,{announcement:async()=>{calls++;await new Promise(r=>release=r);return announcement();}},cfg,{now:()=>now});
 const first=a.refresh();const second=a.refresh();await new Promise(r=>setImmediate(r));assert.equal(calls,1);release();
 assert.deepEqual(await first,await second);assert.equal(a.snapshot().available,true);assert.equal(a.snapshot().stale,false);assert.equal(a.snapshot().error,null);
 await a.refresh();assert.equal(calls,1);now+=60001;const next=a.refresh();await new Promise(r=>setImmediate(r));assert.equal(calls,2);release();await next;s.close();
});
test('read failure preserves stale body, backs off, and successful empty announcement clears it',async()=>{
 const s=new Store(':memory:');let now=1000,calls=0,fail=false,text='old';
 const a=new Announcements(s,{announcement:async()=>{calls++;if(fail)throw Error('missing scope');return announcement(text);}},cfg,{now:()=>now});
 await a.refresh();now+=60001;fail=true;let state=await a.refresh();assert.equal(state.text,'old');assert.equal(state.stale,true);assert.match(state.error,/scope/);
 await a.refresh({force:true});assert.equal(calls,2);now+=60001;fail=false;text='';state=await a.refresh();assert.equal(state.available,true);assert.equal(state.text,'');assert.equal(state.stale,false);s.close();
});
test('timeout cannot allow a late response to overwrite newer cached data',async()=>{
 const s=new Store(':memory:');let now=1000,finish;
 const transport={announcement:()=>new Promise(r=>finish=r)};const a=new Announcements(s,transport,cfg,{now:()=>now,timeoutMs:5,backoffMs:10});
 assert.equal((await a.refresh()).available,false);now+=11;transport.announcement=async()=>announcement('new','3');await a.refresh();finish(announcement('late old','2'));await new Promise(r=>setImmediate(r));assert.equal(a.snapshot().text,'new');s.close();
});
test('persistent announcement memory is isolated by application and group',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'collab-announcement-')),path=join(dir,'db');let s=new Store(path);
 try{
  await new Announcements(s,{announcement:async()=>announcement()},cfg).refresh();s.close();s=new Store(path);
  assert.equal(new Announcements(s,{},cfg).snapshot().text,'Gavin handles technology');
  assert.equal(new Announcements(s,{}, {...cfg,appId:'cli_other'}).snapshot().available,false);
  assert.equal(new Announcements(s,{}, {...cfg,chatId:'oc_other'}).snapshot().available,false);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('old installation startup refreshes before introduction guard; existing session gets current snapshot',async()=>{
 const s=new Store(':memory:');let calls=0,current='one',n=0;const prompts=[];
 s.run('INSERT INTO meta VALUES(?,?)',`introduced:${cfg.appId}:${cfg.chatId}`,'sent');
 const svc=new Service(s,{announcement:async()=>{calls++;return announcement(current,current);},send:async()=>`out-${++n}`},cfg,async(t,k,p)=>{prompts.push(p);return {session:'same',text:JSON.stringify({reply:'answer',next:null})};});
 await svc.introduce();assert.equal(calls,1);assert.equal(s.all('SELECT * FROM outbox').length,0);
 const e=(text,id)=>({app:cfg.appId,chat:cfg.chatId,id,root:'root',sender:'ou_owner',senderType:'user',mentioned:true,text});
 svc.receive(e('question','a'));await svc.tick();assert.match(prompts[0],/"text":"one"/);
 current='two';await svc.announcements.refresh({force:true});svc.receive(e('continue','b'));await svc.tick();assert.match(prompts[1],/"text":"two"/);assert.match(prompts[1],/不授予本机权限/);
 assert.equal(svc.receive({...e('切换项目：/tmp','other'),sender:'ou_other'}).rejected,'owner-only');assert.equal(s.all('SELECT * FROM group_roles').length,0);s.close();
});
test('tree flattening preserves document order and rejects incomplete or cyclic structure',()=>{
 assert.equal(announcementText([block('b','second'),block('root','',['a','b']),block('nested','nested'),block('a','first',['nested'])],'root'),'first\n\nnested\n\nsecond');
 assert.throws(()=>announcementText([block('root','',['missing'])],'root'),/缺少子块/);
 assert.throws(()=>announcementText([block('root','',['root'])],'root'),/重复/);
 assert.throws(()=>announcementText([block('root',''),block('orphan','lost')],'root'),/未关联/);
 assert.equal(announcementText([block('root','')],'root'),'');
 assert.match(announcementText([{block_id:'root',block_type:1,children:['image']},{block_id:'image',block_type:27}],'root'),/非文字块：27/);
 assert.match(announcementText([{block_id:'root',block_type:1,page:{elements:[{mention_user:{user_id:'ou_a'}},{mention_user:{user_id:'ou_b'}}]}}],'root'),/ou_a.*ou_b/);
});
test('Feishu adapter reads all pages and verifies a consistent revision',async()=>{
 const f=new Feishu({...cfg,appSecret:'fake-test-secret'});let pages=0;const requests=[];
 f.client={request:async r=>{requests.push(r);if(!r.url.endsWith('/blocks'))return {code:0,data:{announcement_type:'docx',revision_id:2}};
  return {code:0,data:++pages===1?{items:[block(cfg.chatId,'',['a','b']),block('a','first')],has_more:true,page_token:'next'}:{items:[block('b','second')],has_more:false}};}};
 const result=await f.announcement(cfg.chatId);assert.equal(result.text,'first\n\nsecond');assert.equal(requests[2].params.page_token,'next');assert.equal(result.revision,'2');
 f.client={request:async r=>({code:0,data:r.url.endsWith('/blocks')?{items:[block(cfg.chatId,'')],has_more:true,page_token:'repeat'}:{announcement_type:'docx',revision_id:2}})};
 await assert.rejects(f.announcement(cfg.chatId),/分页游标异常/);
 let meta=1;f.client={request:async r=>({code:0,data:r.url.endsWith('/blocks')?{items:[block(cfg.chatId,'')],has_more:false}:{announcement_type:'docx',revision_id:meta++}})};
 await assert.rejects(f.announcement(cfg.chatId),/读取期间发生更新/);
});
test('malformed API responses never masquerade as a successful empty announcement',async()=>{
 const f=new Feishu({...cfg,appSecret:'fake-test-secret'});f.client={request:async r=>({code:0,data:r.url.endsWith('/blocks')?{}:{announcement_type:'docx',revision_id:2}})};
 await assert.rejects(f.announcement(cfg.chatId),/缺少块列表/);
 const s=new Store(':memory:');const a=new Announcements(s,{announcement:async()=>({revision:'2'})},cfg);assert.equal((await a.refresh()).available,false);s.close();
});

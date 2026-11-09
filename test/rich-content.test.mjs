import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {messageContent} from '../lib/message-content.mjs';
import {normalize,Feishu} from '../lib/feishu.mjs';
import {prepareImages} from '../lib/image-input.mjs';
const mentions=[{key:'@_user_1',id:'ou_bot',name:'Helper'}];
const post={title:'Failure',content:[[{tag:'text',text:'Check '},{tag:'at',user_id:'@_user_1'},{tag:'a',text:'details',href:'https://example.test/run'}],[{tag:'img',image_key:'img_one'}],[{tag:'img',image_key:'img_two'}]]};
const event=content=>({sender:{sender_type:'user',sender_id:{open_id:'ou_owner'}},message:{message_type:'post',message_id:'om_post',chat_id:'oc_group',content:JSON.stringify(content),mentions}});
test('receive, localized post and history retain text, links, image keys and trusted mentions',()=>{
 const live=normalize('cli_test',event(post),'ou_bot');assert.equal(live.mentioned,true);assert.match(live.text,/Failure\nCheck details \(https:\/\/example.test\/run\)/);assert.equal(live.attachments.length,2);
 assert.deepEqual(messageContent('post',JSON.stringify({zh_cn:post,en_us:{title:'ignored',content:[]}}),mentions,'ou_bot').attachments,live.attachments);
 const f=new Feishu({appId:'cli_test',appSecret:'fake-test-secret',botId:'ou_bot',chatId:'oc_group'});
 const history=f.fromHistory({message_id:'om_post',chat_id:'oc_group',msg_type:'post',body:{content:JSON.stringify(post)},mentions,sender:{id:'ou_owner',sender_type:'user'}},'om_root');
 assert.equal(history.text,live.text);assert.equal(history.mentioned,true);assert.deepEqual(history.attachments,live.attachments);
 const forged=event(post);forged.message.mentions=[];assert.equal(normalize('cli_test',forged,'ou_bot').mentioned,false);
});
test('content_v2 is fallback only, malformed and unsupported content are explicit',()=>{
 assert.equal(messageContent('post',{...post,content_v2:post.content}).attachments.length,2);
 assert.equal(messageContent('post',{content_v2:post.content}).attachments.length,2);
 assert.equal(messageContent('text','{').partial,true);
 assert.equal(messageContent('text',{text:7}).partial,true);
 assert.equal(messageContent('post',{content:[[{tag:'future',text:'kept'}]]}).partial,true);
 assert.match(messageContent('file',{file_key:'file_x'}).text,/未解析/);
 assert.equal(messageContent('image',{image_key:'img_only'}).attachments[0].key,'img_only');
});
test('topic context projects real post shape instead of empty text and retains source metadata',async()=>{
 const f=new Feishu({appId:'cli_test',appSecret:'fake-test-secret',botId:'ou_bot',chatId:'oc_group'});
 f.client={im:{message:{get:async()=>({code:0,data:{items:[{chat_id:'oc_group',message_id:'om_root',msg_type:'post',body:{content:JSON.stringify(post)},mentions}]}})}}};
 const r=await f.topicContext('om_root');assert.equal(r.available,true);assert.match(r.items[0].text,/Failure/);assert.equal(r.items[0].attachments.length,2);assert.equal(r.items[0].partial,false);
 f.config.chatId='oc_other';assert.equal((await f.topicContext('om_root')).available,false);
});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nXQAAAAASUVORK5CYII=','base64');
const context={event:{id:'om_one',attachments:[{type:'image',key:'img_one'},{type:'image',key:'img_two'}]},topic:{items:[{id:'om_one',attachments:[{type:'image',key:'img_one'}]}]}};
test('images are bound to exact source pairs, deduplicated and emitted as native image inputs',async()=>{
 const calls=[];const r=await prepareImages(context,async(id,key)=>{calls.push([id,key]);return {getReadableStream:()=>Readable.from([png])};});
 assert.deepEqual(calls,[['om_one','img_one'],['om_one','img_two']]);assert.equal(r.inputs.length,2);assert.match(r.inputs[0].url,/^data:image\/png;base64,/);assert.equal(r.report[1].inputIndex,2);assert.ok(!JSON.stringify(r.report).includes('base64'));
});
test('resource failures, non-images, size, count and timeout preserve text with explicit missing image status',async()=>{
 const error=await prepareImages(context,async()=>{throw Error('private diagnostic');});assert.equal(error.inputs.length,0);assert.ok(error.report.every(x=>x.status==='unavailable'));assert.ok(!JSON.stringify(error).includes('private diagnostic'));
 const fetch=async()=>({getReadableStream:()=>Readable.from([png])});
 assert.equal((await prepareImages(context,fetch,{maxBytes:8})).inputs.length,0);
 assert.equal((await prepareImages(context,fetch,{limit:1})).inputs.length,1);
 assert.equal((await prepareImages(context,async()=>({getReadableStream:()=>Readable.from(['not an image'])}))).inputs.length,0);
 const timeout=await prepareImages(context,()=>new Promise(()=>{}),{timeoutMs:5,limit:1});assert.match(timeout.report[0].reason,/超时/);
});
test('resumed quoted post is refreshed and image bytes reach runner outside serialized context',async()=>{
 const {Store}=await import('../lib/store.mjs');const {Service}=await import('../lib/service.mjs');
 const cfg={appId:'cli_test',chatId:'oc_group',owner:'ou_owner',botId:'ou_bot',project:'/tmp',runtime:'codex'};
 const store=new Store(':memory:');const roots=[],received=[];
 const transport={send:async()=> 'om_reply',topicContext:async root=>{roots.push(root);return {available:true,items:[{id:root,...messageContent('post',post)}]};},imageInputs:async context=>prepareImages(context,async()=>({getReadableStream:()=>Readable.from([png])}))};
 const svc=new Service(store,transport,cfg,async(task,kind,prompt,options)=>{received.push({session:task.session,prompt,images:options.imageInputs});return {session:'persistent',text:JSON.stringify({reply:'Checked',next:null})};});
 try{
  svc.receive({app:cfg.appId,chat:cfg.chatId,id:'om_first',root:'om_topic',sender:'ou_owner',senderType:'user',text:'Check',mentioned:true});await svc.tick();
  svc.receive({app:cfg.appId,chat:cfg.chatId,id:'om_follow',root:'om_topic',parent:'om_new_post',sender:'ou_owner',senderType:'user',text:'Check this image',mentioned:true});await svc.tick();
  assert.deepEqual(roots,['om_topic','om_new_post']);assert.equal(received[1].session,'persistent');assert.equal(received[1].images.length,2);assert.match(received[1].prompt,/om_new_post/);assert.ok(!received[1].prompt.includes('base64'));
 }finally{store.close();}
});

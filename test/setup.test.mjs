import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from '../lib/setup.mjs';

test('local setup discovers bot, pairs only in private chat, and saves verified identity',async()=>{
 let handler,saved;
 const app=await setup({open:false,discover:async()=>({botId:'ou_discovered',name:'Test bot'}),makeTransport:()=>({listen:async f=>handler=f,ws:{close(){}}}),onSave:c=>saved=c});
 const post=(path,body,origin=app.url)=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+app.key,Origin:origin},body:JSON.stringify(body)});
 try{
  assert.equal((await post('/discover',{},'https://foreign.example')).status,400);
  const body={appId:'cli_0000000000000000',appSecret:'fake-unit-test-only'};
  const discovery=await (await post('/discover',body)).json();assert.equal(discovery.botId,'ou_discovered');assert.ok(!('appSecret' in discovery));
  handler({chatType:'group',senderType:'user',sender:'ou_attacker',text:discovery.pairCode});
  assert.equal((await (await post('/pair',{})).json()).owner,null);
  handler({chatType:'p2p',senderType:'user',sender:'ou_owner',text:discovery.pairCode});
  assert.equal((await (await post('/pair',{})).json()).owner,'ou_owner');
  assert.equal((await post('/config',{...body,appSecret:'changed'})).status,400);
  assert.equal((await post('/config',{...body,botId:'ou_wrong',owner:'ou_wrong',chatId:'https://applink.feishu.cn/client/chat/open?openChatId=oc_selected',runtime:'codex',project:'/tmp'})).status,200);
  assert.equal(saved.owner,'ou_owner');assert.equal(saved.botId,'ou_discovered');assert.equal(saved.chatId,'oc_selected');
  assert.equal((await fetch(app.url)).headers.get('x-frame-options'),'DENY');
 }finally{await new Promise(r=>app.server.close(r));}
});

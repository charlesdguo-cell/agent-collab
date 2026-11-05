import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {saveConfig} from './config.mjs';
import {jsonBody,token} from './local-api.mjs';
import {Feishu} from './feishu.mjs';

export async function setup({open=true,discover=Feishu.discover,makeTransport=c=>new Feishu(c),onSave=saveConfig}={}) {
  const key=token();let origin,pairedOwner,transport,pairCode,pairExpires,verified;
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
    if(req.method==='GET'&&req.url==='/'){
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync(new URL('./setup.html',import.meta.url),'utf8'));return;
    }
    res.setHeader('Content-Type','application/json');
    try{
      if(req.method!=='POST'||req.headers.origin!==origin||req.headers.authorization!==`Bearer ${key}`||req.headers['content-type']!=='application/json')throw Error('无效本机配置请求');
      const body=await jsonBody(req);
      if(req.url==='/discover'){
        if(!/^cli_[0-9a-f]{16}$/i.test(body.appId)||typeof body.appSecret!=='string')throw Error('请填写有效应用凭据');
        const info=await discover(body.appId,body.appSecret);
        transport?.ws?.close();pairedOwner=null;pairCode='配对 '+token().slice(0,12);pairExpires=Date.now()+600000;
        verified={appId:body.appId,appSecret:body.appSecret,...info};
        transport=makeTransport(verified);
        await transport.listen(e=>{if(Date.now()<pairExpires&&e.chatType==='p2p'&&e.senderType==='user'&&e.text===pairCode&&!pairedOwner)pairedOwner=e.sender;});
        res.end(JSON.stringify({ok:true,botId:info.botId,botName:info.name,pairCode}));return;
      }
      if(req.url==='/pair'){
        res.end(JSON.stringify({ok:true,owner:pairedOwner||null,expired:!!pairExpires&&Date.now()>pairExpires}));return;
      }
      if(req.url!=='/config')throw Error('未知配置操作');
      if(verified){
        if(body.appId!==verified.appId||body.appSecret!==verified.appSecret)throw Error('应用凭据已变化，请重新验证');
        body.botId=verified.botId;
      }
      if(pairedOwner)body.owner=pairedOwner;
      if(body.chatId&&!body.chatId.startsWith('oc_')){
        try{body.chatId=new URL(body.chatId).searchParams.get('openChatId')||body.chatId;}catch{}
      }
      onSave(body);res.end(JSON.stringify({ok:true}));transport?.ws?.close();
      if(process.env.AGENT_COLLAB_INSTALL==='1')server.close();
    }catch(e){res.statusCode=400;res.end(JSON.stringify({ok:false,error:e.message}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  server.on('close',()=>transport?.ws?.close());
  if(open){
    const url=origin+'/#'+key;
    console.log('已打开本机配置页；关闭此程序可停止配置服务。');
    const cmd=process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open';
    spawn(cmd,[url],{stdio:'ignore'}).on('error',()=>console.log('浏览器未打开，请使用本机配置入口：'+url));
  }
  return {server,url:origin,key};
}

import {randomUUID,createHash} from 'node:crypto';
const marker='\n[agent-collab:v1]';
const identity=x=>typeof x==='string'&&/^ou_[\w-]+$/.test(x);
const hash=x=>createHash('sha256').update(x.trim().replace(/\s+/g,' ')).digest('hex');
export function decode(text){
  const at=text.lastIndexOf(marker);if(at<0)return {body:text,envelope:null};
  try {const e=JSON.parse(text.slice(at+marker.length));
    if(!['request','reply','close','receipt'].includes(e.kind)||typeof e.exchange!=='string'||e.exchange.length>100||typeof e.message!=='string'||e.message.length>100||!identity(e.to)||typeof e.expectsReply!=='boolean'||!Number.isSafeInteger(e.turn)||e.turn<0||!Number.isFinite(e.deadline))throw Error();
    return {body:text.slice(0,at),envelope:e};
  }catch{return {body:text,envelope:null,invalid:true};}
}
export class Conversations {
  constructor(store,config){
    this.s=store;this.c=config;
    store.db.exec(`CREATE TABLE IF NOT EXISTS conversations(app TEXT,chat TEXT,root TEXT,task TEXT NOT NULL REFERENCES tasks(id),PRIMARY KEY(app,chat,root));
      CREATE TABLE IF NOT EXISTS conversation_messages(app TEXT,chat TEXT,id TEXT,root TEXT,sender TEXT,sender_type TEXT,body TEXT,created INTEGER,PRIMARY KEY(app,id));
      CREATE TABLE IF NOT EXISTS exchanges(app TEXT,chat TEXT,root TEXT,id TEXT,peer TEXT,state TEXT,last_sent TEXT,last_received TEXT,turn INTEGER,deadline INTEGER,hash TEXT,PRIMARY KEY(app,chat,id));
      CREATE TABLE IF NOT EXISTS group_roles(app TEXT,chat TEXT,member TEXT,sender_type TEXT,body TEXT,source TEXT,updated INTEGER,confirmation TEXT,PRIMARY KEY(app,chat,member));
      CREATE TABLE IF NOT EXISTS local_topics(app TEXT,request_id TEXT,task TEXT,request TEXT,outbox TEXT,root TEXT,PRIMARY KEY(app,request_id));`);
  }
  localStart({requestId,title,request}){
    if(typeof requestId!=='string'||!requestId.trim()||requestId.length>100||typeof request!=='string'||!request.trim()||request.length>16000)throw Error('需要 requestId 和完整 request（最多16000字）');
    if(this.c.runtime!=='codex')throw Error('话题协作当前仅支持 Codex');
    return this.s.tx(()=>{
      const old=this.s.one('SELECT * FROM local_topics WHERE app=? AND request_id=?',this.c.appId,requestId);
      if(old){if(old.request!==request)throw Error('requestId 已用于其他内容');return this.localStatus(old.task);}
      const task=this.s.createTask({title:(title||request).slice(0,80),project:this.c.project,runtime:this.c.runtime,owner:this.c.owner});
      const visible=task.title.replace(/<at\b[^>]*>[\s\S]*?<\/at>/gi,'[提及]');
      const out=this.s.send(this.c.chatId,null,`${visible}｜本机 Codex 发起的协作`);
      this.s.run('INSERT INTO local_topics VALUES(?,?,?,?,?,NULL)',this.c.appId,requestId,task.id,request,out);
      return this.localStatus(task.id);
    });
  }
  localStatus(task){
    const t=this.s.task(task),local=this.s.one('SELECT root,outbox FROM local_topics WHERE app=? AND task=?',this.c.appId,task);
    const root=local?.root||this.s.one('SELECT root FROM conversations WHERE app=? AND chat=? AND task=?',this.c.appId,this.c.chatId,task)?.root;
    if(!local&&!root)throw Error('不是本应用的话题');
    return {task,state:t.state,root:root||null,delivery:local?this.s.one('SELECT state,error FROM outbox WHERE id=?',local.outbox):null,
      jobs:this.s.all('SELECT id,kind,state,error FROM jobs WHERE task=? ORDER BY rowid',task),
      messages:root?this.s.all('SELECT sender,sender_type,body FROM conversation_messages WHERE app=? AND chat=? AND root=? ORDER BY rowid DESC LIMIT 20',this.c.appId,this.c.chatId,root).reverse():[]};
  }
  localFollow({task,requestId,request}){
    if(typeof requestId!=='string'||!requestId.trim()||requestId.length>100||typeof request!=='string'||!request.trim()||request.length>16000)throw Error('需要 requestId 和完整 request');
    return this.s.tx(()=>{
      const status=this.localStatus(task);if(!status.root)throw Error('话题尚未送达');
      if(['paused','cancelled','failed','uncertain'].includes(status.state))throw Error('话题已暂停，先核对状态');
      const id='local:'+requestId,old=this.s.one('SELECT * FROM conversation_messages WHERE app=? AND id=?',this.c.appId,id);
      if(old){if(old.root!==status.root||old.body!==request)throw Error('requestId 已用于其他内容');return status;}
      this.queueLocal(task,status.root,id,request);return this.localStatus(task);
    });
  }
  queueLocal(task,root,id,text){
    const event={app:this.c.appId,chat:this.c.chatId,id,root,sender:this.c.owner,senderType:'local',source:'local-cli',text,mentioned:false};
    this.record(event,root,text);this.s.queue(task,'conversation',{event,replyRoot:root,exchange:null,terminal:false});
  }
  route(e){
    for(const id of [e.root,e.parent,e.thread,e.id].filter(Boolean)){
      const row=this.s.one('SELECT * FROM conversations WHERE app=? AND chat=? AND root=?',e.app,e.chat,id);
      if(row)return row;
      const m=this.s.one('SELECT root FROM conversation_messages WHERE app=? AND chat=? AND id=?',e.app,e.chat,id);
      if(m){const r=this.s.one('SELECT * FROM conversations WHERE app=? AND chat=? AND root=?',e.app,e.chat,m.root);if(r)return r;}
    }return null;
  }
  seedBots(items){
    for(const b of items)if(identity(b.bot_id))this.s.run('INSERT OR IGNORE INTO group_roles VALUES(?,?,?,?,?,?,?,?)',this.c.appId,this.c.chatId,b.bot_id,'app',b.bot_name||'bot','platform:group-bots',Date.now(),'platform-identity-owner-unknown');
  }
  roles(){return this.s.all('SELECT member,sender_type,body,source,updated,confirmation FROM group_roles WHERE app=? AND chat=?',this.c.appId,this.c.chatId);}
  remember(e){
    const role=e.text.match(/^(?:\/role\s+|我(?:主要)?负责)([\s\S]+)$/);if(!role)return false;
    this.s.run('INSERT INTO group_roles VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(app,chat,member) DO UPDATE SET body=excluded.body,source=excluded.source,updated=excluded.updated,confirmation=excluded.confirmation',e.app,e.chat,e.sender,e.senderType,role[1].slice(0,2000),e.id,Date.now(),e.senderType==='user'?'self-declared':'bot-self-declared-not-owner-verified');
    return true;
  }
  record(e,root,body){this.s.run('INSERT OR IGNORE INTO conversation_messages VALUES(?,?,?,?,?,?,?,?)',e.app,e.chat,e.id,root,e.sender,e.senderType,body,Date.now());}
  receive(e,{resume=false}={}){
    if(!['user','app'].includes(e.senderType)||e.sender===this.c.botId)return {ignored:'self-or-unknown'};
    if(!identity(e.sender))return {ignored:'unresolved-platform-sender'};
    const parsed=decode(e.text),wire=parsed.envelope;
    if(e.senderType==='app' && (!e.mentioned || !wire))return {ignored:'unaddressed-bot'};
    const existing=this.route(e);
    if(!e.mentioned&&!existing&&!/^\/role |^我(主要)?负责/.test(e.text))return {ignored:'unrelated'};
    return this.s.tx(()=>{
      if(this.s.one('SELECT id FROM conversation_messages WHERE app=? AND id=?',e.app,e.id)||this.s.one('SELECT id FROM messages WHERE app=? AND id=?',e.app,e.id))return {duplicate:true};
      let root=existing?.root||e.root||e.parent||e.id;
      this.record(e,root,parsed.body);
      if(e.senderType==='app')this.s.run('INSERT OR IGNORE INTO group_roles VALUES(?,?,?,?,?,?,?,?)',e.app,e.chat,e.sender,'app','群内协作机器人',e.id,Date.now(),'platform-sender-owner-unknown');
      if(this.remember(e)){if(e.senderType==='user')this.s.send(e.chat,root,'已更新你的职责介绍。');return {role:true};}
      if(parsed.invalid)return {ignored:'invalid-envelope'};
      let exchange=null,terminal=false;
      if(e.senderType==='app'){
        exchange=this.s.one('SELECT * FROM exchanges WHERE app=? AND chat=? AND id=?',e.app,e.chat,wire.exchange);
        if(exchange && (exchange.root!==root||exchange.peer!==e.sender||exchange.state==='closed'))return {ignored:'closed-or-mismatched-exchange'};
        if(wire.kind==='receipt')return {ignored:'receipt'};
        if(!exchange){
          if(wire.kind!=='request'||!wire.expectsReply||wire.inReplyTo)return {ignored:'unsolicited-reply'};
          if(wire.deadline<=Date.now()||wire.turn>=(this.c.exchangeBudget||8))return {ignored:'expired'};
          this.s.run('INSERT INTO exchanges VALUES(?,?,?,?,?,?,?,?,?,?,?)',e.app,e.chat,root,wire.exchange,e.sender,'open',null,wire.message,wire.turn,Math.min(wire.deadline,Date.now()+600000),hash(parsed.body));
        }else{
          if(wire.inReplyTo!==exchange.last_sent||!exchange.last_sent||wire.turn<=exchange.turn)return {ignored:'unmatched-reply'};
          if(wire.deadline>Date.now()+600000||wire.turn>=(this.c.exchangeBudget||8)||Date.now()>exchange.deadline||hash(parsed.body)===exchange.hash){
            this.s.run("UPDATE exchanges SET state='closed' WHERE app=? AND chat=? AND id=?",e.app,e.chat,wire.exchange);
            this.s.send(e.chat,root,'本次 Agent 往返已停止：达到时限、轮数或出现重复内容。新问题可在此话题继续。');return {closed:true};
          }
          this.s.run('UPDATE exchanges SET last_sent=NULL,last_received=?,turn=?,hash=? WHERE app=? AND chat=? AND id=?',wire.message,wire.turn,hash(parsed.body),e.app,e.chat,wire.exchange);
        }
        if(!wire.expectsReply||wire.kind==='close'){
          this.s.run("UPDATE exchanges SET state='closed' WHERE app=? AND chat=? AND id=?",e.app,e.chat,wire.exchange);
          // Resume dependent local work once, but never address another bot from a terminal delivery.
          terminal=true;
        }
      }
      let task=existing?this.s.task(existing.task):this.s.resolveTask(e);
      if(!task){task=this.s.createTask({title:parsed.body.slice(0,80)||'群协作',project:this.c.project,runtime:this.c.runtime,owner:this.c.owner});}
      this.s.run('INSERT OR IGNORE INTO conversations VALUES(?,?,?,?)',e.app,e.chat,root,task.id);
      this.s.run('INSERT OR IGNORE INTO task_threads VALUES(?,?,?,?)',e.app,e.chat,root,task.id);
      if(task.state==='cancelled'||(!resume&&['paused','uncertain','failed'].includes(task.state)))return {blocked:task.state};
      this.s.run("UPDATE tasks SET state='ready' WHERE id=?",task.id);
      this.s.queue(task.id,'conversation',{event:{...e,text:parsed.body},replyRoot:root,exchange:terminal?null:(wire?.exchange||null),terminal});
      if(e.senderType==='user')this.s.send(e.chat,root,'已收到，正在处理这个话题。');
      return {queued:true,task:task.id,...(terminal?{closed:true}:{})};
    });
  }
  context(input){return {localBinding:{owner:this.c.owner,ownerName:this.c.ownerName||null,bot:this.c.botId,source:this.c.ownerSource||'local-paired-config'},sender:{id:input.event.sender,type:input.event.senderType,installer:input.event.sender===this.c.owner},event:input.event,exchange:input.exchange,roles:this.roles(),history:this.s.all('SELECT id,sender,sender_type,body FROM conversation_messages WHERE app=? AND chat=? AND root=? ORDER BY rowid DESC LIMIT 30',this.c.appId,this.c.chatId,input.replyRoot).reverse()};}
  complete(task,input,result){
    let output;try{output=JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{throw Error('Agent 未返回有效协作结果，未发送未经确认的消息');}
    if(typeof output.reply!=='string'||output.reply.length>20000)throw Error('协作回复格式无效');
    const s=this.s,c=this.c,root=input.replyRoot;
    if(input.terminal && output.next)throw Error('结束消息不能触发新的自动往返');
    if(output.next && (!identity(output.next.recipient)||output.next.recipient===c.botId||typeof output.next.body!=='string'||!output.next.body.trim()||output.next.body.length>16000))throw Error('协作请求缺少有效接收方或正文');
    let ex=input.exchange?s.one('SELECT * FROM exchanges WHERE app=? AND chat=? AND id=?',c.appId,c.chatId,input.exchange):null;
    if(ex?.state==='closed')return;
    const sendWire=(body,peer,exchange,kind,expectsReply)=>{
      const message=randomUUID(),turn=exchange.turn+1;
      if(turn>=(c.exchangeBudget||8)||exchange.deadline<=Date.now()){
        s.run("UPDATE exchanges SET state='closed' WHERE app=? AND chat=? AND id=?",c.appId,c.chatId,exchange.id);
        s.send(c.chatId,root,'本次 Agent 往返已达到限制，自动交流已停止。');return;
      }
      const envelope={exchange:exchange.id,message,inReplyTo:exchange.last_received,to:peer,kind,expectsReply,turn,deadline:exchange.deadline};
      s.send(c.chatId,root,`<at user_id="${peer}">协作对象</at>\n${body}${marker}${JSON.stringify(envelope)}`);
      s.run('UPDATE exchanges SET last_sent=?,turn=?,state=?,hash=? WHERE app=? AND chat=? AND id=?',message,turn,expectsReply?'open':'closed',hash(body),c.appId,c.chatId,exchange.id);
    };
    if(output.next){
      if(ex && ex.peer!==output.next.recipient)throw Error('本次往返只能回复原协作对象；其他对象请在新一轮中发起');
      if(!ex){ex={id:randomUUID(),peer:output.next.recipient,turn:0,last_received:null,deadline:Date.now()+600000};s.run('INSERT INTO exchanges VALUES(?,?,?,?,?,?,?,?,?,?,?)',c.appId,c.chatId,root,ex.id,ex.peer,'open',null,null,0,ex.deadline,null);}
      sendWire(output.next.body,ex.peer,ex,input.exchange?'reply':'request',true);
    }else if(ex)sendWire(output.reply||'本次结束，无需回复。',ex.peer,ex,'close',false);
    else if(output.reply.trim())s.send(c.chatId,root,output.reply.replace(/<at\b[^>]*>[\s\S]*?<\/at>/gi,'[提及]'));
  }
  delivered(out,remote){
    const local=this.s.one('SELECT * FROM local_topics WHERE app=? AND outbox=?',this.c.appId,out.id);
    if(local&&!local.root){
      this.s.run('UPDATE local_topics SET root=? WHERE app=? AND outbox=?',remote,this.c.appId,out.id);
      this.s.run('INSERT INTO conversations VALUES(?,?,?,?)',this.c.appId,out.chat,remote,local.task);
      this.s.run('INSERT INTO task_threads VALUES(?,?,?,?)',this.c.appId,out.chat,remote,local.task);
      this.queueLocal(local.task,remote,'local:start:'+local.request_id,local.request);
      this.record({app:this.c.appId,chat:out.chat,id:remote,sender:this.c.botId,senderType:'app'},remote,out.body);
      return;
    }
    const route=this.s.one('SELECT * FROM conversations WHERE app=? AND chat=? AND root=?',this.c.appId,out.chat,out.root);
    if(route)this.record({app:this.c.appId,chat:out.chat,id:remote,sender:this.c.botId,senderType:'app'},out.root,decode(out.body).body);
  }
}

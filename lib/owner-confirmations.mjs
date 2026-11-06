import {randomUUID,createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
export class OwnerConfirmations {
 constructor(s,c){this.s=s;this.c=c;s.db.exec(`CREATE TABLE IF NOT EXISTS owner_confirmations(id TEXT PRIMARY KEY,task TEXT NOT NULL,root TEXT NOT NULL,owner TEXT NOT NULL,scope TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL,outbox TEXT NOT NULL,answer TEXT,created INTEGER NOT NULL,exchange_id TEXT,mode TEXT NOT NULL DEFAULT 'conversation',dm_chat TEXT);`);}
 request(task,root,scope,{exchange=null,mode='conversation'}={}){
  if(typeof scope!=='string'||!scope.trim()||scope.length>6000)throw Error('确认事项必须具体且不超过6000字');
  const id='A-'+randomUUID().slice(0,12),digest=hash(scope);
  const old=this.s.one("SELECT * FROM owner_confirmations WHERE task=? AND digest=? AND state='pending' AND mode=?",task.id,digest,mode);if(old&&mode==='conversation')return old.id;
  const out=this.s.sendDirect(this.c.owner,`需要你确认一项高风险操作｜${id}\n任务：${task.title}\n${scope}\n\n同意此项请回复 /confirm ${id}；不同意回复 /reject ${id}。未明确同意不会执行；本次确认不授予其他操作。`);
  this.s.run('INSERT INTO owner_confirmations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,task.id,root,this.c.owner,scope,digest,'pending',out,null,Date.now(),exchange,mode,null);
  return id;
 }
 receive(e){
  const m=e.text.trim().match(/^\/(confirm|reject) (A-[a-f0-9-]{12})$/);if(!m)return null;
  const row=this.s.one('SELECT * FROM owner_confirmations WHERE id=?',m[2]);if(!row)return {ignored:'unknown-confirmation'};
  if(e.app!==this.c.appId||e.chatType!=='p2p'||e.senderType!=='user'||e.sender!==row.owner||(row.dm_chat&&e.chat!==row.dm_chat))return {rejected:'private-owner-only'};
  const out=this.s.one('SELECT state,remote FROM outbox WHERE id=?',row.outbox);if(out?.state!=='sent'||!out.remote)return {rejected:'confirmation-not-delivered'};
  return this.s.tx(()=>{
   if(this.s.one('SELECT state FROM owner_confirmations WHERE id=?',row.id).state!=='pending')return {ignored:'resolved-confirmation'};
   const t=this.s.task(row.task);if(['cancelled','paused','failed','uncertain'].includes(t.state))return {blocked:t.state};
   const approved=m[1]==='confirm';this.s.run('UPDATE owner_confirmations SET state=?,answer=? WHERE id=?',approved?'approved':'rejected',e.id,row.id);
   if(row.mode==='conversation')this.s.queue(t.id,'conversation',{event:{...e,source:'owner-confirmation',text:approved?'本机绑定人已私聊确认以下具体事项。先核对现状，只执行此范围，勿重复已完成操作。':'本机绑定人拒绝以下事项，不得执行；继续其他已授权工作。',ownerConfirmation:{id:row.id,approved,scope:row.scope}},replyRoot:row.root,exchange:row.exchange_id,terminal:false});
   this.s.sendDirect(row.owner,approved?'已收到此项确认，将核对现状后继续原任务。':'已记录拒绝，不执行该项操作。');return {queued:row.mode==='conversation',task:t.id,approved};
  });
 }
 delivered(out,remoteChat){
  if(!remoteChat)return;
  const row=this.s.one('SELECT id FROM owner_confirmations WHERE outbox=?',out.id);if(!row)return;
  this.s.run('UPDATE owner_confirmations SET dm_chat=? WHERE id=?',remoteChat,row.id);
  this.s.run('INSERT OR IGNORE INTO meta VALUES(?,?)','sync:dm:'+remoteChat,String(Math.floor(Date.now()/1000)));
 }

 async native(task,input,method,params,signal){
  const allowed=['item/commandExecution/requestApproval','item/fileChange/requestApproval'];
  if(!allowed.includes(method))return undefined;
  const detail=JSON.stringify({method,command:params.command,reason:params.reason,grantRoot:params.grantRoot,changes:params.changes}).replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi,'$1[隐藏]');
  const id=this.s.tx(()=>this.request(task,input.replyRoot,'执行器要求确认以下操作，尚未执行：\n'+detail.slice(0,5000),{exchange:input.exchange,mode:'native'}));
  try{
   while(!signal?.aborted){
    const row=this.s.one('SELECT state FROM owner_confirmations WHERE id=?',id);
    if(row.state==='approved')return {decision:'accept'};
    if(row.state!=='pending')return {decision:'decline'};
    await new Promise(r=>setTimeout(r,250));
   }
   return {decision:'decline'};
  }finally{this.s.run("UPDATE owner_confirmations SET state='expired' WHERE id=? AND state='pending'",id);}
 }
 interruptNative(){this.s.run("UPDATE owner_confirmations SET state='expired' WHERE mode='native' AND state='pending'");}

}

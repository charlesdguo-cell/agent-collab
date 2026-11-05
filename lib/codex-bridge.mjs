import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// A bridge is not a permission authority or a human-input UI. Resolve known
// requests with explicit non-grant responses so the model can report/adapt.
export function unattendedResponse(method){
  if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(method))return {decision:'decline'};
  if(method==='item/permissions/requestApproval')return {permissions:{},scope:'turn'};
  if(method==='mcpServer/elicitation/request')return {action:'decline',content:null};
  if(['item/tool/requestUserInput','tool/requestUserInput'].includes(method))return {answers:{}};
  if(method==='item/tool/call')return {success:false,contentItems:[{type:'inputText',text:'Agent Collab has no handler for this client tool. No action was executed. Use available local tools or report the limitation.'}]};
  return undefined;
}

// Use the installed CLI's configuration/auth. Never attach the caller's live thread.
export class CodexBridge {
  constructor({config={},project,env={},notify=()=>{}}={}) {
    const environment={...process.env,...env};delete environment.CODEX_THREAD_ID;
    this.pending=new Map();this.serial=0;this.notify=notify;this.clientRequests=0;this.requestMethods=[];
    this.child=spawn(config.codexBin||'codex',['app-server','--listen','stdio://'],{cwd:project,env:environment,stdio:['pipe','pipe','pipe']});
    this.child.stderr.resume();this.child.stdin.on('error',()=>{});
    this.lines=createInterface({input:this.child.stdout});
    this.lines.on('line',line=>{
      if(line.length>10*1024*1024)return this.fail(Error('Codex 响应超出限制'));
      let m;try{m=JSON.parse(line);}catch{return;}
      if(m.method && m.id!==undefined){
        const method=/^[a-zA-Z0-9_\/-]{1,160}$/.test(m.method)?m.method:'unknown';
        this.requestMethods.push(method);
        const response=unattendedResponse(method);
        if(response!==undefined&&++this.clientRequests<=8){
          this.send({id:m.id,result:response});
          try{this.notify('bridge/clientRequestDeclined',{method});}catch{this.fail(Error('无法保存 Codex 交互状态'));}
        }else{
          this.send({id:m.id,error:{code:-32601,message:'Unsupported client interaction'}});
          this.fail(Error('Codex 客户端交互未完成（'+method+'）；未授予权限，未自动重试'));
        }
      }else if(m.method){try{this.notify(m.method,m.params||{});}catch{this.fail(Error('无法保存 Codex 进展'));}}
      else {const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error('Codex 协议请求失败：'+p.method)):p.resolve(m.result);}}
    });
    this.child.on('error',()=>this.fail(Error('无法启动本机 Codex，请检查 CLI 路径')));
    this.child.on('close',()=>this.fail(Error('Codex 连接已关闭')));
  }
  send(m){if(!this.child.stdin.destroyed)this.child.stdin.write(JSON.stringify(m)+'\n');}
  fail(error){this.error=error;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.onFailure?.(error);}
  call(method,params={},timeout=15000){
    if(this.error)return Promise.reject(this.error);
    return new Promise((resolve,reject)=>{const id=++this.serial;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Codex 请求超时：'+method));},timeout);this.pending.set(id,{resolve,reject,timer,method});this.send({id,method,params});});
  }
  async init(){await this.call('initialize',{clientInfo:{name:'agent_collab',title:'Agent Collab',version:'0.1.0'}});this.send({method:'initialized'});}
  async close(){
    if(this.child.exitCode!==null)return;
    this.child.kill('SIGTERM');const kill=setTimeout(()=>this.child.kill('SIGKILL'),2000);kill.unref();
    await new Promise(r=>this.child.once('close',r));clearTimeout(kill);this.lines.close();
  }
}
export async function bridgeDoctor(config){
  const client=new CodexBridge({config,project:config.project});
  try{await client.init();const a=await client.call('account/read',{refreshToken:false});return {ready:a.requiresOpenaiAuth===false||!!a.account,protocol:true,modelTaskVerified:false};}
  catch(e){return {ready:false,error:e.message,modelTaskVerified:false};}finally{await client.close();}
}
export async function runConversation(task,kind,prompt,{config={},env={},signal,onSession=()=>{}}={}) {
  if(task.runtime&&task.runtime!=='codex')throw Error('普通话题桥当前仅支持 Codex；未切换到另一种 Agent 执行');
  let finish,fail,threadId,turnId,text='';
  const completed=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});completed.catch(()=>{});
  const client=new CodexBridge({config,project:task.project,env,notify(method,p){
    if(p.threadId && threadId && p.threadId!==threadId)return;
    if(method==='turn/started')turnId=p.turn?.id;
    if(method==='item/completed' && p.item?.type==='agentMessage')text=p.item.text||text;
    if(method==='turn/completed')p.turn?.status==='completed'?finish():fail(Error('Codex 本轮未成功完成；请核对已发生操作'));
  }});
  client.onFailure=fail;
  const stop=()=>{if(threadId&&turnId)client.call('turn/interrupt',{threadId,turnId},2000).catch(()=>{});fail(Error('本轮已中断；未自动重试'));};
  signal?.addEventListener('abort',stop,{once:true});const timer=setTimeout(stop,config.timeoutMs||900000);
  try{
    if(signal?.aborted)throw Error('本轮已取消');
    await client.init();
    const options={cwd:task.project};
    if(config.model)options.model=config.model;
    // Omitted settings inherit the installer's existing Codex policy.
    if(config.sandbox)options.sandbox=config.sandbox;
    if(config.approvalPolicy)options.approvalPolicy=config.approvalPolicy;
    if(task.session)options.threadId=task.session;
    const result=await client.call(task.session?'thread/resume':'thread/start',options,30000);
    threadId=result.thread.id;onSession(threadId);
    await client.call('turn/start',{threadId,input:[{type:'text',text:prompt}],outputSchema:{type:'object',properties:{reply:{type:'string'},next:{type:['object','null'],properties:{recipient:{type:'string'},body:{type:'string'},channel:{type:['string','null'],enum:['topic','private',null]}},required:['recipient','body','channel'],additionalProperties:false}},required:['reply','next'],additionalProperties:false}},30000);
    await completed;return {session:threadId,text,completed:true,clientRequests:client.requestMethods};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);await client.close();}
}

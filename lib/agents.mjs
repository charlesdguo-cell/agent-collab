import { spawn } from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function invocation(task, kind, config={}) {
  const discuss=kind==='discuss';
  const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
  if(task.runtime==='codex') {
    const args=['exec'];
    if(task.session)args.push('resume',task.session);
    args.push('--json','--ignore-user-config');
    if(config.model)args.push('-m',config.model);
    // Config overrides also apply to resume; do not rely on stored sandbox settings.
    args.push('-c',`sandbox_mode="${discuss?'read-only':(config.sandbox||'workspace-write')}"`);
    if(!discuss)args.push('-c',`mcp_servers.team_consult.command=${JSON.stringify(process.execPath)}`,
      '-c',`mcp_servers.team_consult.args=${JSON.stringify([cli,'mcp'])}`,
      '-c','mcp_servers.team_consult.env_vars=["AGENT_COLLAB_URL","AGENT_COLLAB_TOKEN"]',
      '-c','mcp_servers.team_consult.required=true',
      '-c','mcp_servers.team_consult.enabled_tools=["consult_open","consult_revise","consult_status"]',
      '-c','mcp_servers.team_consult.default_tools_approval_mode="prompt"',
      ...['consult_open','consult_revise','consult_status'].flatMap(name=>[
        '-c',`mcp_servers.team_consult.tools.${name}.approval_mode="approve"`]));
    // Codex validates the transport even for a disabled server. Retain a valid
    // stdio definition while disabling access on read-only discussion turns.
    else args.push('-c',`mcp_servers.team_consult.command=${JSON.stringify(process.execPath)}`,
      '-c',`mcp_servers.team_consult.args=${JSON.stringify([cli,'mcp'])}`,
      '-c','mcp_servers.team_consult.enabled=false');
    args.push('-');return {bin:config.codexBin||'codex',args};
  }
  const args=['-p','--output-format','stream-json','--verbose','--strict-mcp-config'];
  if(config.model)args.push('--model',config.model);
  if(task.session)args.push('--resume',task.session);
  if(discuss)args.push('--tools','Read,Glob,Grep','--permission-mode','plan','--mcp-config','{"mcpServers":{}}');
  else args.push('--permission-mode','acceptEdits','--mcp-config',JSON.stringify({mcpServers:{team_consult:{command:process.execPath,args:[cli,'mcp']}}}),'--allowedTools','mcp__team_consult__consult_open,mcp__team_consult__consult_revise,mcp__team_consult__consult_status');
  return {bin:config.claudeBin||'claude',args};
}

export function parseAgentEvent(runtime,e,state) {
  if(runtime==='codex') {
    if(e.type==='thread.started')state.session=e.thread_id;
    if(e.type==='item.completed' && e.item?.type==='agent_message')state.text=e.item.text;
    if(e.type==='turn.completed')state.completed=true;
    if(e.type==='turn.failed' || e.type==='error')state.error='Codex 执行失败，请检查本机诊断';
  } else {
    if(e.type==='system' && e.subtype==='init')state.session=e.session_id;
    if(e.type==='result') {
      state.session=e.session_id||state.session;
      state.text=e.result||'';state.completed=!e.is_error && e.subtype==='success';
      if(!state.completed)state.error='Claude 执行失败或达到限制，请检查本机诊断';
    }
  }
}

export function runAgent(task,kind,prompt,{config={},env={},onSession=()=>{},signal}={}) {
  const {bin,args}=invocation(task,kind,config);
  return new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{cwd:task.project,env:{...process.env,...env},stdio:['pipe','pipe','pipe'],shell:false});
    const state={text:'',session:task.session,completed:false};let buf='',total=0;
    let aborted=false,killTimer;
    const stop=()=>{aborted=true;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);killTimer.unref();};signal?.addEventListener('abort',stop,{once:true});
    if(signal?.aborted)stop();
    const timer=setTimeout(stop,config.timeoutMs||900000);
    function consume(line){
      let e;try{e=JSON.parse(line);}catch{return;}
      const before=state.session;parseAgentEvent(task.runtime,e,state);
      if(state.session!==before)try{onSession(state.session);}catch{state.error='无法持久保存会话 ID，已停止';stop();}
    }
    child.stdout.on('data',chunk=>{
      total+=chunk.length;if(total>20*1024*1024){stop();return;}
      buf+=chunk.toString();let end;
      while((end=buf.indexOf('\n'))>=0){const line=buf.slice(0,end);buf=buf.slice(end+1);
        consume(line);
      }
    });
    // Raw stderr may contain auth/provider material: do not forward it to group chat.
    child.stderr.resume();
    child.stdin.on('error',()=>{});child.stdin.end(prompt);
    child.on('error',e=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(Error(e.code==='ENOENT'?`${task.runtime} 尚未安装或路径无效`:'无法启动 Agent'));});
    child.on('close',code=>{
      clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',stop);if(buf.trim())consume(buf);
      if(aborted)return reject(Error('Agent 已中断，需检查执行结果后再继续'));
      if(code!==0 || state.error || !state.completed || !state.session)return reject(Error(state.error||'Agent 未返回完整成功回执'));
      resolve(state);
    });
  });
}

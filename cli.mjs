#!/usr/bin/env node
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,unlinkSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {Store} from './lib/store.mjs';
import {home,readConfig,safeProject,saveConfig} from './lib/config.mjs';
import {startTaskApi} from './lib/local-api.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const [cmd,...args]=process.argv.slice(2);
const db=()=>new Store(join(home(),'state.sqlite'));
async function stdin(){let s='';for await(const c of process.stdin){s+=c;if(s.length>65536)throw Error('输入过大');}return JSON.parse(s);}
function lock(){
  mkdirSync(home(),{recursive:true,mode:0o700});const p=join(home(),'service.lock');
  try {const fd=openSync(p,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);}
  catch {
    const pid=Number(readFileSync(p,'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw Error('服务锁无效，请在本机诊断后移除');
    try{process.kill(pid,0);throw Error('协作服务已在运行');}catch(e){if(e.code!=='ESRCH')throw e;}
    unlinkSync(p);const fd=openSync(p,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
  }
  const unlock=()=>{try{if(readFileSync(p,'utf8')===String(process.pid))unlinkSync(p);}catch{}};
  process.on('exit',unlock);return unlock;
}
function installService(){
  if(process.platform!=='darwin')throw Error('当前后台安装器仅完成 macOS；其他平台尚待验收');
  const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const folder=join(homedir(),'Library/LaunchAgents');mkdirSync(folder,{recursive:true});mkdirSync(home(),{recursive:true,mode:0o700});
  const label=process.env.AGENT_COLLAB_SERVICE_LABEL||'ai.ikigen.agent-collab';
  if(!/^ai\.ikigen\.agent-collab(?:\.[a-z0-9-]+)?$/.test(label))throw Error('无效服务名称');
  const file=join(folder,label+'.plist');
  if(existsSync(file))throw Error('已有后台服务文件，未覆盖；请核对原配置');
  const domain=`gui/${process.getuid()}`;
  const check=spawnSync('launchctl',['print',`${domain}/${label}`],{stdio:'ignore'});
  if(check.status===0)throw Error('后台服务已安装；未替换运行进程或配置，请先核对现有版本');
  const xml=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${esc(label)}</string><key>ProgramArguments</key><array><string>${esc(process.execPath)}</string><string>${esc(join(here,'cli.mjs'))}</string><string>start</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(process.env.PATH)}</string><key>AGENT_COLLAB_HOME</key><string>${esc(home())}</string></dict><key>StandardOutPath</key><string>${esc(join(home(),'service.log'))}</string><key>StandardErrorPath</key><string>${esc(join(home(),'service-error.log'))}</string></dict></plist>`;
  writeFileSync(file,xml,{mode:0o600});
  const r=spawnSync('launchctl',['bootstrap',domain,file],{encoding:'utf8'});
  if(r.status!==0)throw Error('后台服务注册失败，请查看本机系统日志');
  console.log('后台服务已注册；请用 doctor 检查，并在群中验证收发。注册不等于验收成功。');
}

async function main(){
  if(cmd==='mcp'){await (await import('./lib/mcp.mjs')).mcp();return;}
  if(cmd==='setup'){await (await import('./lib/setup.mjs')).setup();return;}
  if(cmd==='consult'){
    if(!process.env.AGENT_COLLAB_URL?.startsWith('http://127.0.0.1:')||!process.env.AGENT_COLLAB_TOKEN)throw Error('当前会话未绑定协作服务');
    if(!['open','revise','status'].includes(args[0]))throw Error('未知咨询操作');
    const body=args[0]==='status'?{}:await stdin();
    const r=await fetch(process.env.AGENT_COLLAB_URL+'/consult/'+args[0],{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.AGENT_COLLAB_TOKEN},body:JSON.stringify(body)});
    const data=await r.json();console.log(JSON.stringify(data));if(!data.ok)process.exitCode=1;return;
  }
  if(cmd==='doctor'){
    const c=readConfig();const checks={configured:true,node:process.versions.node,project:c.project};
    for(const runtime of ['codex','claude']){
      const bin=c[runtime+'Bin']||runtime;
      const installed=spawnSync(bin,['--version'],{encoding:'utf8',timeout:10000}).status===0;
      const authenticated=installed && spawnSync(bin,runtime==='codex'?['login','status']:['auth','status'],{encoding:'utf8',timeout:15000}).status===0;
      checks[runtime]={installed,authenticated};
    }
    if(c.runtime==='codex')checks.bridge=await (await import('./lib/codex-bridge.mjs')).bridgeDoctor(c);
    try{
      const {Feishu}=await import('./lib/feishu.mjs');const f=new Feishu(c);
      const bot=await Feishu.discover(c.appId,c.appSecret);
      const roster=await f.bots(c.chatId);await f.history(c.chatId,{limit:1});
      checks.feishu={ready:bot.botId===c.botId&&roster.some(b=>b.bot_id===c.botId),identityMatched:bot.botId===c.botId,memberDirectory:true,historyReadable:true,eventDeliveryVerified:false};
      try{const announcement=await f.announcement(c.chatId);checks.announcement={ready:true,revision:announcement.revision,characters:announcement.text.length,source:announcement.source};}
      catch(e){checks.announcement={ready:false,error:e.message};}
    }catch{checks.feishu={ready:false,error:'请核对机器人身份、入群状态、群成员与历史读取权限；凭据未输出'};}
    const s=db();checks.uncertain=s.one("SELECT COUNT(*) n FROM jobs WHERE state='uncertain'").n;checks.failedDeliveries=s.one("SELECT COUNT(*) n FROM outbox WHERE state='failed'").n;checks.messageGap=s.one("SELECT value FROM meta WHERE key='sync:error'")?.value||null;s.close();
    console.log(JSON.stringify(checks,null,2));if(!checks[c.runtime].authenticated || !checks.feishu.ready || checks.announcement?.ready===false || (c.runtime==='codex'&&!checks.bridge.ready))process.exitCode=1;return;
  }
  if(cmd==='install-service'){readConfig();installService();return;}
  if(cmd==='task'){
    const c=readConfig(),s=db();try {
      if(args[0]==='new'){
        const input=await stdin();const task=s.createTask({title:input.title,project:safeProject(c,input.project||c.project),runtime:c.runtime,owner:c.owner});
        s.queue(task.id,'execute',{request:input.request||input.title});console.log(JSON.stringify(task));
      }else if(args[0]==='list')console.log(JSON.stringify(s.all('SELECT id,title,state,runtime FROM tasks')));
      else throw Error('task new 从 stdin 读取 {title,request}；task list 查看任务');
    }finally{s.close();}return;
  }
  if(cmd==='topic'){
    const c=readConfig(),s=db();
    try{
      const {Conversations}=await import('./lib/conversations.mjs'),topics=new Conversations(s,c);
      if(args[0]==='start')console.log(JSON.stringify(topics.localStart(await stdin())));
      else if(args[0]==='reply')console.log(JSON.stringify(topics.localFollow(await stdin())));
      else if(args[0]==='status')console.log(JSON.stringify(topics.localStatus(args[1])));
      else if(args[0]==='members')console.log(JSON.stringify(topics.roles()));
      else throw Error('topic start/reply 从 stdin 读取 JSON；status TASK；members 查看群内名录');
    }finally{s.close();}return;
  }
  if(cmd==='start'){
    const c=readConfig(),unlock=lock(),s=db();
    const {Feishu}=await import('./lib/feishu.mjs'),{Service}=await import('./lib/service.mjs');
    const f=new Feishu(c),service=new Service(s,f,c);service.persistConfig=saveConfig;service.api=await startTaskApi(s,c);
    const recovered=s.recover();if(recovered)console.log(`有 ${recovered} 个中断运行需要核对，未自动重试。`);
    await service.introduce();await service.flush();
    await f.listen(e=>service.receive(e),chat=>service.announcements.refresh({force:true}));
    await service.reconcile();
    const timer=setInterval(()=>service.tick().catch(()=>console.error('本轮处理失败，状态已保留；请检查本机诊断。')),2000);
    const stop=()=>{clearInterval(timer);for(const ctrl of service.active.values())ctrl.abort();f.ws?.close();service.api.server.close();unlock();process.exit(0);};
    process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('exit',unlock);
    console.log('协作服务已启动；请在指定群内验证消息闭环。');return;
  }
  console.log('Agent Collab alpha\nsetup · 本机配置向导\ndoctor · 检查环境\ninstall-service · macOS 后台自启动\nstart · 前台运行\ntopic start/reply/status/members · 本机主动协作\ntask new/list · 旧版任务\nconsult open/revise/status · 供受管 Agent 使用');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    if(path !== ':memory:') mkdirSync(dirname(path), {recursive:true, mode:0o700});
    this.db = new DatabaseSync(path);
    if(path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,project TEXT NOT NULL,
        runtime TEXT NOT NULL,session TEXT,owner TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'ready');
      CREATE UNIQUE INDEX IF NOT EXISTS session_owner ON tasks(runtime,session) WHERE session IS NOT NULL;
      CREATE TABLE IF NOT EXISTS consults(id TEXT PRIMARY KEY,task TEXT NOT NULL REFERENCES tasks(id),
        app TEXT NOT NULL,chat TEXT NOT NULL,root TEXT UNIQUE,approver TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,proposal TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'waiting');
      CREATE TABLE IF NOT EXISTS messages(app TEXT NOT NULL,id TEXT NOT NULL,chat TEXT NOT NULL,
        consult TEXT, sender TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,
        PRIMARY KEY(app,id));
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,task TEXT NOT NULL REFERENCES tasks(id),
        consult TEXT,kind TEXT NOT NULL,input TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,chat TEXT NOT NULL,root TEXT,consult TEXT,
        body TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',remote TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS roles(member TEXT PRIMARY KEY,body TEXT NOT NULL,source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS task_threads(app TEXT NOT NULL,chat TEXT NOT NULL,root TEXT NOT NULL,task TEXT NOT NULL REFERENCES tasks(id),PRIMARY KEY(app,chat,root));`);
  }
  one(sql,...args) {return this.db.prepare(sql).get(...args);}
  all(sql,...args) {return this.db.prepare(sql).all(...args);}
  run(sql,...args) {return this.db.prepare(sql).run(...args);}
  tx(fn) {this.db.exec('BEGIN IMMEDIATE'); try {const x=fn(); this.db.exec('COMMIT'); return x;} catch(e){this.db.exec('ROLLBACK');throw e;}}
  task(id) {const t=this.one('SELECT * FROM tasks WHERE id=?',id);if(!t)throw Error('未知任务');return t;}
  consult(id) {const c=this.one('SELECT * FROM consults WHERE id=?',id);if(!c)throw Error('未知咨询');return c;}
  createTask({title,project,runtime,owner}) {
    if(!['codex','claude'].includes(runtime))throw Error('不支持的 Agent');
    if(!title || !project || !owner)throw Error('缺少任务字段');
    const id='T-'+randomUUID().slice(0,8);
    this.run('INSERT INTO tasks(id,title,project,runtime,owner) VALUES(?,?,?,?,?)',id,title,project,runtime,owner);return this.task(id);
  }
  queue(task,kind,input,consult=null) {
    const id=randomUUID();this.run('INSERT INTO jobs(id,task,consult,kind,input) VALUES(?,?,?,?,?)',id,task,consult,kind,JSON.stringify(input));return id;
  }
  send(chat,root,body,consult=null) {
    const id=randomUUID();this.run('INSERT INTO outbox(id,chat,root,body,consult) VALUES(?,?,?,?,?)',id,chat,root,body,consult);return id;
  }
  open({task,app,chat,approver,proposal}) {
    return this.tx(()=>{
      const t=this.task(task);if(['cancelled','paused'].includes(t.state))throw Error('任务已停止');
      if(!approver?.startsWith('ou_') || !proposal?.trim())throw Error('需要明确负责人和方案');
      const id='C-'+randomUUID().slice(0,8);
      this.run('INSERT INTO consults(id,task,app,chat,approver,proposal) VALUES(?,?,?,?,?,?)',id,task,app,chat,approver,proposal);
      this.run("UPDATE tasks SET state='waiting' WHERE id=?",task);
      this.send(chat,null,`${t.title}｜${task}｜${id} v1\n<at user_id="${approver}">负责人</at>\n${proposal}\n确认执行请回复：/approve ${id} 1；也可以继续提问。`,id);
      return this.consult(id);
    });
  }
  revise(id,proposal) {
    return this.tx(()=>{
      const c=this.consult(id);if(!['waiting','discussing'].includes(c.state))throw Error('当前状态不允许修订');
      if(!proposal?.trim())throw Error('方案不能为空');
      this.run("UPDATE consults SET proposal=?,version=version+1,state='waiting' WHERE id=?",proposal,id);
      this.send(c.chat,c.root,`${id} v${c.version+1}\n${proposal}\n确认：/approve ${id} ${c.version+1}`);
      return this.consult(id);
    });
  }
  resolve(e) {
    const roots=[e.root,e.parent,e.thread].filter(Boolean);
    for(const root of roots) {
      const c=this.one('SELECT * FROM consults WHERE app=? AND chat=? AND root=?',e.app,e.chat,root);
      if(c)return c;
      const m=this.one('SELECT consult FROM messages WHERE app=? AND chat=? AND id=?',e.app,e.chat,root);
      if(m?.consult)return this.consult(m.consult);
    }
    return null;
  }
  resolveTask(e) {
    for(const root of [e.root,e.parent,e.thread].filter(Boolean)){
      const t=this.one('SELECT task FROM task_threads WHERE app=? AND chat=? AND root=?',e.app,e.chat,root);
      if(t)return this.task(t.task);
    }
    return null;
  }
  approve(id,version,sender) {
    const c=this.consult(id), t=this.task(c.task);
    if(c.approver!==sender)throw Error('只有指定负责人可以确认此咨询');
    if(c.version!==version)throw Error('方案版本已变化，请确认最新版本');
    if(!['waiting','discussing'].includes(c.state))throw Error('该咨询已确认或关闭');
    if(['cancelled','paused','uncertain'].includes(t.state))throw Error('任务已停止或需要核对');
    if(this.one("SELECT id FROM jobs WHERE task=? AND state='running'",t.id))throw Error('Agent 正在处理本轮讨论，请等回复后确认最新方案');
    this.run("UPDATE consults SET state='approved' WHERE id=?",id);
    this.run("UPDATE jobs SET state='cancelled' WHERE consult=? AND kind='discuss' AND state='pending'",id);
    const pending=this.one("SELECT id FROM consults WHERE task=? AND state IN ('waiting','discussing')",t.id);
    if(!pending){this.run("UPDATE tasks SET state='ready' WHERE id=?",t.id);this.queue(t.id,'execute',{approvedConsult:id,version,proposal:c.proposal},id);}
  }
  ingest(e,owner) {
    if(e.senderType!=='user')return {ignored:'bot'};
    return this.tx(()=>{
      if(this.one('SELECT id FROM messages WHERE app=? AND id=?',e.app,e.id))return {duplicate:true};
      const c=this.resolve(e);
      const shortcuts={'查看任务':'/tasks','我的任务':'/tasks','帮助':'/help'};
      e={...e,text:shortcuts[e.text]||e.text};
      const linked=c?this.task(c.task):this.resolveTask(e);
      if(linked && ['暂停这个任务','取消这个任务'].includes(e.text))e.text=`/${e.text.startsWith('暂停')?'pause':'cancel'} ${linked.id}`;
      if(linked && e.text==='已核对，继续这个任务')e.text=`/resume ${linked.id}`;
      this.run('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',e.app,e.id,e.chat,c?.id??null,e.sender,e.text,Date.now());
      try {
        if(e.text==='/help'){
          this.send(e.chat,e.root??e.id,'回复咨询话题即可讨论。安装者可说“查看任务”“暂停这个任务”“取消这个任务”。确认执行请引用最新方案并使用附带的 /approve 指令。职责介绍：/role 负责内容。');return {help:true};
        }
        if(e.text.startsWith('/role ') || (!c && /^我(主要)?负责/.test(e.text))){
          this.run('INSERT INTO roles VALUES(?,?,?) ON CONFLICT(member) DO UPDATE SET body=excluded.body,source=excluded.source',e.sender,e.text.replace(/^\/role /,''),e.id);
          this.send(e.chat,e.root??e.id,'已更新你的职责介绍。');return {role:true};
        }
        if(e.text==='/tasks') {
          if(e.sender!==owner)throw Error('只有安装者可以查看全部任务');
          this.send(e.chat,e.root??e.id,this.all('SELECT id,title,state FROM tasks').map(t=>`${t.id} ${t.title} · ${t.state}`).join('\n')||'暂无任务');return {tasks:true};
        }
        const cancel=e.text.match(/^\/(cancel|pause) (T-[\w-]+)$/);
        if(cancel){
          const t=this.task(cancel[2]);if(e.sender!==t.owner)throw Error('只有任务所有者可以停止任务');
          const state=cancel[1]==='cancel'?'cancelled':'paused';
          this.run('UPDATE tasks SET state=? WHERE id=?',state,t.id);
          this.run("UPDATE jobs SET state='cancelled' WHERE task=? AND state='pending'",t.id);
          if(state==='cancelled')this.run("UPDATE consults SET state='cancelled' WHERE task=? AND state IN ('waiting','discussing','approved')",t.id);
          this.send(e.chat,e.root??e.id,'已停止排队工作；正在运行的进程将收到中断。');return {stop:t.id};
        }
        const resume=e.text.match(/^\/resume (T-[\w-]+)$/);
        if(resume){
          const t=this.task(resume[1]);if(e.sender!==t.owner)throw Error('只有任务所有者可以恢复任务');
          if(!['paused','failed','uncertain'].includes(t.state))throw Error('只有暂停、失败或已核对的中断任务可恢复；取消任务不可复活');
          if(this.one("SELECT id FROM jobs WHERE task=? AND state='running'",t.id))throw Error('原进程尚未结束，请稍后核对');
          const pending=this.one("SELECT id FROM consults WHERE task=? AND state IN ('waiting','discussing')",t.id);
          this.run('UPDATE tasks SET state=? WHERE id=?',pending?'waiting':'ready',t.id);
          if(!pending)this.queue(t.id,'execute',{request:'所有者已核对中断前发生的操作，要求继续原任务。先检查工作区与原会话现状，不重复已完成操作。',replyRoot:e.root??e.parent??e.id});
          this.send(e.chat,e.root??e.id,pending?'已恢复等待，请在原咨询话题继续讨论。':'已恢复原任务队列，执行前将核对工作区。');return {resumed:t.id};
        }
        const approval=e.text.match(/^\/approve (C-[\w-]+) (\d+)$/);
        if(approval){
          if(!c || c.id!==approval[1])throw Error('请在对应咨询话题内确认，不能跨话题批准');
          this.approve(c.id,Number(approval[2]),e.sender);this.send(e.chat,c.root,'确认已记录；依赖全部满足后恢复原任务。');return {approved:true};
        }
        if(!c){
          if(linked && e.sender===linked.owner){
            if(['ready','done'].includes(linked.state)){
              this.run("UPDATE tasks SET state='ready' WHERE id=?",linked.id);
              this.queue(linked.id,'execute',{request:e.text,replyRoot:e.root??e.parent});return {queued:true,task:linked.id};
            }
            this.send(e.chat,e.root??e.id,'该任务当前等待咨询或需要核对；请到对应咨询话题继续讨论。');return {waiting:true};
          }
          if(e.mentioned)this.send(e.chat,e.root??e.id,'请回复具体任务的咨询话题；查看任务可说“查看任务”，新建可说“新任务：内容”。');return {unrouted:true};
        }
        const t=this.task(c.task);
        if(!['waiting','discussing'].includes(c.state) || ['cancelled','paused','uncertain'].includes(t.state)){
          this.send(e.chat,c.root,'该咨询当前不接受续跑；请由任务所有者检查状态。');return {closed:true};
        }
        this.run("UPDATE consults SET state='discussing' WHERE id=?",c.id);
        this.queue(c.task,'discuss',{sender:e.sender,text:e.text,consult:c.id,version:c.version},c.id);
        return {queued:true,task:c.task};
      }catch(err){this.send(e.chat,e.root??e.id,err.message);return {rejected:err.message};}
    });
  }
  claimJob() {
    return this.tx(()=>{
      const job=this.one(`SELECT j.* FROM jobs j JOIN tasks t ON j.task=t.id WHERE j.state='pending'
        AND t.state NOT IN ('cancelled','paused','uncertain','failed')
        AND (j.kind IN ('discuss','conversation') OR t.state='ready')
        AND NOT EXISTS(SELECT 1 FROM jobs active WHERE active.task=j.task AND active.state='running') ORDER BY j.rowid LIMIT 1`);
      if(job)this.run("UPDATE jobs SET state='running' WHERE id=?",job.id);return job;
    });
  }
  recover() {
    return this.tx(()=>{
      const rows=this.all("SELECT * FROM jobs WHERE state='running'");
      for(const j of rows){this.run("UPDATE jobs SET state='uncertain',error='进程中断；执行可能已发生，禁止自动重试' WHERE id=?",j.id);this.run("UPDATE tasks SET state='uncertain' WHERE id=?",j.task);}
      return rows.length;
    });
  }
  delivered(id,remote,app) {
    this.tx(()=>{
      const out=this.one('SELECT * FROM outbox WHERE id=?',id);
      this.run("UPDATE outbox SET state='sent',remote=?,error=NULL WHERE id=?",remote,id);
      if(out.consult && !out.root)this.run('UPDATE consults SET root=? WHERE id=?',remote,out.consult);
      const c=out.consult?this.consult(out.consult):this.one('SELECT * FROM consults WHERE root=? AND app=? AND chat=?',out.root,app,out.chat);
      this.run('INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?,?,?)',app,remote,out.chat,c?.id??null,'bot',out.body,Date.now());
    });
  }
  close(){this.db.close();}
}

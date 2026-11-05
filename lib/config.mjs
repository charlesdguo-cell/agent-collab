import { homedir } from 'node:os';
import { resolve,join,isAbsolute } from 'node:path';
import { readFileSync,writeFileSync,mkdirSync,chmodSync,realpathSync,statSync,renameSync } from 'node:fs';
export const home=()=>process.env.AGENT_COLLAB_HOME||join(homedir(),'.agent-collab');
export function validate(c) {
  for(const [key,prefix] of [['appId','cli_'],['botId','ou_'],['chatId','oc_'],['owner','ou_']])if(!c[key]?.startsWith(prefix))throw Error(`请填写有效 ${key}`);
  if(typeof c.appSecret!=='string'||c.appSecret.length<8)throw Error('请填写 App Secret');
  if(!['codex','claude'].includes(c.runtime))throw Error('请选择 Codex 或 Claude');
  if(!isAbsolute(c.project)||!statSync(c.project).isDirectory())throw Error('项目目录必须是现有绝对路径');
  c.project=realpathSync(c.project);return c;
}
export function saveConfig(c) {
  validate(c);mkdirSync(home(),{recursive:true,mode:0o700});chmodSync(home(),0o700);
  const p=join(home(),'config.json');writeFileSync(p+'.tmp',JSON.stringify(c,null,2),{mode:0o600});chmodSync(p+'.tmp',0o600);renameSync(p+'.tmp',p);
}
export const readConfig=()=>validate(JSON.parse(readFileSync(join(home(),'config.json'),'utf8')));

export function safeProject(c,p){const path=realpathSync(resolve(p));if(path!==c.project)throw Error('该项目未在本机配置中授权');return path;}

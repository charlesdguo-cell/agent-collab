#!/usr/bin/env python3
"""Install one immutable local runtime and its discoverable Skill; never start a bot."""
import argparse,hashlib,json,os,shutil,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path.home()/'.local/share/agent-collab');p.add_argument('--skill-dir',type=Path,default=Path.home()/'.agents/skills/agent-collab');p.add_argument('--activate-upgrade',action='store_true');p.add_argument('--stage-only',action='store_true');p.add_argument('--state-dir',type=Path,default=Path(os.environ.get('AGENT_COLLAB_HOME',str(Path.home()/'.agent-collab'))));p.add_argument('--service-label',default=os.environ.get('AGENT_COLLAB_SERVICE_LABEL','ai.ikigen.agent-collab'));p.add_argument('--enable-owner-autonomy',action='store_true',help='Explicit local-owner authorization for routine host operations, high risk confirmed privately');a=p.parse_args()
src=Path(__file__).resolve().parents[1];version=json.loads((src/'package.json').read_text())['version']
node=shutil.which('node');npm=shutil.which('npm')
if not node or not npm:raise SystemExit('Node.js 24+ and npm are required; install them on this computer first.')
if int(subprocess.check_output([node,'-p','process.versions.node.split(".")[0]'],text=True).strip())<24:raise SystemExit('Node.js 24+ required')
files={}
for n in ['cli.mjs','package.json','npm-shrinkwrap.json','README.md','AGENTS.md','lib','skills','scripts']:
 q=src/n
 for f in ([q] if q.is_file() else sorted(q.rglob('*'))):
  if '__pycache__' in f.parts or f.suffix=='.pyc':continue
  if f.is_symlink():raise SystemExit('Source symlink not allowed')
  if f.is_file():files[str(f.relative_to(src))]=hashlib.sha256(f.read_bytes()).hexdigest()
root=a.root.expanduser().absolute();release=root/'releases'/version;link=a.skill_dir.expanduser().absolute();current=root/'current'
links={link:current/'skills/agent-collab',link.parent/'team-consult':current/'skills/team-consult'}
for dest,target in links.items():
 if dest.exists() or dest.is_symlink():
  if not dest.is_symlink() or os.readlink(dest)!=str(target):raise SystemExit('Existing unrelated Skill preserved: '+str(dest))
if current.exists() and not current.is_symlink():raise SystemExit('Unmanaged current path preserved')
service=Path.home()/'Library/LaunchAgents'/(a.service_label+'.plist')
managed_upgrade=bool(service.exists() and a.activate_upgrade)
if current.is_symlink() and current.resolve()!=release and not a.stage_only:
 if not a.activate_upgrade:raise SystemExit('Existing active version preserved. Read upgrade instructions before using --activate-upgrade.')
 if current.resolve().parent!=root/'releases':raise SystemExit('Unmanaged current link preserved')
if release.exists():
 receipt=release/'install-receipt.json'
 if not receipt.exists() or json.loads(receipt.read_text())['files']!=files:raise SystemExit('Incomplete or different existing release preserved; inspect it before retrying')
 for n,h in files.items():
  if hashlib.sha256((release/n).read_bytes()).hexdigest()!=h:raise SystemExit('Installed file modified; preserved')
else:
 (root/'releases').mkdir(parents=True,exist_ok=True)
 staging=Path(tempfile.mkdtemp(prefix=version+'.staging-',dir=root/'releases'))
 try:
  for n in files:
   dest=staging/n;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src/n,dest)
  subprocess.run([npm,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],cwd=staging,check=True)
  (staging/'install-receipt.json').write_text(json.dumps({'version':version,'files':files},indent=2)+'\n')
  staging.rename(release)
 finally:
  if staging.exists():shutil.rmtree(staging)
if a.stage_only or managed_upgrade:
 if managed_upgrade and not a.stage_only:
  args=['python3',str(release/'scripts/upgrade.py'),'--root',str(root),'--release',str(release),'--state-dir',str(a.state_dir),'--service-label',a.service_label]
  if a.enable_owner_autonomy:args.append('--owner-autonomy')
  log=a.state_dir/'maintenance.log';log.parent.mkdir(parents=True,exist_ok=True)
  with open(log,'ab') as out:subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=out,stderr=out,start_new_session=True)
 print(json.dumps({'installed':True,'version':version,'activation':'queued-after-idle' if managed_upgrade and not a.stage_only else 'not-requested','runtime':str(release),'receipt':str(a.state_dir/'maintenance-status.json')}))
 raise SystemExit(0)
if not current.is_symlink() or current.resolve()!=release:
 nextlink=root/'current.next'
 if nextlink.exists() or nextlink.is_symlink():raise SystemExit('Existing current.next preserved; inspect interrupted activation')
 nextlink.symlink_to(release,target_is_directory=True);os.replace(nextlink,current)
for dest,target in links.items():
 dest.parent.mkdir(parents=True,exist_ok=True)
 if not dest.is_symlink():dest.symlink_to(target,target_is_directory=True)
print(json.dumps({'installed':True,'configured':False,'running':False,'version':version,'runtime':str(release),'skills':[str(x) for x in links],'next':'Read installed agent-collab SKILL.md and complete configuration, doctor and automatic service checks.'}))

if a.enable_owner_autonomy:
 config=a.state_dir/'config.json'
 if not config.exists():raise SystemExit('Runtime installed; configure identity before enabling autonomy')
 c=json.loads(config.read_text());c['executionMode']='owner-autonomy';tmp=config.with_suffix('.next');tmp.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n');tmp.chmod(0o600);os.replace(tmp,config)

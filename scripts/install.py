#!/usr/bin/env python3
"""Install one immutable local runtime and its discoverable Skill; never start a bot."""
import argparse,hashlib,json,os,shutil,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path.home()/'.local/share/agent-collab');p.add_argument('--skill-dir',type=Path,default=Path.home()/'.agents/skills/agent-collab');p.add_argument('--activate-upgrade',action='store_true');a=p.parse_args()
src=Path(__file__).resolve().parents[1];version=json.loads((src/'package.json').read_text())['version']
node=shutil.which('node');npm=shutil.which('npm')
if not node or not npm:raise SystemExit('Node.js 24+ and npm are required; install them on this computer first.')
if int(subprocess.check_output([node,'-p','process.versions.node.split(".")[0]'],text=True).strip())<24:raise SystemExit('Node.js 24+ required')
files={}
for n in ['cli.mjs','package.json','npm-shrinkwrap.json','README.md','AGENTS.md','lib','skills']:
 q=src/n
 for f in ([q] if q.is_file() else sorted(q.rglob('*'))):
  if f.is_symlink():raise SystemExit('Source symlink not allowed')
  if f.is_file():files[str(f.relative_to(src))]=hashlib.sha256(f.read_bytes()).hexdigest()
root=a.root.expanduser().absolute();release=root/'releases'/version;link=a.skill_dir.expanduser().absolute();current=root/'current'
links={link:current/'skills/agent-collab',link.parent/'team-consult':current/'skills/team-consult'}
for dest,target in links.items():
 if dest.exists() or dest.is_symlink():
  if not dest.is_symlink() or os.readlink(dest)!=str(target):raise SystemExit('Existing unrelated Skill preserved: '+str(dest))
if current.exists() and not current.is_symlink():raise SystemExit('Unmanaged current path preserved')
if current.is_symlink() and current.resolve()!=release:
 if not a.activate_upgrade:raise SystemExit('Existing active version preserved. Read upgrade instructions before using --activate-upgrade.')
 if (Path.home()/'Library/LaunchAgents/ai.ikigen.agent-collab.plist').exists():raise SystemExit('Existing service preserved. This installer cannot upgrade a configured background service.')
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
if not current.is_symlink() or current.resolve()!=release:
 nextlink=root/'current.next'
 if nextlink.exists() or nextlink.is_symlink():raise SystemExit('Existing current.next preserved; inspect interrupted activation')
 nextlink.symlink_to(release,target_is_directory=True);os.replace(nextlink,current)
for dest,target in links.items():
 dest.parent.mkdir(parents=True,exist_ok=True)
 if not dest.is_symlink():dest.symlink_to(target,target_is_directory=True)
print(json.dumps({'installed':True,'configured':False,'running':False,'version':version,'runtime':str(release),'skills':[str(x) for x in links],'next':'Read installed agent-collab SKILL.md and complete configuration, doctor and automatic service checks.'}))

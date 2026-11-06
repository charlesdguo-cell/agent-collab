#!/usr/bin/env python3
"""Drain model work, then atomically activate an already installed local release."""
import argparse,json,os,plistlib,sqlite3,subprocess,time,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--state-dir',type=Path,required=True);p.add_argument('--service-label',required=True);p.add_argument('--release',type=Path,required=True);p.add_argument('--owner-autonomy',action='store_true');a=p.parse_args()
root=a.root.resolve();release=a.release.resolve();home=a.state_dir.resolve();label=a.service_label
if not label.startswith('ai.ikigen.agent-collab') or '/' in label:raise SystemExit('Invalid service label')
if release.parent!=root/'releases':raise SystemExit('Release outside managed root')
receipt=json.loads((release/'install-receipt.json').read_text())
for name,digest in receipt['files'].items():
 f=release/name
 if not f.resolve().is_relative_to(release) or hashlib.sha256(f.read_bytes()).hexdigest()!=digest:raise SystemExit('Release receipt mismatch')
plist=Path.home()/'Library/LaunchAgents'/f'{label}.plist';old=plist.read_bytes();d=plistlib.loads(old)
if Path(d['ProgramArguments'][1]).resolve().parent.parent!=root/'releases':raise SystemExit('Service belongs to another installation')
if Path(d.get('EnvironmentVariables',{}).get('AGENT_COLLAB_HOME',str(Path.home()/'.agent-collab'))).resolve()!=home:raise SystemExit('Service state identity mismatch')
config=home/'config.json';oldconfig=config.read_bytes();previous=os.readlink(root/'current');domain=f'gui/{os.getuid()}';service=f'{domain}/{label}'
status=home/'maintenance-status.json'
def record(state,**fields):status.write_text(json.dumps({'state':state,'version':receipt['version'],**fields},ensure_ascii=False)+'\n');os.chmod(status,0o600)
c=sqlite3.connect(home/'state.sqlite',timeout=5,isolation_level=None)
if c.execute("SELECT value FROM meta WHERE key='maintenance:draining'").fetchone():raise SystemExit('Another maintenance request exists; inspect it')
c.execute("INSERT INTO meta VALUES('maintenance:draining',?)",(str(os.getpid()),));record('waiting-for-idle')
try:
 for _ in range(1800):
  c.execute('BEGIN IMMEDIATE')
  if not c.execute("SELECT id FROM jobs WHERE state='running' LIMIT 1").fetchone():break
  c.execute('ROLLBACK');time.sleep(1)
 else:raise RuntimeError('Still active after 30 minutes; no process interrupted')
 # Retain the write lock until the old service exits; even older versions cannot
 # race a new claim between the idle check and bootout.
 pid=int((home/'service.lock').read_text());subprocess.run(['launchctl','bootout',service],check=True,capture_output=True)
 for _ in range(100):
  try:os.kill(pid,0)
  except ProcessLookupError:break
  time.sleep(.1)
 else:raise RuntimeError('Old service did not exit; not activating')
 c.execute('COMMIT')
 backup=home/('upgrade-backup-'+str(time.time_ns()));backup.mkdir(mode=0o700)
 (backup/'service.plist').write_bytes(old);(backup/'config.json').write_bytes(oldconfig);os.chmod(backup/'config.json',0o600)
 b=sqlite3.connect(backup/'state.sqlite');c.backup(b);b.close();os.chmod(backup/'state.sqlite',0o600)
 d['ProgramArguments'][1]=str(release/'cli.mjs');tmp=plist.with_suffix('.next');tmp.write_bytes(plistlib.dumps(d));os.chmod(tmp,0o600);os.replace(tmp,plist)
 link=root/'current.next';link.symlink_to(release);os.replace(link,root/'current')
 if a.owner_autonomy:
  cfg=json.loads(oldconfig);cfg['executionMode']='owner-autonomy';tmp=config.with_suffix('.next');tmp.write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+'\n');os.chmod(tmp,0o600);os.replace(tmp,config)
 c.execute("DELETE FROM meta WHERE key='maintenance:draining'")
 subprocess.run(['launchctl','bootstrap',domain,str(plist)],check=True,capture_output=True)
 check=subprocess.run(['launchctl','print',service],capture_output=True,text=True,check=True)
 if str(release/'cli.mjs') not in check.stdout:raise RuntimeError('Service did not select new runtime')
 record('activated',previous=previous,backup=str(backup),ownerAutonomy=a.owner_autonomy)
except Exception as e:
 if c.in_transaction:c.execute('ROLLBACK')
 # Restoring a selection is safe only after stopping any new listener.
 if os.readlink(root/'current')!=previous:
  subprocess.run(['launchctl','bootout',service],capture_output=True);time.sleep(1)
  plist.write_bytes(old);config.write_bytes(oldconfig);link=root/'rollback.next';link.symlink_to(previous);os.replace(link,root/'current')
  subprocess.run(['launchctl','bootstrap',domain,str(plist)],capture_output=True)
 elif subprocess.run(['launchctl','print',service],capture_output=True).returncode!=0:
  subprocess.run(['launchctl','bootstrap',domain,str(plist)],capture_output=True)
 c.execute("DELETE FROM meta WHERE key='maintenance:draining'");record('failed',error=type(e).__name__+': '+str(e));raise
finally:c.close()

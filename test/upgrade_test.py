import unittest,tempfile,subprocess,os,json,sqlite3,plistlib,sys,threading,time,hashlib
from pathlib import Path
SCRIPT=Path(__file__).resolve().parents[1]/'scripts/upgrade.py'
class Upgrade(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.h=Path(self.tmp.name);self.root=self.h/'runtime';self.old=self.root/'releases/old';self.new=self.root/'releases/new'
  for r in [self.old,self.new]:r.mkdir(parents=True);(r/'cli.mjs').write_text('test')
  (self.new/'install-receipt.json').write_text(json.dumps({'version':'new','files':{'cli.mjs':hashlib.sha256(b'test').hexdigest()}}));(self.root/'current').symlink_to(self.old)
  self.state=self.h/'state';self.state.mkdir();(self.state/'config.json').write_text('{"owner":"ou_owner"}');(self.state/'service.lock').write_text('99999999')
  c=sqlite3.connect(self.state/'state.sqlite');c.executescript('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE jobs(id TEXT,state TEXT);INSERT INTO jobs VALUES("original","done");');c.commit();c.close()
  self.plist=self.h/'Library/LaunchAgents/ai.ikigen.agent-collab.plist';self.plist.parent.mkdir(parents=True);self.plist.write_bytes(plistlib.dumps({'ProgramArguments':['node',str(self.old/'cli.mjs'),'start'],'EnvironmentVariables':{'AGENT_COLLAB_HOME':str(self.state)}}))
  b=self.h/'bin';b.mkdir();f=b/'launchctl';f.write_text('#!'+sys.executable+'\n'+'''import os,sys,plistlib
from pathlib import Path
h=Path.home();p=h/'Library/LaunchAgents/ai.ikigen.agent-collab.plist';runtime=plistlib.loads(p.read_bytes())['ProgramArguments'][1]
with open(h/'calls','a') as f:f.write(sys.argv[1]+'\\n')
if sys.argv[1]=='bootstrap' and os.environ.get('FAIL_NEW') and '/new/' in runtime:sys.exit(5)
if sys.argv[1]=='print':print(runtime)
''');f.chmod(0o755);self.env={**os.environ,'HOME':str(self.h),'PATH':str(b)+os.pathsep+os.environ['PATH']}
 def tearDown(self):self.tmp.cleanup()
 def run_upgrade(self,extra=None):return subprocess.run([sys.executable,str(SCRIPT),'--root',str(self.root),'--release',str(self.new),'--state-dir',str(self.state),'--service-label','ai.ikigen.agent-collab','--owner-autonomy'],env={**self.env,**(extra or {})},capture_output=True,text=True,timeout=15)
 def test_idle_switch_preserves_state_and_opt_in(self):
  r=self.run_upgrade();self.assertEqual(r.returncode,0,r.stderr);self.assertEqual((self.root/'current').resolve(),self.new);self.assertEqual(json.loads((self.state/'config.json').read_text())['executionMode'],'owner-autonomy');c=sqlite3.connect(self.state/'state.sqlite');self.assertEqual(c.execute('select * from jobs').fetchall(),[('original','done')]);self.assertIsNone(c.execute("select * from meta where key='maintenance:draining'").fetchone());c.close()
 def test_failed_activation_rolls_back(self):
  r=self.run_upgrade({'FAIL_NEW':'1'});self.assertNotEqual(r.returncode,0);self.assertEqual((self.root/'current').resolve(),self.old);self.assertNotIn('executionMode',json.loads((self.state/'config.json').read_text()));self.assertEqual(json.loads((self.state/'maintenance-status.json').read_text())['state'],'failed')
 def test_busy_model_finishes_before_stop(self):
  c=sqlite3.connect(self.state/'state.sqlite');c.execute('update jobs set state="running"');c.commit();c.close();observed=[]
  def finish():
   time.sleep(1);observed.append(not (self.h/'calls').exists());c=sqlite3.connect(self.state/'state.sqlite');c.execute('update jobs set state="done"');c.commit();c.close()
  t=threading.Thread(target=finish);t.start();r=self.run_upgrade();t.join();self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(observed,[True])
 def test_different_installation_is_untouched(self):
  d=plistlib.loads(self.plist.read_bytes());d['EnvironmentVariables']['AGENT_COLLAB_HOME']='/another/person';self.plist.write_bytes(plistlib.dumps(d));r=self.run_upgrade();self.assertNotEqual(r.returncode,0);self.assertFalse((self.h/'calls').exists());self.assertEqual((self.root/'current').resolve(),self.old)
if __name__=='__main__':unittest.main()

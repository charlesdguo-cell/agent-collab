import unittest,tempfile,subprocess,os,json
from pathlib import Path
SCRIPT=Path(__file__).resolve().parents[1]/'scripts/install.py'
class Installation(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.bin=self.base/'bin';self.bin.mkdir()
  for name,body in [('node','echo 24'),('npm','exit "${FAKE_NPM_EXIT:-0}"')]:
   f=self.bin/name;f.write_text('#!/bin/sh\n'+body+'\n');f.chmod(0o755)
  self.env={**os.environ,'PATH':str(self.bin)+os.pathsep+os.environ['PATH']}
  self.root=self.base/'runtime';self.link=self.base/'skills/agent-collab'
 def tearDown(self):self.tmp.cleanup()
 def run_install(self,**env):
  return subprocess.run(['python3',str(SCRIPT),'--root',str(self.root),'--skill-dir',str(self.link)],env={**self.env,**env},capture_output=True,text=True)
 def test_both_skills_repeat_and_tamper(self):
  r=self.run_install();self.assertEqual(r.returncode,0,r.stderr)
  self.assertTrue(self.link.is_symlink());self.assertTrue((self.link.parent/'team-consult').is_symlink())
  self.assertEqual(self.run_install().returncode,0)
  (self.root/'current/cli.mjs').write_text('changed')
  self.assertNotEqual(self.run_install().returncode,0)
 def test_failed_dependency_install_can_retry(self):
  self.assertNotEqual(self.run_install(FAKE_NPM_EXIT='1').returncode,0)
  self.assertFalse(self.link.exists());self.assertEqual(list((self.root/'releases').iterdir()),[])
  self.assertEqual(self.run_install().returncode,0)
 def test_second_skill_conflict_preserved_before_install(self):
  other=self.link.parent/'team-consult';other.mkdir(parents=True);(other/'keep').write_text('mine')
  self.assertNotEqual(self.run_install().returncode,0)
  self.assertEqual((other/'keep').read_text(),'mine');self.assertFalse(self.root.exists())
if __name__=='__main__':unittest.main()

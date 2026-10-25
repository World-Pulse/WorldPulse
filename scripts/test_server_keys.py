"""
The keys from GitHub into the server's settings (scripts/server-keys.sh), plan 0l, Oct 24, 2026.
Run: python3 -m unittest scripts/test_server_keys.py  (from the repository's top folder)
"""
import os
import stat
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'server-keys.sh')


class ServerKeys(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        open(os.path.join(self.dir, 'docker-compose.prod.yml'), 'w').close()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, text):
        with open(os.path.join(self.dir, name), 'w') as fh:
            fh.write(text)

    def read(self, name):
        with open(os.path.join(self.dir, name)) as fh:
            return fh.read()

    def run_keys(self, lines, via_git_show=False):
        # as the deploy runs it (`bash <(git show origin/main:scripts/server-keys.sh)`), or by path
        cmd = ['bash', '-c', f'bash <(cat {SCRIPT!r})'] if via_git_show else ['bash', SCRIPT]
        return subprocess.run(cmd, input=lines, capture_output=True, text=True, cwd=self.dir)

    def test_writes_the_listed_keys_in_place_and_says_only_their_names(self):
        self.write('.env', "POSTGRES_PASSWORD=abc\nRESEND_API_KEY=\n# a note\nTELEGRAM_CHANNEL='@old'\n")
        r = self.run_keys("RESEND_API_KEY=re_123\nTELEGRAM_CHANNEL=@WorldPulse\nGH_OAUTH_CLIENT_ID=Iv1.abc\n")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.read('.env'),
                         "POSTGRES_PASSWORD=abc\nRESEND_API_KEY='re_123'\n# a note\nTELEGRAM_CHANNEL='@WorldPulse'\n"
                         "# Keys from GitHub Secrets (scripts/server-keys.sh)\nGITHUB_CLIENT_ID='Iv1.abc'\n")
        self.assertEqual(r.stdout.strip(), 'Keys (.env): added GITHUB_CLIENT_ID; updated RESEND_API_KEY, TELEGRAM_CHANNEL')
        for secret in ('re_123', '@WorldPulse', 'Iv1.abc'):
            self.assertNotIn(secret, r.stdout + r.stderr)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.dir, '.env')).st_mode), 0o600)

    def test_the_same_keys_again_change_nothing(self):
        self.write('.env', "RESEND_API_KEY='re_123'\n")
        before = os.stat(os.path.join(self.dir, '.env')).st_mtime_ns
        r = self.run_keys('RESEND_API_KEY=re_123\n')
        self.assertEqual(r.stdout.strip(), 'Keys (.env): already set: RESEND_API_KEY')
        self.assertEqual(os.stat(os.path.join(self.dir, '.env')).st_mtime_ns, before)

    def test_leaves_out_names_not_on_the_list_and_unusable_values(self):
        self.write('.env', 'A=1\n')
        r = self.run_keys("TWITTER_API_KEY=x\nBLUESKY_APP_PASSWORD=it's\nnot a line\nOPENSANCTIONS_API_KEY=\n")
        self.assertEqual(self.read('.env'), 'A=1\n')
        self.assertIn('none handed over', r.stdout)
        self.assertIn('TWITTER_API_KEY', r.stdout)
        self.assertIn('BLUESKY_APP_PASSWORD (empty or not a usable value)', r.stdout)
        self.assertNotIn("it's", r.stdout)

    def test_nothing_handed_over_is_fine(self):
        self.write('.env', 'A=1\n')
        r = self.run_keys('')
        self.assertEqual((r.returncode, r.stdout.strip()), (0, 'Keys: none handed over'))
        self.assertEqual(self.read('.env'), 'A=1\n')

    def test_uses_env_prod_when_there_is_no_env_and_creates_env_when_neither(self):
        self.write('.env.prod', 'B=2\n')
        self.run_keys('EIA_API_KEY=k1\n')
        self.assertEqual(self.read('.env.prod'), "B=2\n# Keys from GitHub Secrets (scripts/server-keys.sh)\nEIA_API_KEY='k1'\n")
        self.assertFalse(os.path.exists(os.path.join(self.dir, '.env')))
        os.remove(os.path.join(self.dir, '.env.prod'))
        self.run_keys('EIA_API_KEY=k2\n')
        self.assertEqual(self.read('.env'), "# Keys from GitHub Secrets (scripts/server-keys.sh)\nEIA_API_KEY='k2'\n")

    def test_runs_as_the_deploy_runs_it_and_keeps_dollar_signs(self):
        self.write('.env', 'AIS_STREAM_API_KEY=old\nAIS_STREAM_API_KEY=older\n')
        r = self.run_keys('AIS_STREAM_API_KEY=a$b\\c\n', via_git_show=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.read('.env'), "AIS_STREAM_API_KEY='a$b\\c'\n")


if __name__ == '__main__':
    unittest.main()

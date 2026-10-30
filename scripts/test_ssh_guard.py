"""
Password-guessing bots shut out of SSH (scripts/ssh-guard.sh), plan LR11, Oct 30, 2026.
Run: python3 -m unittest scripts/test_ssh_guard.py  (from the repository's top folder)

The system's commands (apt-get, systemctl, fail2ban-client, python3's systemd check, sleep)
are stand-ins on PATH that record how they were called.
"""
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ssh-guard.sh')

F2B = """#!/bin/bash
echo "fail2ban-client $*" >> "$CALLS"
case "$1" in
  -t) exit "${F2B_TEST_RC:-0}" ;;
  status) exit "${F2B_STATUS_RC:-0}" ;;
esac
"""
APT = """#!/bin/bash
echo "apt-get $*" >> "$CALLS"
for a in "$@"; do
  if [ "$a" = install ]; then
    n=$(cat "$BIN/.apt_tries" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$BIN/.apt_tries"
    [ "$n" -le "${APT_FAIL_FIRST:-0}" ] && { echo "${APT_ERROR:-E: Unable to locate package \"fail2ban\"}"; exit 100; }
    cp "$BIN/.f2b" "$BIN/fail2ban-client" && chmod +x "$BIN/fail2ban-client"
  fi
done
exit 0
"""
SYSTEMCTL = """#!/bin/bash
echo "systemctl $*" >> "$CALLS"
[ "$1" = is-active ] && exit "${ACTIVE_RC:-0}"
exit 0
"""
DPKG = """#!/bin/bash
[ "$1" = --audit ] && printf 'The following packages are only half configured, probably due to problems\nconfiguring them the first time.\n libssl3t64:amd64     Secure Sockets Layer toolkit - shared libraries\n openssh-server       secure shell (SSH) server\n'
exit 0
"""
PY = """#!/bin/bash
# only the "is python3-systemd there?" check
exit "${SYSTEMD_PY_RC:-1}"
"""


class SshGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.tmp.name
        os.makedirs(os.path.join(d, 'scripts'))
        shutil.copy(SCRIPT, os.path.join(d, 'scripts', 'ssh-guard.sh'))
        self.bin = os.path.join(d, 'bin')
        os.makedirs(self.bin)
        for name, text in (('.f2b', F2B), ('apt-get', APT), ('systemctl', SYSTEMCTL), ('python3', PY), ('dpkg', DPKG), ('sleep', '#!/bin/bash\nexit 0\n')):
            p = os.path.join(self.bin, name)
            with open(p, 'w') as fh:
                fh.write(text)
            os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)
        self.jail = os.path.join(d, 'jail.d', 'worldpulse-sshd.local')
        self.calls = os.path.join(d, 'calls.log')
        self.dir = d

    def tearDown(self):
        self.tmp.cleanup()

    def installed(self):
        shutil.copy(os.path.join(self.bin, '.f2b'), os.path.join(self.bin, 'fail2ban-client'))
        os.chmod(os.path.join(self.bin, 'fail2ban-client'), 0o755)

    def run_guard(self, **env):
        e = {'PATH': self.bin + ':/usr/bin:/bin', 'BIN': self.bin, 'CALLS': self.calls, 'SSH_GUARD_JAIL': self.jail,
             'SSH_GUARD_PYTHON': os.path.join(self.bin, 'python3'), 'SSH_GUARD_F2B': os.path.join(self.bin, 'fail2ban-client'), 'SSH_GUARD_AUTH_LOG': os.path.join(self.dir, 'auth.log')}
        e.update({k: str(v) for k, v in env.items()})
        r = subprocess.run(['bash', os.path.join(self.dir, 'scripts', 'ssh-guard.sh')], capture_output=True, text=True, env=e)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r

    def calls_made(self):
        try:
            with open(self.calls) as fh:
                return fh.read().splitlines()
        except FileNotFoundError:
            return []

    def status(self):
        with open(os.path.join(self.dir, 'logs', 'ssh-guard.status')) as fh:
            return json.load(fh)

    def jail_text(self):
        with open(self.jail) as fh:
            return fh.read()

    def test_installs_fail2ban_sets_the_jail_and_starts_it(self):
        r = self.run_guard()
        text = self.jail_text()
        for line in ('[sshd]', 'enabled  = true', 'mode     = normal', 'maxretry = 5', 'findtime = 10m', 'bantime  = 1h', 'bantime.maxtime   = 1w'):
            self.assertIn(line, text)
        self.assertNotIn('backend', text)   # no journal module and no auth.log: the system's own setting
        calls = self.calls_made()
        self.assertTrue(any(c.startswith('apt-get') and ' install ' in c and c.endswith(' fail2ban') for c in calls), calls)
        self.assertIn('fail2ban-client -t', calls)
        self.assertIn('systemctl enable fail2ban', calls)
        self.assertIn('systemctl restart fail2ban', calls)
        self.assertEqual(self.status()['ok'], True)
        self.assertIn('SSH guard on (setting updated)', r.stdout)

    def test_a_second_run_changes_nothing_and_restarts_nothing(self):
        self.installed()
        self.run_guard()
        os.remove(self.calls)
        r = self.run_guard()
        calls = self.calls_made()
        self.assertNotIn('systemctl restart fail2ban', calls)
        self.assertFalse(any(c.startswith('apt-get') for c in calls))
        self.assertIn('SSH guard on (setting unchanged)', r.stdout)

    def test_reads_the_journal_when_python3_systemd_is_there(self):
        self.installed()
        self.run_guard(SYSTEMD_PY_RC=0)
        self.assertIn('backend  = systemd', self.jail_text())

    def test_reads_the_log_file_when_the_journal_module_is_missing(self):
        self.installed()
        open(os.path.join(self.dir, 'auth.log'), 'w').close()
        self.run_guard(SYSTEMD_PY_RC=1)
        text = self.jail_text()
        self.assertIn('backend  = auto', text)
        self.assertIn('logpath  = ' + os.path.join(self.dir, 'auth.log'), text)

    def test_a_setting_that_fails_the_check_is_taken_out(self):
        self.installed()
        self.run_guard(F2B_TEST_RC=1)
        self.assertFalse(os.path.exists(self.jail))
        st = self.status()
        self.assertEqual(st['ok'], False)
        self.assertIn('removed', st['note'])

    def test_refreshes_the_package_lists_once_when_the_first_install_fails(self):
        self.run_guard(APT_FAIL_FIRST=1)
        calls = self.calls_made()
        self.assertTrue(any(c.startswith('apt-get update') for c in calls), calls)
        self.assertEqual(self.status()['ok'], True)

    def test_says_so_when_fail2ban_will_not_install(self):
        r = self.run_guard(APT_FAIL_FIRST=5)
        st = self.status()
        self.assertEqual(st['ok'], False)
        self.assertTrue(st['note'].startswith('fail2ban did not install: E: Unable to locate package fail2ban'), st['note'])
        self.assertFalse(os.path.exists(self.jail))
        self.assertIn("didn't install", r.stdout)

    def test_names_the_packages_an_interrupted_install_left_half_done(self):
        self.run_guard(APT_FAIL_FIRST=5, APT_ERROR="E: dpkg was interrupted, you must manually run 'dpkg --configure -a' to correct the problem.")
        note = self.status()['note']
        self.assertIn('dpkg was interrupted; half done: libssl3t64:amd64 openssh-server', note)
        self.assertNotIn('dpkg --configure', ' '.join(self.calls_made()))   # nothing is run to fix it here

    def test_a_jail_that_does_not_answer_is_reported(self):
        self.installed()
        self.run_guard(F2B_STATUS_RC=1)
        self.assertEqual(self.status()['ok'], False)


if __name__ == '__main__':
    unittest.main()

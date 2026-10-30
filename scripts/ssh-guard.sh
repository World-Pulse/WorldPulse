#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — password-guessing bots shut out of SSH (runs ON the server)
#  Plan LR11 (Devon, Oct 29, 2026: yes). Run by the daily maintenance; safe to rerun.
#
#  fail2ban reads SSH's sign-in log: an address that fails to sign in 5 times
#  in 10 minutes can't reach SSH (port 22 only) for an hour, longer each time
#  it comes back, at most a week. Nothing else on the server is blocked.
#  - The deploy and the maintenance sign in with a key, and a key sign-in never
#    fails, so GitHub's machines are never caught; nor is the server itself.
#  - DigitalOcean's Recovery Console reaches the server without SSH, so it
#    always works, even for an address that is shut out.
#  - Before it is used, the setting is checked (fail2ban-client -t); one that
#    doesn't pass is taken out again, so a bad setting never stops fail2ban.
#  The result goes to logs/ssh-guard.status; /ops-status.json shows the counts
#  ("ssh_guard").
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
log() { echo "[ssh-guard $(date '+%H:%M:%S')] $*"; }
status() { printf '{"at":"%s","ok":%s,"note":"%s"}\n' "$(date -Is)" "$1" "$2" > logs/ssh-guard.status; }

JAIL=${SSH_GUARD_JAIL:-/etc/fail2ban/jail.d/worldpulse-sshd.local}   # (other paths only in scripts/test_ssh_guard.py)
F2B=${SSH_GUARD_F2B:-fail2ban-client}

# 1. fail2ban itself, from the system's packages
if ! command -v "$F2B" > /dev/null 2>&1; then
  if ! command -v apt-get > /dev/null 2>&1; then
    log "No apt-get here: fail2ban not set up"; status false "no apt-get on this server"; exit 0
  fi
  log "Installing fail2ban"
  export DEBIAN_FRONTEND=noninteractive
  opts=(-y -q -o DPkg::Lock::Timeout=180 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
  if ! apt-get install "${opts[@]}" fail2ban > logs/ssh-guard-install.log 2>&1; then
    # The package lists may be old: refresh them once and try again
    apt-get update -q -o DPkg::Lock::Timeout=180 >> logs/ssh-guard-install.log 2>&1 || true
    if ! apt-get install "${opts[@]}" fail2ban >> logs/ssh-guard-install.log 2>&1; then
      # apt's last error line and the system's name go in the status, so the status file says why
      why=$(grep -E '^(E|W): ' logs/ssh-guard-install.log | tail -n 1 | tr -cd 'A-Za-z0-9 .,:;/()_+=-' | cut -c1-160)
      os=$( (. /etc/os-release 2> /dev/null && printf '%s' "${PRETTY_NAME:-}") | tr -cd 'A-Za-z0-9 .()_-' | cut -c1-60)
      log "fail2ban didn't install: ${why:-see logs/ssh-guard-install.log}"
      status false "fail2ban did not install${why:+: $why}${os:+ ($os)}"; exit 0
    fi
  fi
fi

# 2. The SSH jail. Where it reads SSH's sign-ins: the system journal when
#    fail2ban's own Python can read it (python3-systemd; Ubuntu 24.04's default,
#    and Debian 12 has no /var/log/auth.log), else the log file (Ubuntu 22.04).
#    fail2ban's check (-t) doesn't try the journal, so this is decided here.
PY=${SSH_GUARD_PYTHON:-/usr/bin/python3}          # the Python fail2ban runs on (/usr/bin/fail2ban-server)
AUTH_LOG=${SSH_GUARD_AUTH_LOG:-/var/log/auth.log}
if "$PY" -c 'import systemd.journal' > /dev/null 2>&1; then backend="backend  = systemd"
elif [ -f "$AUTH_LOG" ]; then backend="backend  = auto
logpath  = $AUTH_LOG"
else backend=""
fi
want=$(cat <<EOF
# WorldPulse (scripts/ssh-guard.sh, plan LR11): addresses that keep failing to sign in to SSH are shut out of it
[sshd]
enabled  = true
mode     = normal
port     = ssh
maxretry = 5
findtime = 10m
bantime  = 1h
bantime.increment = true
bantime.maxtime   = 1w
${backend}
EOF
)
changed=no
if [ "$(cat "$JAIL" 2> /dev/null)" != "$want" ]; then
  mkdir -p "$(dirname "$JAIL")"
  printf '%s\n' "$want" > "$JAIL.new" && mv "$JAIL.new" "$JAIL" && changed=yes
fi
if ! "$F2B" -t > logs/ssh-guard-test.log 2>&1; then
  rm -f "$JAIL"
  log "The setting didn't pass fail2ban's check, so it was taken out (logs/ssh-guard-test.log)"
  status false "setting failed fail2ban's check; removed"
  systemctl restart fail2ban > /dev/null 2>&1 || true
  exit 0
fi

# 3. Running now and after a reboot; started again when the setting changed
systemctl enable fail2ban > /dev/null 2>&1 || true
if [ "$changed" = yes ] || ! systemctl is-active --quiet fail2ban; then
  systemctl restart fail2ban > /dev/null 2>&1 || true
  sleep 3
fi
word=unchanged; [ "$changed" = yes ] && word=updated
if timeout 20 "$F2B" status sshd > /dev/null 2>&1; then
  log "SSH guard on (setting $word)"
  status true "fail2ban's sshd jail is on"
else
  log "fail2ban is installed but its sshd jail isn't answering"
  status false "fail2ban's sshd jail not answering"
fi

#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
#  WorldPulse — the keys from GitHub, into the server's settings (runs ON the server)
#
#  Devon, Oct 24, 2026 (route A, plan 0l): the services' keys live in GitHub's
#  Secrets (Settings → Secrets and variables → Actions). Each deploy hands the
#  ones that are set to this script as NAME=value lines on its input, never on
#  a command line or in a log, before the code is updated (the step "Hand the
#  keys to the server" in .github/workflows/deploy.yml):
#      ... | ssh root@server 'cd /opt/worldpulse && git fetch --quiet origin main \
#              && git show origin/main:scripts/server-keys.sh > /root/.server-keys.sh \
#              && bash /root/.server-keys.sh; ...'
#  It writes the ones on its list into the settings file the deploy uses (.env,
#  or .env.prod when there is no .env), so the containers the deploy then
#  recreates have them. A key that isn't set in GitHub is left as it is here;
#  nothing but key names is ever printed.
# ──────────────────────────────────────────────────────────────────
set -uo pipefail
# The repository's folder: where the caller is (run through `git show`, $0 is a
# /dev/fd path), else this script's folder's parent, else /opt/worldpulse
if [ ! -f docker-compose.prod.yml ]; then
  here=$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)
  if [ -n "$here" ] && [ -f "$here/docker-compose.prod.yml" ]; then cd "$here"
  else cd /opt/worldpulse 2>/dev/null && [ -f docker-compose.prod.yml ] || { echo "Keys: not in the WorldPulse folder; nothing written"; exit 1; }
  fi
fi

file=.env
[ -f .env ] || { [ -f .env.prod ] && file=.env.prod; }

# The program goes in as an argument, so the key lines stay on standard input
PROG=$(cat <<'PY'
import os, re, sys, tempfile

# The names the deploy may hand over, and the name each takes in the settings file.
# GitHub forbids secret names that start with GITHUB_, hence the GH_OAUTH_ pair.
NAMES = {
    'RESEND_API_KEY': 'RESEND_API_KEY',               # email: sign-ups, password reset, the briefing (G4, G13)
    'TELEGRAM_BOT_TOKEN': 'TELEGRAM_BOT_TOKEN',       # the Telegram channel (G10)
    'TELEGRAM_CHANNEL': 'TELEGRAM_CHANNEL',
    'BLUESKY_HANDLE': 'BLUESKY_HANDLE',               # Bluesky (G10)
    'BLUESKY_APP_PASSWORD': 'BLUESKY_APP_PASSWORD',
    'OPENSANCTIONS_API_KEY': 'OPENSANCTIONS_API_KEY', # entity and sanctions search (P16)
    'AIS_STREAM_API_KEY': 'AIS_STREAM_API_KEY',       # live ship positions (M39)
    'GH_OAUTH_CLIENT_ID': 'GITHUB_CLIENT_ID',         # sign in with GitHub (G13)
    'GH_OAUTH_CLIENT_SECRET': 'GITHUB_CLIENT_SECRET',
    'EIA_API_KEY': 'EIA_API_KEY',                     # WTI oil from the EIA (CM6)
    'ACLED_API_KEY': 'ACLED_API_KEY',                 # ACLED's full access
    'ACLED_API_EMAIL': 'ACLED_API_EMAIL',
}

def fail(msg):
    print('Keys: ' + msg + '; nothing written')
    sys.exit(1)

incoming = {}
skipped = []
for raw in sys.stdin.read().split('\n'):
    line = raw.rstrip('\r')
    if not line.strip():
        continue
    name, sep, value = line.partition('=')
    name = name.strip()
    if not sep or name not in NAMES:
        skipped.append(name[:40] if re.fullmatch(r'[A-Z0-9_]{1,40}', name or '') else '(a line that is not NAME=value)')
        continue
    # Written in single quotes, which the settings file takes literally (no $ expansion):
    # a value can't hold a single quote, a line break or a NUL
    if not value or any(c in value for c in "'\0\n") or len(value) > 4096:
        skipped.append(name + ' (empty or not a usable value)')
        continue
    incoming[NAMES[name]] = value

path = os.environ['KEYS_FILE']
if not incoming:
    print('Keys: none handed over' + (' (left out: ' + ', '.join(skipped) + ')' if skipped else ''))
    sys.exit(0)

try:
    with open(path, encoding='utf-8') as fh:
        lines = fh.read().split('\n')
    if lines and lines[-1] == '':
        lines.pop()
except FileNotFoundError:
    lines = []
except OSError as err:
    fail(f'could not read {path} ({type(err).__name__})')

def current(line):
    """The name a settings line sets (NAME=..., export NAME=...), or None"""
    m = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
    return m.group(1) if m else None

def unquote(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in '\'"':
        return v[1:-1]
    return v

changed, same = [], []
seen = set()
out = []
for line in lines:
    name = current(line)
    if name in incoming:
        if name in seen:
            continue                     # a second line for the same key: the one kept says it once
        seen.add(name)
        old = unquote(line.split('=', 1)[1])
        if old == incoming[name]:
            same.append(name)
            out.append(line)
        else:
            changed.append(name)
            out.append(f"{name}='{incoming[name]}'")
    else:
        out.append(line)
added = [n for n in incoming if n not in seen]
if added:
    out.append('# Keys from GitHub Secrets (scripts/server-keys.sh)')
    out.extend(f"{n}='{incoming[n]}'" for n in added)

if changed or added:
    folder = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(prefix='.keys-', dir=folder)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(out) + '\n')
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except OSError as err:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        fail(f'could not write {path} ({type(err).__name__})')

parts = []
if added:
    parts.append('added ' + ', '.join(added))
if changed:
    parts.append('updated ' + ', '.join(changed))
if same:
    parts.append('already set: ' + ', '.join(same))
if skipped:
    parts.append('left out: ' + ', '.join(skipped))
print(f'Keys ({os.path.basename(path)}): ' + '; '.join(parts))
PY
)
KEYS_FILE="$file" python3 -c "$PROG"

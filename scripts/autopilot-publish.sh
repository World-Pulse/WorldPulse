#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  WorldPulse — checks and shipping for every autopilot shift
#  (.github/workflows/autopilot.yml). The workflow always runs this file as it
#  was when the shift started, so a shift can't change how its own work is
#  checked.
#
#  autopilot-publish.sh check    — in the shift job (read-only GitHub token):
#     tidy up, then check the shift's commits: protected files, secrets,
#     data-deleting commands, shell/JSON/YAML syntax, lockfile, "no file gains
#     TypeScript errors", website build. Hands the commits, the .hq changes and
#     the verdict to the publish job as files in $SHIFT_OUT.
#
#  autopilot-publish.sh publish  — in a fresh publish job (can push; runs no
#     code from the shift): re-checks protected files, secrets, data-deleting
#     commands and history itself, ships passing commits to main and starts the
#     deploy (the server checks health and rolls back by itself), or parks a
#     failing change on autopilot/failed-<time>. Then saves the report, plan
#     and HQ data to the autopilot-state branch.
#
#  Env: START STAMP LANE NEXT_SHIFT CLAUDE_OUTCOME SHIFT_OUT HQ_BASE GH_TOKEN
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

MODE="${1:-}"
case "$MODE" in check|publish) ;; *) echo "usage: $0 check|publish" >&2; exit 2 ;; esac
: "${START:?START not set}"
STAMP="${STAMP:-$(date +%Y-%m-%d-%H%M)}"
LANE="${LANE:-unknown}"
OUT="${SHIFT_OUT:-/tmp/shift-out}"
REPO="${GITHUB_REPOSITORY:-World-Pulse/WorldPulse-v2}"
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/$REPO/actions/runs/${GITHUB_RUN_ID:-0}"
SITE="${AUTOPILOT_SITE:-https://world-pulse.io}"
API="${AUTOPILOT_API:-https://api.world-pulse.io}"

SECRET_RE='sk-ant-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|[sr]k_live_[0-9A-Za-z]{16,}'
DANGER_RE='docker[ -]compose[^#]*[[:space:]]down[^#]*(-v([[:space:]]|$)|--volumes)|docker[[:space:]]+volume[[:space:]]+(rm|prune)|system[[:space:]]+prune[^#]*--volumes|drop[[:space:]]+(database|schema|table)|truncate[[:space:]]+table|rm[[:space:]]+-[a-z]*r[a-z]*[[:space:]]+/(opt|srv|var/lib/docker)'
# Files a shift may never change: workflows, these checks, scripts that run on
# Devon's PC, env files, certificates and keys
PROTECTED_RE='^\.github/workflows/|^scripts/autopilot-publish\.sh$|\.(ps1|bat|cmd)$|^\.certbot/|(^|/)\.env([.][^/]*)?$|\.(pem|key|p12|pfx|jks)$|(^|/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$|(^|/)\.git-credentials$'
ENV_TEMPLATE_RE='(^|/)\.env[^/]*\.(example|sample|template)$'

NOTE=""; FAIL=""; SECRET=""; CHANGED=""
note() { grep -qxF -- "- $*" <<< "$NOTE" || NOTE+=$'\n'"- $*"; echo "• $*"; }
fail() { [ -z "$FAIL" ] && FAIL="$*"; note "Problem: $*"; }

# Pure git + grep: safe to run on untrusted commits
safety_checks() {  # safety_checks <base> <tip>
  local added p
  CHANGED=$(git diff --name-only --no-renames "$1" "$2")
  added=$(git diff --no-renames --text --no-textconv --no-ext-diff --unified=0 --no-color "$1" "$2" \
          | grep -E '^\+' | grep -vE '^\+\+\+ ' || true)
  p=$(grep -E -- "$PROTECTED_RE" <<< "$CHANGED" | grep -vE -- "$ENV_TEMPLATE_RE" || true)
  [ -n "$p" ] && fail "it changed protected files: $(tr '\n' ' ' <<< "$p")"
  if grep -qE -- "$SECRET_RE" <<< "$added"; then
    SECRET=1; fail "a change looked like it contained a password or API key"
  fi
  if grep -qiE -- "$DANGER_RE" <<< "$added"; then
    fail "a change added a command that could delete data"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
if [ "$MODE" = check ]; then
  export NODE_OPTIONS="--max-old-space-size=4096" NEXT_TELEMETRY_DISABLED=1
  mkdir -p "$OUT"

  build_types() { pnpm --filter @worldpulse/types build > /dev/null 2>&1 || true; }

  typecheck() {  # typecheck <app> <out> → "<errors>\t<file>" lines; non-zero if it couldn't check
    local rc
    [ -x "apps/$1/node_modules/.bin/tsc" ] || return 1
    ( cd "apps/$1" && timeout 900 ./node_modules/.bin/tsc --noEmit --pretty false -p tsconfig.json ) > "$2.raw" 2>&1
    rc=$?
    python3 - "$2.raw" > "$2" <<'PY'
import collections, re, sys
c = collections.Counter()
for line in open(sys.argv[1], errors="replace"):
    m = re.match(r"^(.+?)\(\d+,\d+\): error TS\d+", line)
    if m:
        c[m.group(1)] += 1
    elif re.search(r"\berror TS\d+", line):
        c["(project settings)"] += 1
for f, n in sorted(c.items()):
    print(f"{n}\t{f}")
PY
    # tsc crashed, ran out of memory or timed out: no verdict
    [ "$rc" -ne 0 ] && [ ! -s "$2" ] && return 1
    return 0
  }

  compare_types() {  # compare_types <app>: fails if any file gained errors
    local out rc
    out=$(python3 - "/tmp/tc-before-$1" "/tmp/tc-after-$1" <<'PY'
import sys
def load(path):
    d = {}
    for line in open(path):
        n, _, f = line.rstrip("\n").partition("\t")
        if f:
            d[f] = int(n)
    return d
b, a = load(sys.argv[1]), load(sys.argv[2])
worse = [(f, b.get(f, 0), n) for f, n in sorted(a.items()) if n > b.get(f, 0)]
print(f"{sum(b.values())} → {sum(a.values())}")
for f, x, y in worse[:15]:
    print(f"  - {f}: {x} → {y}")
sys.exit(3 if worse else 0)
PY
)
    rc=$?
    if [ "$rc" -eq 3 ]; then
      fail "new TypeScript errors in apps/$1 (errors $(head -n1 <<< "$out"))"
      NOTE+=$'\n'"$(tail -n +2 <<< "$out")"
    elif [ "$rc" -eq 0 ]; then
      note "apps/$1 TypeScript errors: $(head -n1 <<< "$out") (no file got worse)"
    else
      fail "couldn't compare TypeScript errors for apps/$1"
    fi
  }

  # ── 0. Only committed work counts ─────────────────────────────────────────
  rm -f .git/index.lock
  for op in rebase merge cherry-pick revert am; do git "$op" --abort > /dev/null 2>&1 || true; done
  LEFTOVER=$( { git status --porcelain --untracked-files=no | grep -v ' pnpm-lock\.yaml$' | cut -c4- ;
                git ls-files -o --exclude-standard ; } | head -n 10 | paste -sd ' ' - )
  [ -n "$LEFTOVER" ] && note "Files left uncommitted at the end of the shift were discarded: $LEFTOVER"
  git reset -q --hard HEAD
  git clean -fdq
  HEAD_REF=$(git symbolic-ref -q --short HEAD || true)
  TIP=$(git rev-parse HEAD)
  back_to_tip() { if [ -n "$HEAD_REF" ]; then git checkout -q "$HEAD_REF"; else git checkout -q --detach "$TIP"; fi; }

  HAS_WORK=0
  if [ "$TIP" != "$START" ]; then
    if git merge-base --is-ancestor "$TIP" "$START"; then
      note "The shift moved main backwards; ignored."
    else
      HAS_WORK=1
    fi
  fi

  if [ "$HAS_WORK" = 1 ]; then
    git merge-base --is-ancestor "$START" "$TIP" || fail "the shift rewrote history instead of adding new commits"
    note "Commits: $(git log --format='%h %s' "$START..$TIP" 2> /dev/null | head -n 5 | paste -sd ';' -)"

    # ── 1. Safety ───────────────────────────────────────────────────────────
    safety_checks "$START" "$TIP"

    # ── 2. Quick syntax checks ──────────────────────────────────────────────
    if [ -z "$FAIL" ]; then
      while IFS= read -r f; do
        [ -f "$f" ] || continue
        case "$f" in
          */tsconfig*.json|tsconfig*.json|*/jsconfig*.json|*.jsonc|*/.eslintrc*|.eslintrc*|turbo.json|.vscode/*) ;;
          *.sh) bash -n "$f" 2> /tmp/syntax.err || fail "shell syntax error in $f: $(head -n1 /tmp/syntax.err)" ;;
          *.json) python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8-sig"))' "$f" 2> /dev/null \
                    || fail "invalid JSON in $f" ;;
          *.yml|*.yaml)
            if python3 -c 'import yaml' 2> /dev/null; then
              python3 -c 'import yaml,sys; list(yaml.safe_load_all(open(sys.argv[1])))' "$f" 2> /dev/null \
                || fail "invalid YAML in $f"
            fi ;;
        esac
      done <<< "$CHANGED"
    fi

    ROOT_DEPS=""
    grep -qE '^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$' <<< "$CHANGED" && ROOT_DEPS=1

    # ── 3. Dependencies ─────────────────────────────────────────────────────
    if [ -z "$FAIL" ] && grep -qE '(^|/)package\.json$|^pnpm-lock\.yaml$|^pnpm-workspace\.yaml$' <<< "$CHANGED"; then
      if [ -f /tmp/lockfile-in-sync ]; then
        if pnpm install --frozen-lockfile --prefer-offline > /tmp/lockfile.log 2>&1; then
          note "Dependencies changed and pnpm-lock.yaml matches."
        else
          fail "dependencies changed but pnpm-lock.yaml doesn't match (run pnpm install and commit the lockfile)"
        fi
      else
        note "Dependencies changed; the lockfile was already out of date before this shift, so it wasn't checked."
        pnpm install --no-frozen-lockfile --prefer-offline > /tmp/lockfile.log 2>&1 || true
        git checkout -- pnpm-lock.yaml 2> /dev/null || true
      fi
    fi

    # ── 4. Types: compare with the start of the shift ───────────────────────
    if [ -z "$FAIL" ]; then
      apps=""
      grep -q '^apps/api/' <<< "$CHANGED" && apps="$apps api"
      grep -q '^apps/scraper/' <<< "$CHANGED" && apps="$apps scraper"
      grep -qE '^apps/web/|^packages/ui/' <<< "$CHANGED" && apps="$apps web"
      { grep -q '^packages/types/' <<< "$CHANGED" || [ -n "$ROOT_DEPS" ]; } && apps="api scraper web"
      apps=$(printf '%s\n' $apps | sort -u | tr '\n' ' ')
      if [ -n "${apps// /}" ]; then
        build_types
        for a in $apps; do
          typecheck "$a" "/tmp/tc-after-$a" || { fail "couldn't type-check apps/$a (tsc missing, crashed or timed out)"; break; }
        done
        if [ -z "$FAIL" ]; then
          if git checkout -q --detach "$START"; then
            build_types
            for a in $apps; do typecheck "$a" "/tmp/tc-before-$a" || : > "/tmp/tc-before-$a"; done
            back_to_tip
            build_types
            for a in $apps; do compare_types "$a"; done
          else
            fail "couldn't check out the start of the shift to compare TypeScript errors"
          fi
        fi
      fi
    fi

    # ── 5. Website build ────────────────────────────────────────────────────
    if [ -z "$FAIL" ] && { grep -qE '^apps/web/|^packages/(types|ui)/' <<< "$CHANGED" || [ -n "$ROOT_DEPS" ]; }; then
      if ( pnpm --filter @worldpulse/types build \
           && NEXT_PUBLIC_API_URL=https://api.world-pulse.io NEXT_PUBLIC_WS_URL=wss://api.world-pulse.io \
              NEXT_PUBLIC_MEILI_HOST=https://api.world-pulse.io/search pnpm --filter @worldpulse/web build ) > /tmp/build-web.log 2>&1; then
        note "Website build passed."
      else
        fail "the website build failed"
        NOTE+=$'\n'"\`\`\`"$'\n'"$(grep -v '^[[:space:]]*$' /tmp/build-web.log | tail -n 30)"$'\n'"\`\`\`"
      fi
    fi

    # Hand the commits to the publish job (it re-checks them itself)
    git update-ref refs/heads/autopilot-shift-tip "$TIP"
    git bundle create "$OUT/code.bundle" refs/heads/autopilot-shift-tip "^$START" > /dev/null 2>&1 \
      || note "Couldn't package the shift's commits."
  else
    note "No code change this shift."
  fi

  # Hand the .hq changes (report, plan, HQ data) to the publish job
  if [ -d .hq/.git ] && [ -n "${HQ_BASE:-}" ]; then
    (
      cd .hq || exit 0
      rm -f .git/index.lock
      git add -A
      # Everything the shift changed in .hq becomes one commit on top of where it started
      git reset -q --soft "$HQ_BASE"
      git diff --cached --quiet || git -c user.name="WorldPulse Autopilot" -c user.email="autopilot@world-pulse.io" \
        commit -qm "Shift $STAMP work"
      if [ "$(git rev-parse HEAD)" != "$HQ_BASE" ]; then
        git update-ref refs/heads/shift-work HEAD
        git bundle create "$OUT/hq.bundle" refs/heads/shift-work "^$HQ_BASE" > /dev/null 2>&1 || true
      fi
    )
  fi

  {
    echo "checks=$([ -z "$FAIL" ] && echo pass || echo fail)"
    echo "has_work=$HAS_WORK"
  } > "$OUT/verdict.txt"
  printf '%s\n' "$FAIL" > "$OUT/fail.txt"
  printf '%s\n' "$NOTE" > "$OUT/notes.md"
  echo "Checks: $([ -z "$FAIL" ] && echo passed || echo "failed — $FAIL")"
  exit 0
fi

# ═════════════════════════════════════════════════════════════════════════════
#  publish — runs no code from the shift
# ═════════════════════════════════════════════════════════════════════════════
SHIPPED=""; PARKED=""; RESULT=""; TIP=""
SERVER_COMMIT=""; LAST_DEPLOY=""; API_STATUS=""
git config --global user.name "WorldPulse Autopilot"
git config --global user.email "autopilot@world-pulse.io"

# What the shift job reported (untrusted: shift code ran before it was written)
CHECKS=$(sed -n 's/^checks=\(pass\|fail\)$/\1/p' "$OUT/verdict.txt" 2> /dev/null | head -n1)
CHECK_FAIL=$(head -n1 "$OUT/fail.txt" 2> /dev/null | tr -d '\000-\037\177' | cut -c1-300)
[ -s "$OUT/notes.md" ] && NOTE+=$'\n'"$(head -c 20000 "$OUT/notes.md" | grep -v '^[[:space:]]*$')"

if [ -f "$OUT/code.bundle" ]; then
  if git fetch -q "$OUT/code.bundle" "refs/heads/autopilot-shift-tip:refs/autopilot/tip" 2> /dev/null; then
    TIP=$(git rev-parse refs/autopilot/tip)
  else
    note "Couldn't read the shift's commits."
  fi
fi

if [ -n "$TIP" ] && [ "$TIP" != "$START" ]; then
  NEW=$(git rev-list --count "$START..$TIP" 2> /dev/null || echo "?")
  # Re-check everything that matters for safety here, where it can't be faked
  git merge-base --is-ancestor "$START" "$TIP" || fail "the shift rewrote history instead of adding new commits"
  safety_checks "$START" "$TIP"
  if [ "$CHECKS" != pass ]; then
    if [ -z "$CHECKS" ]; then fail "the shift's checks didn't finish"
    elif [ -z "$FAIL" ]; then FAIL="${CHECK_FAIL:-the checks failed}"; fi
  fi
  [ "$(git rev-parse HEAD)" = "$START" ] || fail "main changed while the shift was working"

  if [ -z "$FAIL" ]; then
    if git push -q origin "$TIP:refs/heads/main" 2> /dev/null; then
      SHIPPED=$(git rev-parse --short=7 "$TIP")
      note "Shipped $NEW commit(s) to main ($SHIPPED)."
      RESULT="shipped $SHIPPED"
    else
      fail "main changed while publishing"
    fi
  fi
  if [ -z "$SHIPPED" ]; then
    if [ -n "$SECRET" ]; then
      note "Not saved anywhere, because it may contain a secret."
      RESULT="blocked: $FAIL"
    else
      PARKED="autopilot/failed-$STAMP"
      if git push -q origin "$TIP:refs/heads/$PARKED" 2> /dev/null; then
        note "The change is kept on branch $PARKED; the live site is untouched."
      else
        note "Couldn't save the change to a branch."
      fi
      RESULT="parked: $FAIL"
    fi
  fi
else
  if [ ! -f "$OUT/verdict.txt" ]; then
    note "The shift's results didn't reach the publish job, so nothing was shipped (see the run log)."
    RESULT="nothing shipped: the shift's results didn't arrive"
  elif [ "$CHECKS" = fail ] && [ -n "$CHECK_FAIL" ]; then
    RESULT="nothing shipped: $CHECK_FAIL"
  else
    RESULT="no code change"
  fi
fi

# ── Production status; deploy if main isn't on the server yet ──────────────
OPS=$(curl -fsS --max-time 20 "$SITE/ops-status.json?t=$(date +%s)" 2> /dev/null || true)
SITE_CODE=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 20 "$SITE/" 2> /dev/null || true)
API_HEALTH=$(curl -fsS --max-time 20 "$API/health" 2> /dev/null || true)
eval "$(OPS="$OPS" API_HEALTH="$API_HEALTH" python3 - <<'PY'
import json, os, re, shlex
def load(s):
    try:
        v = json.loads(s or "{}")
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}
d, h = load(os.environ.get("OPS")), load(os.environ.get("API_HEALTH"))
commit = str(d.get("commit") or "")
print("SERVER_COMMIT=" + shlex.quote(commit if re.fullmatch(r"[0-9a-f]{4,40}", commit) else ""))
print("LAST_DEPLOY=" + shlex.quote(re.sub(r"[^a-z_]", "", str(d.get("last_deploy") or ""))))
print("API_STATUS=" + shlex.quote(re.sub(r"[^A-Za-z _-]", "", str(h.get("status") or ""))))
PY
)"
MAIN_FULL=$(git ls-remote origin refs/heads/main 2> /dev/null | cut -f1)
case "$LAST_DEPLOY" in running|starting) DEPLOYING=1 ;; *) DEPLOYING="" ;; esac
if [ -n "$MAIN_FULL" ] && [ -z "$DEPLOYING" ] && { [ -n "$SHIPPED" ] || { [ -n "$SERVER_COMMIT" ] && [[ "$MAIN_FULL" != "$SERVER_COMMIT"* ]]; }; }; then
  if gh workflow run deploy.yml --repo "$REPO" --ref main -f wait=false > /dev/null 2>&1 \
     || gh workflow run deploy.yml --repo "$REPO" --ref main > /dev/null 2>&1; then
    note "Deploy of ${MAIN_FULL:0:7} started (the server checks health and rolls back by itself; the result shows in ops-status.json)."
    RESULT="${RESULT:+$RESULT · }deploy started"
  else
    note "Couldn't start the deploy; the next shift will try again."
  fi
elif [ -n "$SHIPPED" ] && [ -n "$DEPLOYING" ]; then
  note "A deploy is already running on the server; the next shift will deploy $SHIPPED if it isn't live by then."
fi

# ── Save the shift: report, plan and HQ data ────────────────────────────────
REPORT=""
finish() {
  if [ -n "$REPORT" ] && [ -f "$REPORT" ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    cat "$REPORT" >> "$GITHUB_STEP_SUMMARY"
  fi
  if [ "${CLAUDE_OUTCOME:-}" = failure ] || [ -n "$PARKED" ] || [ -n "$SECRET" ]; then exit 1; fi
  exit 0
}
if [ ! -d .hq/.git ]; then echo "No autopilot-state checkout; nothing to save."; finish; fi
cd .hq || finish
BASE_HQ=$(git rev-parse HEAD)

# Bring in what the shift wrote; edits made on GitHub meanwhile win any clash
if [ -f "$OUT/hq.bundle" ] && git fetch -q "$OUT/hq.bundle" "refs/heads/shift-work:refs/autopilot/hq" 2> /dev/null; then
  W=$(git rev-parse refs/autopilot/hq)
  if git merge-base --is-ancestor HEAD "$W"; then
    git merge -q --ff-only "$W"
  elif ! git cherry-pick -X ours "$W" > /dev/null 2>&1; then
    git cherry-pick --abort > /dev/null 2>&1 || git reset -q --hard "$BASE_HQ"
    git checkout "$W" -- reports departments 2> /dev/null || true
    note "Plan/HQ edits from this shift clashed with an edit made on GitHub, so the GitHub version was kept."
  fi
fi
# Orbit's standing instructions only change when Devon (or Claude in a chat) changes them
if ! git diff --quiet "$BASE_HQ" -- AUTOPILOT.md README.md 2> /dev/null; then
  git checkout "$BASE_HQ" -- AUTOPILOT.md README.md 2> /dev/null || true
  note "The shift edited AUTOPILOT.md or README.md; those edits were undone."
fi

mkdir -p reports
REPORT="reports/$STAMP.md"
if [ ! -s "$REPORT" ]; then
  printf '# Shift %s · %s\n\nThe shift ended without writing a report (Claude step: %s). Details are in the [run log](%s).\n' \
    "$STAMP" "$LANE" "${CLAUDE_OUTCOME:-unknown}" "$RUN_URL" > "$REPORT"
fi
{
  printf '\n## Pipeline\n'
  printf -- '- Result: %s\n' "${RESULT:-done}"
  printf -- '- Shift: %s · Claude step: %s · [run log](%s)' "$LANE" "${CLAUDE_OUTCOME:-unknown}" "$RUN_URL"
  printf '%s\n' "$NOTE"
} >> "$REPORT"

HQ_PROBLEMS=$(BASE_HQ="$BASE_HQ" OPS="$OPS" SITE_CODE="$SITE_CODE" API_STATUS="$API_STATUS" RESULT="$RESULT" \
  LANE="$LANE" STAMP="$STAMP" NEXT_SHIFT="${NEXT_SHIFT:-}" RUN_URL="$RUN_URL" CLAUDE_OUTCOME="${CLAUDE_OUTCOME:-}" python3 - <<'PY'
import datetime, json, os, subprocess

def parse(text):
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else None
    except Exception:
        return None

env = os.environ.get
prev = parse(subprocess.run(["git", "show", env("BASE_HQ") + ":hq-data.json"],
                            capture_output=True, text=True).stdout.lstrip("﻿"))
cur = parse(open("hq-data.json", encoding="utf-8-sig").read()) if os.path.exists("hq-data.json") else None
problems = []
if cur is None:
    problems.append("hq-data.json was not valid JSON")
elif prev:
    ids = lambda d: [t.get("id") if isinstance(t, dict) else None for t in d.get("team", [])]
    if ids(cur) != ids(prev):
        problems.append("the team list was changed")
    if cur.get("departments") != prev.get("departments"):
        problems.append("the departments were changed")
    if not problems:  # keep each bot's identity as it was
        old = {t["id"]: t for t in prev.get("team", [])}
        for t in cur["team"]:
            for k in ("name", "kind", "dept", "color", "role"):
                if k in old[t["id"]]:
                    t[k] = old[t["id"]][k]
if problems:
    cur = prev
if cur is None:  # nothing valid to build on: leave the file alone
    print("hq-data.json could not be read, so it was left unchanged")
    raise SystemExit(0)
d = cur

now = datetime.datetime.now().astimezone()
d["updated"] = now.isoformat(timespec="seconds")
d["autopilot"] = {
    "next": env("NEXT_SHIFT") or (d.get("autopilot") or {}).get("next", ""),
    "cadence": "every 3 hours",
    "where": "cloud",
    "last": {"stamp": env("STAMP"), "lane": env("LANE"), "result": env("RESULT") or "", "run": env("RUN_URL")},
}

def put(label, value, state):
    prod = d.setdefault("production", [])
    for p in prod:
        if isinstance(p, dict) and p.get("label") == label:
            p.update(value=value, state=state)
            return
    prod.append({"label": label, "value": value, "state": state})

code = env("SITE_CODE") or ""
put("Site", "Online" if code == "200" else f"Not loading (HTTP {code or 'no answer'})", "ok" if code == "200" else "bad")
api = (env("API_STATUS") or "").lower()
put("API", "Healthy" if api in ("ok", "healthy") else (api or "No answer"), "ok" if api in ("ok", "healthy") else "bad")
ops = parse(env("OPS") or "") or {}
if ops:
    c = ops.get("containers") or {}
    scraper = str(c.get("wp_scraper", "missing"))
    put("News intake", "Live" if scraper == "running" else f"Scraper {scraper}", "ok" if scraper == "running" else "bad")
    days = ops.get("cert_days_left")
    if isinstance(days, int) and days >= 0:
        put("Certificate", f"{days} days left", "ok" if days >= 21 else "warn" if days >= 14 else "bad")
    disk = ops.get("disk_used_pct")
    if isinstance(disk, int):
        put("Disk", f"{disk}% used", "ok" if disk < 80 else "warn" if disk < 90 else "bad")
    ld, commit = str(ops.get("last_deploy") or "none"), str(ops.get("commit") or "?")
    words = {"success": ("Live", "ok"), "success_with_warnings": ("Live, with warnings", "warn"),
             "rolled_back": ("Rolled back", "bad"), "failed": ("Failed", "bad"),
             "running": ("Deploying…", "warn"), "starting": ("Deploying…", "warn")}
    w, st = words.get(ld, (ld, "warn"))
    put("Last deploy", f"{w} · {commit}", st)

result, lane = env("RESULT") or "", env("LANE") or "shift"
if env("CLAUDE_OUTCOME") == "failure" and not result.startswith("shipped"):
    text = f"{lane} shift didn't finish cleanly; details in the report"
elif result.startswith(("parked", "blocked")):
    text = f"{lane} shift: change held back ({result.split(': ', 1)[-1]})"
else:
    text = f"{lane} shift: {result or 'done'}"
log = [x for x in d.get("log", []) if isinstance(x, dict)]
log.append({"time": now.strftime("%I:%M %p").lstrip("0"), "who": "Orbit", "text": text[:200]})
d["log"] = log[-12:]

with open("hq-data.json", "w", encoding="utf-8") as fh:
    json.dump(d, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
print("; ".join(problems))
PY
)
[ -n "$HQ_PROBLEMS" ] && printf -- '- HQ data: %s, so the previous version was kept\n' "$HQ_PROBLEMS" >> "$REPORT"

# Never store anything that looks like a key, even on the private branch
SECRET_RE="$SECRET_RE" python3 - <<'PY'
import os, re
pem = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(-----END [A-Z ]*PRIVATE KEY-----|\Z)", re.S)
tok = re.compile(os.environ["SECRET_RE"])
for root, dirs, files in os.walk("."):
    dirs[:] = [x for x in dirs if x != ".git"]
    for name in files:
        path = os.path.join(root, name)
        try:
            text = open(path, encoding="utf-8").read()
        except Exception:
            continue
        new = tok.sub("[redacted]", pem.sub("[redacted private key]", text))
        if new != text:
            open(path, "w", encoding="utf-8").write(new)
PY

# One commit per shift on autopilot-state
git reset -q --soft "$BASE_HQ"
git add -A
if ! git diff --cached --quiet; then
  git commit -qm "Shift $STAMP · $LANE · ${RESULT:-done}"
  saved=""
  for i in 1 2 3; do
    if git push -q origin HEAD:autopilot-state 2> /dev/null; then saved=1; break; fi
    # Changed on GitHub meanwhile: replay on top; the GitHub version wins any clash
    git pull -q --rebase -X ours origin autopilot-state > /dev/null 2>&1 || git rebase --abort > /dev/null 2>&1
    sleep $((i * 5))
  done
  if [ -n "$saved" ]; then
    echo "Shift saved to autopilot-state."
  elif git push -q origin "HEAD:refs/heads/autopilot/state-$STAMP" 2> /dev/null; then
    echo "::warning::autopilot-state changed at the same time; this shift was saved to autopilot/state-$STAMP instead."
  else
    echo "::warning::Couldn't save the shift to autopilot-state."
  fi
fi
finish

#!/usr/bin/env python3
"""WorldPulse autopilot — HQ bookkeeping after every shift.

Run by scripts/autopilot-publish.sh (taken from the commit the shift started
on) inside the autopilot-state checkout. It runs no code from the shift and
treats every file the shift wrote as untrusted data.

  autopilot_hq.py migrate DIR
                           bring the desk up to date with DIR (the
                           scripts/autopilot-instructions folder on main):
                           standing instructions, org chart, files the
                           pipeline keeps, roadmap items added in chat
  autopilot_hq.py update   check the shift's edits to hq-data.json and
                           handoffs.json (restore what it may not change),
                           record the shift in ledger.json, refresh
                           production, cost, shift history and the log
  autopilot_hq.py status   write STATUS.md, Devon's phone-friendly page

Inputs come from environment variables set by the publish step: BASE_HQ, AP_SRC,
STAMP, SLOT_ID, LANE, RESULT, SHIPPED, NEXT_SHIFT, RUN_URL, CLAUDE_OUTCOME,
API_PROBLEM, OPS, SITE_CODE, API_STATUS, COST_FILE, REPORT.
"""
import datetime
import glob
import json
import os
import re
import subprocess
import sys

env = os.environ.get
NOW = datetime.datetime.now().astimezone()
TODAY = NOW.date()
ACTIVE = ("open", "accepted", "in_progress", "blocked")
STATUSES = ACTIVE + ("done", "declined")
PRIOS = ("P0", "P1", "P2", "P3")
# Set by Devon (or Claude in a chat), never by a shift
IDENTITY = ("name", "kind", "dept", "color", "role", "head", "reports_to")
API_PREFIX = "Autopilot can't reach Claude"
# Shown once, when the chain of command first reaches a desk
V2_HEADLINE = ("New chain of command: floors now pass work to each other through the handoff board, "
               "with a weekly planning shift on Sundays.")
V2_LOG = {"time": "Oct 7", "who": "Claude", "text": "Opened the Executive Suite: chain of command, handoff board and weekly planning"}
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


# ── small helpers ────────────────────────────────────────────────────────────
def parse(text):
    try:
        return json.loads((text or "").lstrip("﻿"))
    except Exception:
        return None


def read(path):
    try:
        with open(path, encoding="utf-8-sig") as fh:
            return parse(fh.read())
    except Exception:
        return None


def at_base(path):
    """The file as it was when the shift started (before its edits)."""
    r = subprocess.run(["git", "show", f"{env('BASE_HQ') or 'HEAD'}:{path}"], capture_output=True, text=True)
    return parse(r.stdout) if r.returncode == 0 else None


def write(path, value):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(value, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def clip(v, n):
    return re.sub(r"\s+", " ", str(v if v is not None else "")).strip()[:n]


def num(v, lo, hi):
    try:
        v = float(v)
    except Exception:
        return None
    return round(v, 4) if lo <= v <= hi else None


def stamp_time(st):
    """'2026-10-07-1907' (New York time, the job's TZ) → aware datetime."""
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})", str(st or ""))
    if not m:
        return None
    try:
        return datetime.datetime(*map(int, m.groups())).astimezone()
    except ValueError:
        return None


def age_days(iso):
    try:
        return (TODAY - datetime.date.fromisoformat(iso)).days
    except Exception:
        return 0


def clock(t):
    return t.strftime("%I:%M %p").lstrip("0")


# ── migrate ──────────────────────────────────────────────────────────────────
def apply_org(d, org):
    """Make hq-data.json match the org chart: floors, people, heads, reporting lines."""
    changed = False
    depts = org.get("departments")
    if isinstance(depts, list) and depts and all(isinstance(x, dict) and x.get("id") for x in depts) \
            and d.get("departments") != depts:
        d["departments"], changed = depts, True
    team = [t for t in d.get("team", []) if isinstance(t, dict)] if isinstance(d.get("team"), list) else []
    by = {t.get("id"): t for t in team}
    for o in org.get("team") or []:
        if not isinstance(o, dict) or not o.get("id") or not o.get("name"):
            continue
        t = by.get(o["id"])
        if t is None:  # a new hire: starts queued at their desk
            t = {"id": o["id"], "status": "queued", "now": "Just joined", "tasks": []}
            team.append(t)
            by[o["id"]] = t
            changed = True
        for k in IDENTITY:
            if k in o and t.get(k) != o[k]:
                t[k], changed = o[k], True
            elif k not in o and k in ("head", "reports_to") and k in t:
                t.pop(k)
                changed = True
    if d.get("team") != team:
        d["team"], changed = team, True
    return changed


def migrate():
    """Idempotent and deterministic: the shift and publish jobs run it on the
    same desk and must end up with identical files."""
    src = sys.argv[2] if len(sys.argv) > 2 else ""
    if not os.path.isdir(src):
        sys.exit("usage: autopilot_hq.py migrate <scripts/autopilot-instructions folder>")
    done = []

    def text(path):
        try:
            with open(path, encoding="utf-8-sig") as fh:
                return fh.read()
        except Exception:
            return None

    # 1. Standing instructions: main's copy always wins
    for name in ("AUTOPILOT.md", "README.md"):
        new = text(os.path.join(src, name))
        if new and new != text(name):
            with open(name, "w", encoding="utf-8") as fh:
                fh.write(new)
            done.append(name)

    # 2. Org chart → hq-data.json
    org, d = read(os.path.join(src, "org.json")), read("hq-data.json")
    if isinstance(org, dict) and isinstance(d, dict):
        first = not any(isinstance(x, dict) and x.get("id") == "exec" for x in d.get("departments") or [])
        if apply_org(d, org):
            if first and any(isinstance(x, dict) and x.get("id") == "exec" for x in d.get("departments") or []):
                d["headline"] = V2_HEADLINE
                log = [x for x in d.get("log") or [] if isinstance(x, dict)]
                if not any(x.get("text") == V2_LOG["text"] for x in log):
                    log.append(dict(V2_LOG))
                d["log"] = log[-12:]
            write("hq-data.json", d)
            done.append("org chart")

    # 3. Files the pipeline keeps
    for name in ("handoffs.json", "ledger.json"):
        if not os.path.exists(name):
            write(name, [])
            done.append(name)
    if not os.path.isdir("briefs"):
        os.makedirs("briefs")
        open(os.path.join("briefs", ".gitkeep"), "w").close()
        done.append("briefs/")

    # 4. Roadmap sections added in chat, once (Devon's later edits to them win)
    add, plan = (text(os.path.join(src, "plan-hq.md")) or "").strip(), text("PLAN.md")
    title = add.splitlines()[0].strip() if add else ""
    if title and plan is not None and title not in plan:
        i = plan.find("\n## Needs Devon")
        plan = plan[:i].rstrip() + "\n\n" + add + "\n" + plan[i:] if i >= 0 else plan.rstrip() + "\n\n" + add + "\n"
        with open("PLAN.md", "w", encoding="utf-8") as fh:
            fh.write(plan)
        done.append("PLAN.md")
    print(", ".join(done))


# ── update ───────────────────────────────────────────────────────────────────
def update():
    problems = []

    # hq-data.json: valid JSON, same team and floors, identities untouched.
    # Compared with the desk as the shift found it, brought up to main's org chart.
    prev = at_base("hq-data.json")
    prev = prev if isinstance(prev, dict) else None
    org = read(os.path.join(env("AP_SRC") or "/nonexistent", "org.json"))
    if prev and isinstance(org, dict):
        apply_org(prev, org)
    cur = read("hq-data.json")
    if not isinstance(cur, dict):
        problems.append("hq-data.json was not valid JSON")
        cur = None
    elif prev:
        ids = lambda d: [t.get("id") if isinstance(t, dict) else None for t in d.get("team", [])]
        if ids(cur) != ids(prev):
            problems.append("the team list was changed")
        if cur.get("departments") != prev.get("departments"):
            problems.append("the floors were changed")
        if not problems:
            old = {t["id"]: t for t in prev.get("team", [])}
            for t in cur["team"]:
                for k in IDENTITY:
                    if k in old[t["id"]]:
                        t[k] = old[t["id"]][k]
                    else:
                        t.pop(k, None)
    if problems:
        cur = prev
    if cur is None:  # nothing valid to build on: leave everything alone
        print("hq-data.json could not be read, so HQ was left unchanged")
        return
    d = cur
    names = {t.get("id"): t.get("name") or t.get("id") for t in d.get("team", []) if isinstance(t, dict)}
    floors = {x.get("id"): x.get("name") for x in d.get("departments", []) if isinstance(x, dict)}
    who = set(names) | set(floors) | {"devon"}
    label = lambda i: "Devon" if i == "devon" else names.get(i) or floors.get(i) or i

    # What the shift says it worked on (it writes this card; we file it)
    card = d.pop("current", None)
    card = card if isinstance(card, dict) else {}
    bot = card.get("bot") if card.get("bot") in names else None

    # handoffs.json: the board floors use to pass work to each other
    hprev = at_base("handoffs.json")
    hprev = hprev if isinstance(hprev, list) else []
    hcur = read("handoffs.json")
    if not isinstance(hcur, list):
        if os.path.exists("handoffs.json"):
            problems.append("handoffs.json was not a valid list, so the previous board was kept")
        hcur = hprev
    nums = [int(m.group(1)) for h in hcur if isinstance(h, dict)
            for m in [re.fullmatch(r"H-(\d{1,6})", str(h.get("id", "")))] if m]
    nxt, seen, board, dropped = max(nums, default=0) + 1, set(), [], 0
    for h in hcur:
        if not isinstance(h, dict):
            dropped += 1
            continue
        frm, to, title = str(h.get("from", "")), str(h.get("to", "")), clip(h.get("title"), 140)
        if frm not in who or to not in who or not title:
            dropped += 1
            continue
        hid = str(h.get("id", ""))
        if not re.fullmatch(r"H-\d{1,6}", hid) or hid in seen:
            hid, nxt = f"H-{nxt:04d}", nxt + 1
        seen.add(hid)
        created = str(h.get("created", ""))
        created = created if DATE_RE.fullmatch(created) else TODAY.isoformat()
        updated = str(h.get("updated", ""))
        updated = updated if DATE_RE.fullmatch(updated) else created
        e = {"id": hid, "from": frm, "to": to,
             "priority": h.get("priority") if h.get("priority") in PRIOS else "P2",
             "status": h.get("status") if h.get("status") in STATUSES else "open",
             "title": title, "why": clip(h.get("why"), 240), "plan": clip(h.get("plan"), 12),
             "note": clip(h.get("note"), 240), "created": created, "updated": updated}
        link = str(h.get("link", ""))
        if re.fullmatch(r"https://[^\s\"'<>]{1,300}", link):
            e["link"] = link
        board.append({k: v for k, v in e.items() if v != ""})
    if dropped:
        problems.append(f"{dropped} handoff(s) without a valid sender, receiver or title were dropped")
    keep_closed = {h["id"] for h in [h for h in board if h["status"] not in ACTIVE and age_days(h["updated"]) <= 30][-80:]}
    board = [h for h in board if h["status"] in ACTIVE or h["id"] in keep_closed]
    write("handoffs.json", board)
    d["handoffs"] = [h for h in board if h["status"] in ACTIVE or age_days(h["updated"]) <= 7]
    new = [h for h in board if h["id"] not in {str(x.get("id")) for x in hprev if isinstance(x, dict)}]

    # ledger.json: one line per shift, with what it cost
    ledger = read("ledger.json")
    if not isinstance(ledger, list):
        ledger = at_base("ledger.json")
        ledger = ledger if isinstance(ledger, list) else []
    costd = read(env("COST_FILE") or "")
    costd = costd if isinstance(costd, dict) else {}
    entry = {"stamp": env("STAMP"), "slot": env("SLOT_ID"), "lane": env("LANE"), "bot": bot,
             "item": clip(card.get("item"), 16), "summary": clip(card.get("summary"), 160),
             "result": clip(env("RESULT"), 160), "cost": num(costd.get("usd"), 0, 500),
             "turns": int(num(costd.get("turns"), 0, 10000) or 0) or None,
             "minutes": num(costd.get("minutes"), 0, 600), "commit": env("SHIPPED"), "run": env("RUN_URL")}
    entry = {k: v for k, v in entry.items() if v not in (None, "")}
    ledger = [e for e in ledger if isinstance(e, dict)] + [entry]
    ledger = ledger[-1500:]
    write("ledger.json", ledger)
    d["shifts"] = ledger[-24:]

    spent = [(stamp_time(e.get("stamp")), e["cost"]) for e in ledger if isinstance(e.get("cost"), (int, float))]
    spent = [(t, c) for t, c in spent if t]
    recent = [c for _, c in spent][-20:]
    d["cost"] = {
        "last": entry.get("cost"),
        "today": round(sum(c for t, c in spent if t.date() == TODAY), 2),
        "week": round(sum(c for t, c in spent if (NOW - t).total_seconds() < 7 * 86400), 2),
        "month": round(sum(c for t, c in spent if (t.year, t.month) == (NOW.year, NOW.month)), 2),
        "avg": round(sum(recent) / len(recent), 2) if recent else None,
        "days": [{"date": (TODAY - datetime.timedelta(days=i)).isoformat(),
                  "usd": round(sum(c for t, c in spent if t.date() == TODAY - datetime.timedelta(days=i)), 2)}
                 for i in range(13, -1, -1)],
        "estimated": True,
    }
    briefs = sorted(glob.glob("briefs/*.md"))
    if briefs:
        d["brief"] = briefs[-1]

    # Header facts the pipeline owns
    d["updated"] = NOW.isoformat(timespec="seconds")
    d["autopilot"] = {
        "next": env("NEXT_SHIFT") or (d.get("autopilot") or {}).get("next", ""),
        "cadence": "every 3 hours",
        "where": "cloud",
        "last": {k: v for k, v in {"stamp": env("STAMP"), "lane": env("LANE"), "bot": bot,
                                   "result": env("RESULT") or "", "cost": entry.get("cost"),
                                   "run": env("RUN_URL")}.items() if v not in (None, "")},
    }

    # Production, straight from the server's status file and live checks
    def put(lbl, value, state):
        prod = d.setdefault("production", [])
        for p in prod:
            if isinstance(p, dict) and p.get("label") == lbl:
                p.update(value=value, state=state)
                return
        prod.append({"label": lbl, "value": value, "state": state})

    code = env("SITE_CODE") or ""
    put("Site", "Online" if code == "200" else f"Not loading (HTTP {code or 'no answer'})", "ok" if code == "200" else "bad")
    api = (env("API_STATUS") or "").lower()
    put("API", "Healthy" if api in ("ok", "healthy") else (api or "No answer"), "ok" if api in ("ok", "healthy") else "bad")
    ops = parse(env("OPS") or "") or {}
    if isinstance(ops, dict) and ops:
        c = ops.get("containers") or {}
        sc = str(c.get("wp_scraper", "missing"))
        put("News intake", "Live" if sc == "running" else f"Scraper {sc}", "ok" if sc == "running" else "bad")
        days = ops.get("cert_days_left")
        if isinstance(days, int) and days >= 0:
            put("Certificate", f"{days} days left", "ok" if days >= 21 else "warn" if days >= 14 else "bad")
        disk = ops.get("disk_used_pct")
        if isinstance(disk, int):
            put("Disk", f"{disk}% used", "ok" if disk < 80 else "warn" if disk < 90 else "bad")
        words = {"success": ("Live", "ok"), "success_with_warnings": ("Live, with warnings", "warn"),
                 "rolled_back": ("Rolled back", "bad"), "failed": ("Failed", "bad"),
                 "running": ("Deploying…", "warn"), "starting": ("Deploying…", "warn")}
        w, st = words.get(str(ops.get("last_deploy") or "none"), (str(ops.get("last_deploy") or "none"), "warn"))
        put("Last deploy", f"{w} · {ops.get('commit') or '?'}", st)

    # Devon's inbox: say when Claude can't be reached; clear it once shifts run again
    inbox = [x for x in d.get("inbox", []) if isinstance(x, dict)]
    problem = (env("API_PROBLEM") or "").strip()
    if problem:
        if not any(str(x.get("text", "")).startswith(API_PREFIX) and not x.get("done") for x in inbox):
            inbox.insert(0, {"text": f"{API_PREFIX}: {problem[:160]} (fix the key or add credits in the Claude Console)", "done": False})
    elif env("CLAUDE_OUTCOME") in ("success", "failure"):
        # Claude answered, so the key is in place and working
        for x in inbox:
            if str(x.get("text", "")).startswith(API_PREFIX) or "ANTHROPIC_API_KEY" in str(x.get("text", "")):
                x["done"] = True
    d["inbox"] = inbox

    # Activity log: the shift, and any new handoffs between floors
    result, lane = env("RESULT") or "", env("LANE") or "shift"
    by = f" ({label(bot)})" if bot else ""
    if problem:
        text = f"{lane} shift couldn't start: the Claude API turned the key away"
    elif env("CLAUDE_OUTCOME") == "failure" and not result.startswith("shipped"):
        text = f"{lane} shift{by} didn't finish cleanly; details in the report"
    elif result.startswith(("parked", "blocked")):
        text = f"{lane} shift{by}: change held back ({result.split(': ', 1)[-1]})"
    else:
        text = f"{lane} shift{by}: {result or 'done'}"
    log = [x for x in d.get("log", []) if isinstance(x, dict)]
    log.append({"time": clock(NOW), "who": "Orbit", "text": text[:200]})
    if new:
        routes = ", ".join(f"{label(h['from'])} → {label(h['to'])}" for h in new[:3])
        more = f" and {len(new) - 3} more" if len(new) > 3 else ""
        log.append({"time": clock(NOW), "who": "Comms", "text": f"New handoff{'s' if len(new) > 1 else ''}: {routes}{more}"[:200]})
    d["log"] = log[-12:]

    write("hq-data.json", d)
    print("; ".join(problems))


# ── status ───────────────────────────────────────────────────────────────────
def status():
    d = read("hq-data.json")
    d = d if isinstance(d, dict) else {}
    cell = lambda v: clip(v, 300).replace("|", "/")
    names = {t.get("id"): t.get("name") for t in d.get("team", []) if isinstance(t, dict)}
    floors = {x.get("id"): x.get("name") for x in d.get("departments", []) if isinstance(x, dict)}
    label = lambda i: "Devon" if i == "devon" else names.get(i) or floors.get(i) or i
    ap = d.get("autopilot") or {}
    last = ap.get("last") or {}
    cost = d.get("cost") or {}
    money = lambda v: f"${v:,.2f}" if isinstance(v, (int, float)) else "—"

    out = ["# Orbit — WorldPulse autopilot status", "",
           f"_Updated {cell(d.get('updated'))} · next shift {cell(ap.get('next'))} (every 3 hours)_", ""]
    if d.get("headline"):
        out += [f"**{cell(d['headline'])}**", ""]
    report, run = env("REPORT") or "", env("RUN_URL") or ""
    out.append(f"**Last shift:** {cell(last.get('lane'))}{' · ' + cell(label(last.get('bot'))) if last.get('bot') else ''}"
               f" — {cell(last.get('result'))}" + (f" · [report]({report})" if report else "") + (f" · [run log]({run})" if run else ""))
    if cost:
        out += ["", f"**Claude spend (estimated):** {money(cost.get('last'))} last shift · {money(cost.get('today'))} today · "
                    f"{money(cost.get('week'))} last 7 days · {money(cost.get('month'))} this month"]
    if d.get("brief"):
        out += ["", f"**Weekly brief:** [{cell(d['brief'])}]({d['brief']})"]

    out += ["", "## Production", "", "| | |", "|---|---|"]
    for p in d.get("production") or []:
        if isinstance(p, dict):
            mark = {"ok": "OK", "warn": "check", "bad": "PROBLEM"}.get(p.get("state"), "")
            out.append(f"| {cell(p.get('label'))} | {cell(p.get('value'))}{(' · ' + mark) if mark else ''} |")

    pl = d.get("plan") or {}
    out += ["", f"## Plan: {cell(pl.get('done'))} of {cell(pl.get('total'))} done", "", f"Next up: {cell(pl.get('next'))}"]

    todo = [x for x in d.get("inbox") or [] if isinstance(x, dict) and not x.get("done")]
    out += ["", "## Needs you", ""] + ([f"- [ ] {cell(x.get('text'))}" for x in todo] or ["Nothing right now."])

    act = [h for h in d.get("handoffs") or [] if isinstance(h, dict) and h.get("status") in ACTIVE]
    order = {p: i for i, p in enumerate(PRIOS)}
    act.sort(key=lambda h: (order.get(h.get("priority"), 9), h.get("created", "")))
    out += ["", f"## Between floors ({len(act)} open)", ""]
    out += [f"- **{cell(h.get('priority'))}** {cell(label(h.get('from')))} → {cell(label(h.get('to')))}: {cell(h.get('title'))}"
            f" _({cell(str(h.get('status', '')).replace('_', ' '))})_" for h in act[:12]] or ["No open handoffs."]

    out += ["", "## Recent shifts", "", "| When | Shift | Who | Result | Cost |", "|---|---|---|---|---|"]
    for e in reversed([e for e in d.get("shifts") or [] if isinstance(e, dict)][-8:]):
        t = stamp_time(e.get("stamp"))
        when = t.strftime("%a %-I:%M %p") if t else cell(e.get("stamp"))
        out.append(f"| {when} | {cell(e.get('lane'))} | {cell(label(e.get('bot')) or '')} | {cell(e.get('result'))} | {money(e.get('cost'))} |")

    out += ["", "## Team", "", "| Bot | Status | Now |", "|---|---|---|"]
    for t in d.get("team") or []:
        if isinstance(t, dict):
            out.append(f"| {cell(t.get('name'))} · {cell(t.get('role'))} | {cell(t.get('status'))} | {cell(t.get('now'))} |")

    out += ["", "## Recent activity", ""]
    for x in reversed([x for x in d.get("log") or [] if isinstance(x, dict)][-8:]):
        out.append(f"- {cell(x.get('time'))} · **{cell(x.get('who'))}** — {cell(x.get('text'))}")
    out += ["", "_Rewritten after every shift. To change priorities, edit PLAN.md._", ""]
    with open("STATUS.md", "w", encoding="utf-8") as fh:
        fh.write("\n".join(out))


if __name__ == "__main__":
    {"migrate": migrate, "update": update, "status": status}.get(
        sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit("usage: autopilot_hq.py migrate DIR|update|status"))()

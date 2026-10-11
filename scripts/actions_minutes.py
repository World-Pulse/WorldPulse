#!/usr/bin/env python3
"""Billable GitHub Actions minutes for a repository this month.

GitHub bills a private repo's jobs on its hosted runners per job, rounded up to
the whole minute, and the free plan includes 2,000 minutes a month for the
organization. The billing API isn't open to repository-scoped tokens (the
autopilot's or Claude's), so this adds up each job's own start and end times
from the Actions API instead.

Usage:
    python3 scripts/actions_minutes.py [--repo OWNER/NAME] [--month YYYY-MM] [--limit 2000]

Prints one JSON object:
    month, minutes, runs, jobs, by_workflow, by_day, pace_per_day (average over
    the last 7 days with runs), projected (minutes + pace x days left in the
    month), limit, percent, checked_at
Needs the gh CLI signed in with read access to the repository's Actions.
"""

import argparse
import calendar
import datetime
import json
import math
import subprocess
import sys


def gh_json(path):
    out = subprocess.run(["gh", "api", path], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def gh_paginated(path, key):
    out = subprocess.run(["gh", "api", "--paginate", path, "--jq", f".{key}[]"],
                         check=True, capture_output=True, text=True).stdout
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def parse_time(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", default="World-Pulse/WorldPulse-v2")
    ap.add_argument("--month", default=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m"))
    ap.add_argument("--limit", type=int, default=2000)
    args = ap.parse_args()

    year, month = (int(x) for x in args.month.split("-"))
    days_in_month = calendar.monthrange(year, month)[1]
    first, last = f"{args.month}-01", f"{args.month}-{days_in_month:02d}"
    runs = gh_paginated(f"repos/{args.repo}/actions/runs?per_page=100&created={first}..{last}", "workflow_runs")

    minutes, jobs = 0, 0
    by_workflow, by_day = {}, {}
    for run in runs:
        if run.get("status") != "completed":
            continue
        data = gh_json(f"repos/{args.repo}/actions/runs/{run['id']}/jobs?per_page=100")
        for job in data.get("jobs", []):
            if not job.get("started_at") or not job.get("completed_at"):
                continue
            secs = (parse_time(job["completed_at"]) - parse_time(job["started_at"])).total_seconds()
            if secs <= 0:
                continue
            billed = math.ceil(secs / 60)
            minutes += billed
            jobs += 1
            name = run.get("name") or "?"
            by_workflow[name] = by_workflow.get(name, 0) + billed
            day = job["started_at"][:10]
            by_day[day] = by_day.get(day, 0) + billed

    now = datetime.datetime.now(datetime.timezone.utc)
    today = now.date()
    in_month = today.year == year and today.month == month
    # Pace: average per day over the last 7 days that are in this month (from
    # the first day with runs, so a quiet start of the month doesn't hide it)
    if by_day:
        start = max(datetime.date(year, month, 1), datetime.date.fromisoformat(min(by_day)))
        end = today if in_month else datetime.date(year, month, days_in_month)
        window_start = max(start, end - datetime.timedelta(days=6))
        days = (end - window_start).days + 1
        window = sum(v for d, v in by_day.items() if window_start <= datetime.date.fromisoformat(d) <= end)
        pace = window / days if days > 0 else 0.0
    else:
        pace = 0.0
    days_left = (days_in_month - today.day) if in_month else 0
    projected = round(minutes + pace * days_left)

    print(json.dumps({
        "month": args.month,
        "minutes": minutes,
        "runs": len(runs),
        "jobs": jobs,
        "by_workflow": dict(sorted(by_workflow.items(), key=lambda kv: -kv[1])),
        "by_day": dict(sorted(by_day.items())),
        "pace_per_day": round(pace, 1),
        "projected": projected,
        "limit": args.limit,
        "percent": round(100 * minutes / args.limit, 1) if args.limit else None,
        "checked_at": now.isoformat(timespec="seconds"),
    }))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as err:
        sys.exit(f"GitHub API request failed: {(err.stderr or '').strip()[:300]}")

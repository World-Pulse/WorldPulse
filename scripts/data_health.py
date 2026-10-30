#!/usr/bin/env python3
"""
Data health (plan N3, Oct 24, 2026): is the data still coming in, and is anything
silently broken? One check per part of the pipeline and the server, each "ok",
"warn" or "alarm" with one plain line, read from the status file ops-status.sh has
just put together and written back into it as "data_health".

Why: on Oct 22-23 one GDELT file in four was lost for hours, and on Oct 24 the
first nightly database copy failed, and nothing said so. Every number here is
already in the status file; this only reads it against the clock. No secrets,
logs or user data.

Run: python3 scripts/data_health.py <status.json>   (rewrites it in place; on any
error it leaves the file as it was and exits 1, so the status file still goes out)
Tests: python3 -m unittest scripts/test_data_health.py
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

ORDER = {'ok': 0, 'warn': 1, 'alarm': 2}

# Thresholds, in minutes unless named otherwise. Each is well past the part's
# normal rhythm (the scraper reports every few minutes, GDELT every 15, the
# editor every 15, fingerprints every 10, the copy once a day).
NEWEST_REPORT = (30, 90)       # no new report for this long
NEWEST_VERIFIED = (120, 360)   # no report turned verified for this long
GDELT_FILES_6H = (20, 14)      # files read in the last 6 full hours (4 an hour): warn under, alarm under
GDELT_CYCLE = (45, 120)        # the second-outlet reader's last cycle
EDITOR = (40, 180)             # the editor's last pass
FINGERPRINTS = (60, 360)       # the fingerprints' last run
PIPELINE_COUNTS = (45, 120)    # the pipeline counts themselves (made every 30 minutes)
REPORT_RATE = (0.5, 0.2)       # last 6 hours against the same hours a week ago: warn under, alarm under
REPORT_RATE_MIN = 60           # ... only when the week before had this many
FEEDS_FAILING = (12, 40)       # sources and news feeds failing at once
FEED_DAY_FAILS = 7             # a news feed's failed polls in a row by which it has failed for a day (see below)
FEEDS_DEAD = 12                # news feeds failing for over a day: past this many, time to fix or drop them
BACKUP_AGE_H = 30              # the last copy's age, hours
DISK_GB = (10, 4)              # free disk: warn under, alarm under
CERT_DAYS = (21, 7)            # certificate days left: warn under, alarm under
MAINTENANCE_H = 30             # the daily maintenance's last run, hours


ISO = re.compile(r'^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d+))?(?:(Z)|([+-])(\d\d):?(\d\d)?)?$')


def ts(value):
    """Seconds since 1970 for an ISO time ('2026-10-24T14:05:03+00:00', '...068Z', Postgres's
    '...03.0297+00'), or None. By hand: older Pythons' fromisoformat takes neither Z nor 4 decimals"""
    if not isinstance(value, str):
        return None
    m = ISO.match(value.strip())
    if not m:
        return None
    day, clock, frac, _z, sign, oh, om = m.groups()
    try:
        t = datetime.strptime(f'{day} {clock}', '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None
    if frac:
        t += int(frac[:6].ljust(6, '0')) / 1e6
    if sign:
        offset = int(oh) * 3600 + int(om or 0) * 60
        t -= offset if sign == '+' else -offset
    return t


def words(minutes):
    """'4 minutes', '2 hours', '3 days'"""
    m = int(round(minutes))
    if m < 120:
        return f'{m} minute{"" if m == 1 else "s"}'
    h = m // 60
    if h < 48:
        return f'{h} hours'
    return f'{h // 24} days'


def by_age(minutes, limits):
    warn, alarm = limits
    return 'alarm' if minutes > alarm else 'warn' if minutes > warn else 'ok'


def n(v):
    return f'{v:,}'


def health(status, now=None):
    """The data_health block for one status file (a dict)"""
    now = time.time() if now is None else now
    checks = []

    def add(key, state, line):
        checks.append({'key': key, 'status': state, 'line': line})

    p = status.get('pipeline') if isinstance(status.get('pipeline'), dict) else None
    if p is None:
        add('pipeline', 'alarm', "The pipeline's counts are missing from the status file")
        p = {}
    checked = ts(p.get('checked'))
    at = checked or now   # ages are measured at the time the counts were made
    if checked:
        age = (now - checked) / 60
        state = by_age(age, PIPELINE_COUNTS)
        if state != 'ok':
            add('pipeline', state, f"The pipeline's counts are {words(age)} old (they are made every 30 minutes)")
    failed = [f for f in (p.get('failed') or []) if isinstance(f, str)]
    if failed:
        add('parts', 'warn', 'Not read this time: ' + ', '.join(failed[:8]))

    db = p.get('db') if isinstance(p.get('db'), list) else []
    d0 = db[0] if len(db) > 0 and isinstance(db[0], dict) else None
    d1 = db[1] if len(db) > 1 and isinstance(db[1], dict) else None

    # Reports coming in
    newest = ts(d0.get('newest_signal')) if d0 else None
    if newest:
        age = max(0.0, (at - newest) / 60)
        state = by_age(age, NEWEST_REPORT)
        add('reports', state, f'Newest report {words(age)} old' if state == 'ok' else f'No new report for {words(age)}')
    elif d0 is not None:
        add('reports', 'alarm', 'No report in the last 24 hours')

    rate = p.get('report_rate') if isinstance(p.get('report_rate'), dict) else None
    if rate and isinstance(rate.get('last_6h'), int) and isinstance(rate.get('week_ago_6h'), int):
        now6, then6 = rate['last_6h'], rate['week_ago_6h']
        line = f'{n(now6)} reports in the last 6 hours ({n(then6)} in the same hours a week ago)'
        state = 'ok'
        if then6 >= REPORT_RATE_MIN:
            share = now6 / then6
            state = 'alarm' if share < REPORT_RATE[1] else 'warn' if share < REPORT_RATE[0] else 'ok'
        add('report_rate', state, line)

    # Reports turning verified
    nv = ts(d1.get('newest_verified')) if d1 else None
    if nv:
        age = max(0.0, (at - nv) / 60)
        state = by_age(age, NEWEST_VERIFIED)
        add('verified', state, f'Newest verified report {words(age)} old' if state == 'ok' else f'No report turned verified for {words(age)}')

    # GDELT's file list (the second outlet): 4 files an hour
    g = p.get('gdelt') if isinstance(p.get('gdelt'), dict) else None
    if g:
        hours = g.get('last_24h') if isinstance(g.get('last_24h'), dict) else {}
        if hours and checked:
            # the 6 full UTC hours before the counts were made
            top = int(checked // 3600) * 3600
            keys = [time.strftime('%Y%m%d%H', time.gmtime(top - 3600 * i)) for i in range(1, 7)]
            got = sum(int(hours.get(k) or 0) for k in keys)
            low = [k for k in keys if int(hours.get(k) or 0) < 4]
            state = 'alarm' if got < GDELT_FILES_6H[1] else 'warn' if got < GDELT_FILES_6H[0] else 'ok'
            line = f"GDELT's files: {got} of 24 read in the last 6 hours"
            if low and state != 'ok':
                line += ' (short: ' + ', '.join(f'{k[8:10]}:00 UTC' for k in sorted(low)[:4]) + ')'
            add('gdelt', state, line)
        cyc = g.get('last_cycle') if isinstance(g.get('last_cycle'), dict) else None
        if cyc:
            c_at = ts(cyc.get('at'))
            missing = cyc.get('missing') or []
            failed_files = cyc.get('failed') or []
            if c_at:
                age = max(0.0, (at - c_at) / 60)
                state = by_age(age, GDELT_CYCLE)
                if state != 'ok':
                    add('gdelt_cycle', state, f"GDELT's reader last ran {words(age)} ago (every 15 minutes)")
            if missing or failed_files:
                add('gdelt_files', 'warn', f"GDELT's last cycle: {len(missing)} file(s) missing, {len(failed_files)} failed")

    # Feeds
    src = p.get('sources') if isinstance(p.get('sources'), dict) else None
    if src:
        nf = src.get('news_feeds') if isinstance(src.get('news_feeds'), dict) else {}
        s_fail, f_fail = int(src.get('failing') or 0), int(nf.get('failing') or 0)
        # Oct 30, 2026: a news feed that has failed for over a day (a site that turns us away, a feed
        # that is gone) is one to fix or drop, not part of a failure "at once", so it counts against a
        # limit of its own. The scraper pauses a feed for 6 hours after 3 failed polls 30 minutes apart
        # and then tries it once a pause (news-rss.ts), so 7 failures in a row is about a day. The list
        # holds the 40 feeds with the most failures, so those not listed have fewer. That morning 5 of
        # the 12 failing feeds had failed for 1 to 5 days, and two one-off refusals took the count past 12.
        dead = sum(1 for f in nf.get('list') or [] if isinstance(f, dict) and int(f.get('fails') or 0) >= FEED_DAY_FAILS)
        total = s_fail + f_fail - dead
        state = 'alarm' if total > FEEDS_FAILING[1] else 'warn' if total > FEEDS_FAILING[0] or dead > FEEDS_DEAD else 'ok'
        line = f'{s_fail} source{"" if s_fail == 1 else "s"} and {f_fail} news feed{"" if f_fail == 1 else "s"} failing'
        if dead:
            line += f', {dead} of the feeds for over a day'
        # the longest failing source: never worked, else the oldest last success
        worst = None
        for item in src.get('list') or []:
            if not isinstance(item, dict):
                continue
            key = (0 if item.get('last_worked') is None else 1, ts(item.get('last_worked')) or 0)
            if worst is None or key < worst[0]:
                worst = (key, item)
        if worst:
            item = worst[1]
            since = ts(item.get('last_worked'))
            when = 'no success on record' if since is None else f'last worked {words((at - since) / 60)} ago'
            line += f" (longest: {item.get('name') or item.get('slug')}, {item.get('why') or 'failing'}, {when})"
        add('feeds', state, line)

    # Claude: the editor, failures, the monthly cap
    cl = p.get('claude') if isinstance(p.get('claude'), dict) else None
    if cl:
        ed = cl.get('editor_last_pass') if isinstance(cl.get('editor_last_pass'), dict) else None
        e_at = ts(ed.get('at')) if ed else None
        if e_at:
            age = max(0.0, (at - e_at) / 60)
            state = by_age(age, EDITOR)
            line = f"The editor's last pass {words(age)} ago"
            if ed.get('stopped'):
                state = max(state, 'warn', key=ORDER.get)
                line += ' (it stopped early)'
            add('editor', state, line)
        since = ts(cl.get('failing_since'))
        if since:
            add('claude', 'alarm', f"Claude's calls have failed for {words((at - since) / 60)} ({int(cl.get('failing_calls') or 0)} calls)")
        cap, month = cl.get('cap_usd_month'), cl.get('spent_usd_month')
        if isinstance(cap, (int, float)) and cap > 0 and isinstance(month, (int, float)):
            share = month / cap
            if share >= 0.9:
                add('claude_cap', 'alarm' if share >= 1 else 'warn', f"Claude's spend this month: ${month:.2f} of the ${cap:.0f} cap")

    # Fingerprints (the in-house text fingerprints)
    fp = p.get('fingerprints') if isinstance(p.get('fingerprints'), dict) else None
    if fp:
        run = fp.get('last_run') if isinstance(fp.get('last_run'), dict) else {}
        f_at = ts(run.get('at'))
        if f_at:
            age = max(0.0, (at - f_at) / 60)
            state = by_age(age, FINGERPRINTS)
            if fp.get('model_ready') is False or fp.get('error'):
                state = max(state, 'warn', key=ORDER.get)
            add('fingerprints', state, f'Fingerprints last ran {words(age)} ago' + (' (the model is not ready)' if fp.get('model_ready') is False else ''))

    # The server: the database copy, disk, certificate, containers, deploys, maintenance
    b = status.get('backup')
    if not isinstance(b, dict):
        add('backup', 'warn', 'No database copy made yet')
    else:
        b_at = ts(b.get('at'))
        kept = len(b.get('kept') or [])
        if b.get('ok') is False:
            add('backup', 'alarm', f"The last database copy failed ({(b.get('note') or '').strip() or 'no reason given'}); "
                                    f"{kept} cop{'y' if kept == 1 else 'ies'} kept")
        elif b_at and (now - b_at) / 3600 > BACKUP_AGE_H:
            add('backup', 'warn', f"The last database copy is {words((now - b_at) / 60)} old; {kept} kept")
        elif b_at:
            add('backup', 'ok', f"Database copy made {words(max(0.0, (now - b_at) / 60))} ago; {kept} kept")
        else:
            add('backup', 'ok', f'Database copy made; {kept} kept')
        rt = b.get('restore_test')
        if isinstance(rt, dict) and rt.get('ok') is False:
            add('restore_test', 'warn', f"The last restore test didn't match the live database ({(rt.get('note') or '').strip()[:120]})")

    free = status.get('disk_free_gb')
    if isinstance(free, (int, float)):
        state = 'alarm' if free < DISK_GB[1] else 'warn' if free < DISK_GB[0] else 'ok'
        add('disk', state, f'{free} GB of disk free')

    days = status.get('cert_days_left')
    if isinstance(days, (int, float)):
        state = 'alarm' if days < CERT_DAYS[1] else 'warn' if days < CERT_DAYS[0] else 'ok'
        if state != 'ok':
            add('certificate', state, f'The HTTPS certificate expires in {days} days')

    cont = status.get('containers') if isinstance(status.get('containers'), dict) else {}
    down = sorted(k for k, v in cont.items() if v != 'running')
    if down:
        add('containers', 'alarm', 'Not running: ' + ', '.join(f'{k} ({cont[k]})' for k in down[:6]))

    if status.get('last_deploy') in ('failed', 'rolled_back'):
        note = (status.get('last_deploy_note') or '').strip()
        add('deploy', 'warn', f"The last deploy {'rolled back' if status['last_deploy'] == 'rolled_back' else 'failed'}" + (f': {note[:120]}' if note else ''))

    m = status.get('last_maintenance')
    if isinstance(m, str) and m and m != 'none':
        parts = m.split()
        m_at = ts(parts[-1]) if parts else None
        if parts and parts[0] != 'ok':
            add('maintenance', 'warn', f"The daily maintenance didn't end well ({m[:80]})")
        elif m_at and (now - m_at) / 3600 > MAINTENANCE_H:
            add('maintenance', 'warn', f'The daily maintenance last ran {words((now - m_at) / 60)} ago')

    worst = max((c['status'] for c in checks), key=ORDER.get, default='ok')
    bad = [c for c in checks if c['status'] != 'ok']
    bad.sort(key=lambda c: -ORDER[c['status']])
    if bad:
        alarms = sum(1 for c in bad if c['status'] == 'alarm')
        warns = len(bad) - alarms
        head = ', '.join(x for x in (f'{alarms} alarm{"" if alarms == 1 else "s"}' if alarms else '',
                                       f'{warns} warning{"" if warns == 1 else "s"}' if warns else '') if x)
        line = f'{head}: ' + '; '.join(c['line'] for c in bad[:3])
    else:
        line = f'Data: ok ({len(checks)} checks)'
    return {
        'status': worst,
        'line': line,
        'checked': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now)),
        'checks': checks,
    }


def main(path):
    with open(path, encoding='utf-8') as fh:
        status = json.load(fh)
    status['data_health'] = health(status)
    tmp = path + '.health.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(status, fh, separators=(',', ':'), ensure_ascii=False)
        fh.write('\n')
    os.replace(tmp, path)


if __name__ == '__main__':
    try:
        main(sys.argv[1])
    except Exception as err:  # the status file goes out without the block rather than not at all
        print(f'data_health: {type(err).__name__}: {err}', file=sys.stderr)
        sys.exit(1)

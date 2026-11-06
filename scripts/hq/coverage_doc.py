import datetime, json, sys

# (Nov 6, 2026: HQ's hourly cloud sync is to run this script, word for word in its instructions; until it
# does, it is run by hand after a feed change. This copy is for reading and for that.)
# The Dev Room's Coverage tab (hq/coverage), from the coverage block of the live site's status file
# (Devon, Nov 6, 2026: "Update the coverage map automatically when these updates happen"). The news
# poller lists each place's feeds when it starts and every cycle; the status file adds the verified
# reports of the last 7 days; this adds which places got new feeds in the last 7 days, by comparing
# with the previous document. Usage:
#   python3 coverage_doc.py ops-status.json previous-coverage.json coverage-doc.json
# (the previous document may be missing). Prints "ok N places".

NEW_DAYS = 7
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
WORDS = "no one two three four five six seven eight nine".split()


def load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
    except (OSError, ValueError):
        return {}
    if isinstance(d, dict) and isinstance(d.get("data"), dict):
        d = d["data"]
    return d if isinstance(d, dict) else {}


def num(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else 0


def count(n, one, many):
    return f"{WORDS[n] if n < 10 else f'{n:,}'} {one if n == 1 else many}"


def joined(xs):
    xs = list(xs)
    if len(xs) < 2:
        return "".join(xs)
    return ", ".join(xs[:-1]) + " and " + xs[-1]


def eastern(t):
    """UTC to New York time (daylight time from the 2nd Sunday of March to the 1st Sunday of November)"""
    mar = datetime.datetime(t.year, 3, 8, 7, tzinfo=datetime.timezone.utc)
    nov = datetime.datetime(t.year, 11, 1, 6, tzinfo=datetime.timezone.utc)
    start = mar + datetime.timedelta(days=(6 - mar.weekday()) % 7)
    end = nov + datetime.timedelta(days=(6 - nov.weekday()) % 7)
    return t + datetime.timedelta(hours=-4 if start <= t < end else -5)


def label(t):
    e = eastern(t)
    return f"{MONTHS[e.month - 1]} {e.day}, {e.year}, {(e.hour + 11) % 12 + 1}:{e.minute:02d} {'AM' if e.hour < 12 else 'PM'} ET"


ops = load(sys.argv[1])
pipe = ops.get("pipeline") if isinstance(ops.get("pipeline"), dict) else {}
cov = pipe.get("coverage") if isinstance(pipe.get("coverage"), dict) else {}
if not isinstance(cov.get("places"), list) or not cov["places"]:
    sys.exit("the status file has no coverage block yet")
prev = load(sys.argv[2])
prev_by = {p["c"]: p for p in prev.get("places") or [] if isinstance(p, dict) and isinstance(p.get("c"), str)}
grew = {k: v for k, v in (prev.get("grew") if isinstance(prev.get("grew"), dict) else {}).items() if isinstance(v, str)}
reports = cov.get("reports_7d") if isinstance(cov.get("reports_7d"), dict) else None
now = datetime.datetime.now(datetime.timezone.utc)
today = now.strftime("%Y-%m-%d")

places = []
for p in cov["places"]:
    if not (isinstance(p, dict) and isinstance(p.get("c"), str) and isinstance(p.get("n"), str)):
        continue
    c, f, old = p["c"], num(p.get("f")), prev_by.get(p["c"])
    if prev_by and f > (num(old.get("f")) if old else 0):
        grew[c] = today  # more feeds than the last document showed
    s = num(reports.get(c)) if reports is not None else num((old or {}).get("s"))
    place = {"c": c, "n": p["n"][:60], "f": f, "en": num(p.get("en")),
             "l": [x for x in p.get("l") or [] if isinstance(x, str)][:12],
             "o": [x for x in p.get("o") or [] if isinstance(x, str)][:80], "s": s}
    if num(p.get("p")):
        place["p"] = num(p.get("p"))
    if p.get("t"):
        place["t"] = True
    places.append(place)
by = {p["c"]: p for p in places}
keep_from = (now - datetime.timedelta(days=90)).strftime("%Y-%m-%d")
grew = {c: d for c, d in sorted(grew.items()) if c in by and d >= keep_from}
new_from = (now - datetime.timedelta(days=NEW_DAYS)).strftime("%Y-%m-%d")
new = sorted(sorted((c for c, d in grew.items() if d >= new_from), key=lambda c: by[c]["n"]), key=lambda c: grew[c], reverse=True)

counted = [p for p in places if not p.get("t")]
none = [p["n"] for p in counted if not p["f"]]
terr = sorted(p["n"] for p in places if p.get("t"))
src = pipe.get("sources") if isinstance(pipe.get("sources"), dict) else {}
feeds = src.get("news_feeds") if isinstance(src.get("news_feeds"), dict) else {}
db0 = (pipe.get("db") or [None])[0] if isinstance(pipe.get("db"), list) else None
sites24 = num(db0.get("outlets")) if isinstance(db0, dict) else 0
parked = sum(p.get("p", 0) for p in places)
paused = num(feeds.get("paused"))

notes = [
    f"The {len(counted)} are the UN's members and observers plus Kosovo, Taiwan, Hong Kong, Macau, Puerto Rico, "
    "Greenland and New Caledonia. A feed counts for its home country, so international outlets count where "
    f"they're based: many of the United States' {by.get('US', {}).get('f', 0)} and the United Kingdom's "
    f"{by.get('GB', {}).get('f', 0)} are world news services."
    + (f" {count(len(terr), 'other territory has', 'other territories have').capitalize()} feeds of their own "
       f"({joined(terr)}): shown, not counted." if terr else ""),
    ("Reports, 7 days: verified reports pinned in the country over the last 7 days, counted in the live database"
     if reports is not None else
     "Reports, 7 days: the live count didn't come through this time, so these are the last counts HQ had")
    + (f". Counting every source (these feeds, GDELT's links and the data feeds), the last 24 hours' reports "
       f"link to {sites24:,} different websites." if sites24 else "."),
]
if parked or paused:
    where = sorted(p["n"] for p in places if p.get("p"))
    only = sorted(p["n"] for p in places if p.get("p") and p["p"] >= p["f"])
    parts = []
    if parked:
        parts.append(f"{count(parked, 'feed is', 'feeds are').capitalize()} parked ({joined(where)}): the server "
                     "can't read them now (a bot check, or no answer), so each is tried once a day and read as usual "
                     "again once it answers" + (f"; for {joined(only)} that is every feed." if only
                                                else "; none is a place's only feed."))
    if paused:
        parts.append(f"{count(paused, 'feed is', 'feeds are').capitalize()} paused after failing several polls in "
                     "a row; the reader tries each again every 6 hours.")
    notes.append(" ".join(parts))
notes.append(
    "This tab updates itself: the news poller lists its feeds when it starts (so after every deploy) and every "
    "30 minutes, the site's status file takes them up within 30 minutes, and HQ's sync redraws the tab every hour. "
    "Small countries the map's outlines leave out are dots at their capitals. Grey land (Western Sahara, the "
    "Falklands, the French Southern Lands) isn't counted.")

try:
    asof = datetime.datetime.fromisoformat(str(pipe.get("checked"))).astimezone(datetime.timezone.utc)
except ValueError:
    asof = now
out = {
    "asof": asof.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "asof_label": label(asof),
    "listed_at": str(cov.get("at") or "")[:40],
    "made_by": "HQ's cloud sync, from the live site's status file (updates itself since Nov 6, 2026)",
    "places": places,
    "new": new,
    "new_label": f"New feeds, last {NEW_DAYS} days",
    "grew": grew,
    "hints": {
        "none": "Every place on the map has an outlet of its own since Oct 31, 2026." if not none
                else "No news feed of its own yet.",
        "part": "Read in their own languages; no English newsroom or one-country English feed passed the checks.",
        "new": f"Places whose number of feeds rose in the last {NEW_DAYS} days, newest first.",
    },
    "ops": {"tracked": num(src.get("tracked")), "paused": paused, "parked": parked,
            "failing": num(feeds.get("failing")), "sites24": sites24},
    "notes": notes,
    "updated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
}
json.dump(out, open(sys.argv[3], "w", encoding="utf-8"), ensure_ascii=False)
print(f"ok {len(places)} places")

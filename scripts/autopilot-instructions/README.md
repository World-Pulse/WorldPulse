# autopilot-state

This private branch is Orbit's desk: the autopilot reads and updates it every
shift. It never goes to the public mirror and is never deployed.

| File | What it is |
| --- | --- |
| [`STATUS.md`](STATUS.md) | **Start here.** Where things stand: last shift, production, what needs you, the team. Rewritten after every shift. |
| `PLAN.md` | The to-do list Orbit works through. **Edit this to steer the autopilot** (pencil icon → Commit changes). Your edits always win. |
| `handoffs.json` | The handoff board: work one floor passes to another, with priority and status. |
| `briefs/` | Weekly briefs for you, written by the Chief of Staff's Sunday planning shift. |
| `ledger.json` | Every shift so far: lane, bot, result and what it cost. |
| `AUTOPILOT.md` | Orbit's standing instructions. They and the org chart live in `scripts/autopilot-instructions/` on `main` and are reinstalled every shift. |
| `reports/` | One plain-language report per shift. The newest is at the bottom of the list. |
| `departments/` | Non-code work: research reports, drafts for you to publish or send. |
| `hq-data.json` | Data behind the WorldPulse HQ dashboard. |
| `team/` | Specialist notes (security pins, World Map audit). |
| `wip/` | Unfinished work from May 2026, kept for reference. |

Shifts run from `.github/workflows/autopilot.yml` on `main`: one per 3-hour
slot, with hourly catch-up runs in case GitHub starts one late. Watch a shift
live in the repo's **Actions** tab → Autopilot → the running shift.
To pause them, add a repository variable `AUTOPILOT_PAUSED` = `true`
(Settings → Secrets and variables → Actions → Variables).

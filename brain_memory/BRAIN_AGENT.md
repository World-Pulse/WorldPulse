# WorldPulse Brain Agent

## What It Does

The Brain Agent is an autonomous improvement engine that runs on Claude Autopilot.
Every hour it wakes up, scans the competition, analyzes the project, picks the
highest-priority improvement, and executes it using Claude Code — then goes back
to sleep until the next cycle.

It never gets lazy. It never runs out of tasks. It never forgets what it has done.

---

## Architecture

```
brain_agent.py
├── Memory System       → brain_memory/*.json  (persistent across runs)
├── Competition Monitor → scans 6+ competitors, tracks feature gaps & threats
├── Project Analyzer    → git activity, health score, file counts, test coverage
├── Task Generator      → roadmap phases + competitive gaps + efficiency tasks
├── Execution Engine    → runs Claude Code with full WorldPulse context
└── Improvement Logger  → records every task, success/failure, duration
```

---

## Memory Files

| File | Contents |
|------|----------|
| `brain_state.json` | Current health score, completed tasks, cycle count, notes |
| `competition_intel.json` | Competitor profiles, threats, opportunities, feature gaps |
| `improvement_log.json` | History of all executed tasks with success metrics |
| `blockers.md` | Written by Claude when it hits implementation blockers |
| `last_improvement.txt` | Summary of the most recent improvement shipped |

---

## Task Priority System

| Priority | Source | Examples |
|----------|--------|---------|
| 10 | Roadmap | Pre-planned phases from worldpulse_tasks.json |
| 8  | Health Monitor | Fix warnings (missing files, low tests) |
| 7  | Health Monitor | Test coverage improvements |
| 6-9 | Competition Intel | Feature gaps vs Ground News, Reuters, GDELT |
| 4-6 | Brain Efficiency | Performance, caching, observability, DevEx |

---

## Commands

```bash
# Single improvement cycle
python brain_agent.py

# Autopilot loop (runs forever, 1-hour intervals)
python brain_agent.py --loop

# Check current status
python brain_agent.py --status

# Competition scan only
python brain_agent.py --compete

# Dry run (plans but doesn't execute)
python brain_agent.py --dry-run

# Custom budget
python brain_agent.py --budget 12

# Stop the loop
touch .brain_kill    # Linux/Mac
echo > .brain_kill   # Windows
```

---

## Competitors Being Tracked

- **Reuters Connect** — legacy wire, expensive, closed
- **AP Wire** — 150yr authority, no social layer
- **Ground News** — closest competitor, no open-source
- **GDELT Project** — massive data, no UI
- **NewsGuard** — credibility scoring, closed methodology
- **Logically AI** — AI fact-checking, B2B only

---

## How WorldPulse Wins

1. **Open source** — Reuters/AP will never open-source their stack
2. **Self-hostable** — newsrooms can run their own instance
3. **Real-time reliability scoring** — transparent, community-driven
4. **Developer-first API** — designed for builders, not just readers
5. **Social verification layer** — crowdsourced journalism intelligence
6. **Free at the core** — AP/Reuters charge $50k+/year

---

*The brain agent was initialized on 2026-03-21 and has been improving WorldPulse ever since.*

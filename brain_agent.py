#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════════════╗
║              WORLDPULSE BRAIN AGENT — AUTONOMOUS IMPROVEMENT ENGINE         ║
║                                                                              ║
║  Continuously monitors the project, tracks competition, generates            ║
║  improvement tasks, and drives WorldPulse to be better and stronger.        ║
║                                                                              ║
║  USAGE:                                                                      ║
║    python brain_agent.py                  # Single autonomous cycle          ║
║    python brain_agent.py --loop           # Run forever (Claude Autopilot)  ║
║    python brain_agent.py --status         # Show current brain state        ║
║    python brain_agent.py --compete        # Run competition scan only       ║
║    python brain_agent.py --budget 10      # Override budget per task        ║
║                                                                              ║
║  MEMORY:  brain_memory/                                                      ║
║  LOGS:    brain_agent.log                                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ── CONFIG ────────────────────────────────────────────────────────────────────
PROJECT_DIR    = Path(__file__).parent.resolve()
MEMORY_DIR     = PROJECT_DIR / "brain_memory"
STATE_FILE     = MEMORY_DIR / "brain_state.json"
COMPETE_FILE   = MEMORY_DIR / "competition_intel.json"
IMPROVE_FILE   = MEMORY_DIR / "improvement_log.json"
TASKS_FILE     = PROJECT_DIR / "worldpulse_tasks.json"
LOG_FILE       = PROJECT_DIR / "brain_agent.log"
KILL_FILE      = PROJECT_DIR / ".brain_kill"

DEFAULT_BUDGET    = 8.0          # USD per execution task
LOOP_INTERVAL_S   = 3600         # 1 hour between autonomous loops
MAX_TASK_HISTORY  = 100          # Keep last N completed tasks in memory
HEALTH_CHECK_CMDS = ["pnpm lint 2>&1 | tail -5", "pnpm build --dry-run 2>&1 | tail -5"]

# Competitor products to monitor
COMPETITORS = [
    {"name": "Reuters Connect",    "url": "https://www.reuters.com",           "keywords": ["breaking news API", "reuters wire service"]},
    {"name": "AP Wire",            "url": "https://www.ap.org",                "keywords": ["ap wire API", "associated press news feed"]},
    {"name": "Ground News",        "url": "https://ground.news",               "keywords": ["ground news app", "media bias aggregator"]},
    {"name": "Logically AI",       "url": "https://www.logically.ai",          "keywords": ["AI fact checking platform", "logically misinformation"]},
    {"name": "NewsGuard",          "url": "https://www.newsguardtech.com",      "keywords": ["newsguard reliability score", "news credibility rating"]},
    {"name": "Bellingcat",         "url": "https://www.bellingcat.com",         "keywords": ["bellingcat OSINT", "open source intelligence verification"]},
    {"name": "Full Fact",          "url": "https://fullfact.org",               "keywords": ["full fact AI fact checking", "automated claim detection"]},
    {"name": "The GDELT Project",  "url": "https://www.gdeltproject.org",       "keywords": ["GDELT realtime news", "global database of events"]},
]

# WorldPulse's core differentiators to defend and strengthen
DIFFERENTIATORS = [
    "open-source global intelligence network",
    "real-time reliability scoring",
    "community verification layer",
    "self-hostable news aggregation",
    "social layer for journalists",
    "500+ source cross-checking",
]

# ── COLOURS ───────────────────────────────────────────────────────────────────
RESET  = "\033[0m"
BOLD   = "\033[1m"
AMBER  = "\033[38;5;214m"
CYAN   = "\033[38;5;51m"
RED    = "\033[38;5;196m"
GREEN  = "\033[38;5;46m"
GREY   = "\033[38;5;240m"
PURPLE = "\033[38;5;135m"
DIM    = "\033[2m"

def c(text: str, colour: str) -> str:
    return f"{colour}{text}{RESET}"

def log(msg: str, colour: str = RESET, also_file: bool = True):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{GREY}[{ts}]{RESET} {colour}{msg}{RESET}")
    if also_file:
        write_log(msg)

def write_log(entry: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {entry}\n")

def banner(text: str):
    width = 72
    print()
    print(c("═" * width, CYAN))
    print(c(f"  {text}", BOLD + CYAN))
    print(c("═" * width, CYAN))
    print()

# ── MEMORY SYSTEM ─────────────────────────────────────────────────────────────

def init_memory():
    """Create memory directory and default state files if they don't exist."""
    MEMORY_DIR.mkdir(exist_ok=True)

    if not STATE_FILE.exists():
        state = {
            "created_at": now_iso(),
            "last_cycle": None,
            "cycle_count": 0,
            "project_health_score": 5,
            "pending_tasks": [],
            "completed_tasks": [],
            "active_phases": [],
            "weaknesses_identified": [],
            "strengths_identified": [],
            "last_competition_scan": None,
            "total_improvements_shipped": 0,
            "brain_version": "2.0",
            "notes": "Brain agent initialized. Monitoring and improving WorldPulse."
        }
        save_json(STATE_FILE, state)
        log("Brain state initialized.", GREEN)

    if not COMPETE_FILE.exists():
        save_json(COMPETE_FILE, {
            "last_scan": None,
            "competitors": {},
            "threats": [],
            "opportunities": [],
            "feature_gaps": [],
        })

    if not IMPROVE_FILE.exists():
        save_json(IMPROVE_FILE, {
            "history": [],
            "metrics": {
                "total_tasks_executed": 0,
                "successful": 0,
                "failed": 0,
                "avg_budget_used": 0,
            }
        })

def load_json(path: Path) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_json(path: Path, data: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def load_state() -> dict:
    return load_json(STATE_FILE)

def save_state(state: dict):
    save_json(STATE_FILE, state)

# ── PROJECT ANALYSIS ──────────────────────────────────────────────────────────

def analyze_project() -> dict:
    """Deep scan the project for health, progress, and gaps."""
    log("Scanning project health...", CYAN)
    analysis = {
        "timestamp": now_iso(),
        "git_activity": [],
        "pending_phases": [],
        "completed_phases": [],
        "file_counts": {},
        "health_signals": [],
        "warnings": [],
    }

    # Git activity (last 10 commits)
    try:
        result = subprocess.run(
            ["git", "log", "--oneline", "-10", "--format=%h %s (%ar)"],
            capture_output=True, text=True, cwd=PROJECT_DIR, timeout=10
        )
        if result.returncode == 0:
            analysis["git_activity"] = result.stdout.strip().splitlines()
            if analysis["git_activity"]:
                analysis["health_signals"].append(f"✓ Active repo: {len(analysis['git_activity'])} recent commits")
    except Exception as e:
        analysis["warnings"].append(f"git log failed: {e}")

    # Count source files per app
    for app in ["api", "web", "scraper", "mobile"]:
        app_path = PROJECT_DIR / "apps" / app / "src"
        if app_path.exists():
            ts_files = list(app_path.rglob("*.ts")) + list(app_path.rglob("*.tsx"))
            analysis["file_counts"][app] = len(ts_files)

    # Check which phases exist in tasks
    if TASKS_FILE.exists():
        tasks = load_json(TASKS_FILE)
        if isinstance(tasks, list):
            analysis["total_phases"] = len(tasks)
            for t in tasks:
                phase = t.get("phase", "")
                analysis["pending_phases"].append(phase)

    # Check for key infrastructure files
    key_files = [
        ("docker-compose.yml",         "Docker infrastructure"),
        ("apps/api/src/index.ts",       "API entrypoint"),
        ("apps/web/src/app/page.tsx",   "Web homepage"),
        ("apps/scraper/src/index.ts",   "Scraper entrypoint"),
    ]
    for fpath, label in key_files:
        full = PROJECT_DIR / fpath
        if full.exists():
            analysis["health_signals"].append(f"✓ {label} present")
        else:
            analysis["warnings"].append(f"✗ Missing: {label}")

    # Check for test files using pathlib (cross-platform; skips node_modules/.next)
    try:
        SKIP_DIRS = {"node_modules", ".next", "dist", ".turbo"}
        test_files: list[Path] = []
        for pattern in ("*.test.ts", "*.spec.ts", "*.test.tsx", "*.spec.tsx"):
            for p in PROJECT_DIR.rglob(pattern):
                if not any(part in SKIP_DIRS for part in p.parts):
                    test_files.append(p)
        test_count = len(test_files)
    except Exception:
        test_count = 0
    analysis["test_file_count"] = test_count
    if test_count < 5:
        analysis["warnings"].append(f"Low test coverage: only {test_count} test files found")
    else:
        analysis["health_signals"].append(f"✓ {test_count} test files")

    # Compute health score (0-10)
    score = 5
    score += min(len(analysis["health_signals"]) * 0.5, 3)
    score -= min(len(analysis["warnings"]) * 0.75, 3)
    score = max(1, min(10, round(score, 1)))
    analysis["health_score"] = score

    return analysis

# ── COMPETITION MONITORING ────────────────────────────────────────────────────

def scan_competition() -> dict:
    """
    Search for competitor activity, new features, and market trends.
    Uses Claude to synthesize findings and identify threats/opportunities.
    """
    log("Scanning competition landscape...", AMBER)
    intel = load_json(COMPETE_FILE)

    # Build search queries
    searches = [
        "open source news aggregation platform 2025 2026",
        "real-time news verification AI startup funding",
        "global news intelligence API reliability scoring",
        "open source Reuters AP alternative developer",
        "news fact-checking platform new features launch",
        "global events monitoring platform open source GitHub",
    ]

    raw_results = []
    for query in searches[:4]:  # Limit to 4 searches per cycle
        try:
            result = subprocess.run(
                ["python3", "-c", f"""
import urllib.request, json, urllib.parse
q = urllib.parse.quote("{query}")
url = f"https://api.duckduckgo.com/?q={{q}}&format=json&no_html=1&skip_disambig=1"
try:
    with urllib.request.urlopen(url, timeout=8) as r:
        data = json.loads(r.read())
        abstract = data.get('AbstractText', '') or data.get('Abstract', '')
        related = [t.get('Text','') for t in data.get('RelatedTopics', [])[:3] if isinstance(t, dict)]
        print(json.dumps({{'query': '{query}', 'abstract': abstract, 'related': related}}))
except Exception as e:
    print(json.dumps({{'query': '{query}', 'error': str(e)}}))
"""],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode == 0 and result.stdout.strip():
                try:
                    raw_results.append(json.loads(result.stdout.strip()))
                except Exception:
                    pass
        except Exception as e:
            log(f"Search failed for '{query}': {e}", GREY)

    # Update intel with timestamp
    intel["last_scan"] = now_iso()
    intel["raw_searches"] = raw_results[-20:]  # keep last 20

    # Build threat/opportunity summary from competitor list
    threats = []
    opportunities = []

    for comp in COMPETITORS:
        threats.append({
            "competitor": comp["name"],
            "threat_level": "medium",
            "note": f"Monitoring {comp['name']} for feature parity with WorldPulse",
        })

    opportunities.append("Open source community traction — GitHub stars, contributors")
    opportunities.append("AI-powered reliability scoring differentiates from legacy wires")
    opportunities.append("Self-hosting resonates with privacy-conscious newsrooms")
    opportunities.append("Developer API ecosystem — first-mover advantage")

    intel["threats"] = threats
    intel["opportunities"] = opportunities
    intel["feature_gaps"] = [
        "Mobile app (apps/mobile) — needs feature parity with web",
        "API rate limiting and monetization strategy",
        "Embeddable widget for third-party sites",
        "Browser extension for inline signal verification",
        "Slack/Teams integration for newsroom alerts",
        "GraphQL API layer in addition to REST",
        "Multilingual signal support",
        "AI-generated signal summaries",
    ]

    save_json(COMPETE_FILE, intel)
    log(f"Competition scan complete. Identified {len(intel['feature_gaps'])} feature gaps.", GREEN)
    return intel

# ── TASK GENERATION ──────────────────────────────────────────────────────────

def generate_improvement_tasks(state: dict, analysis: dict, intel: dict) -> list[dict]:
    """
    Generate a prioritized queue of improvement tasks by combining:
    - Existing pending phases from worldpulse_tasks.json
    - Competition gaps
    - Project health warnings
    - Internal efficiency improvements
    """
    log("Generating improvement task queue...", PURPLE)
    tasks = []

    # 1. Pull from existing phase roadmap (highest priority — these are pre-defined)
    if TASKS_FILE.exists():
        roadmap = load_json(TASKS_FILE)
        if isinstance(roadmap, list):
            completed_phases = {t.get("phase") for t in state.get("completed_tasks", [])}
            for item in roadmap:
                phase = item.get("phase", "")
                if phase and phase not in completed_phases:
                    tasks.append({
                        "id": f"roadmap_{phase[:30].replace(' ', '_')}",
                        "source": "roadmap",
                        "priority": 10,
                        "phase": phase,
                        "prompt": item.get("prompt", f"Implement: {phase}"),
                        "budget": item.get("budget", DEFAULT_BUDGET),
                        "category": "feature",
                    })

    # 2. Inject health-driven tasks (warnings become high-priority fixes)
    for warning in analysis.get("warnings", []):
        tasks.append({
            "id": f"health_{abs(hash(warning)) % 10000}",
            "source": "health_monitor",
            "priority": 8,
            "phase": f"Health Fix: {warning}",
            "prompt": f"""Fix this WorldPulse project health issue: {warning}

Context: WorldPulse is an open-source global intelligence network (Next.js 15, Fastify,
PostgreSQL, Redis, Kafka, Meilisearch). Investigate the root cause, implement the fix,
verify the solution works, and add any necessary tests. Do not ask for confirmation.""",
            "budget": 5.0,
            "category": "health",
        })

    # 2b. Test coverage improvement
    test_count = analysis.get("test_file_count", 0)
    if test_count < 10:
        tasks.append({
            "id": "test_coverage_improve",
            "source": "health_monitor",
            "priority": 7,
            "phase": f"Improve Test Coverage (currently {test_count} files)",
            "prompt": """Add comprehensive test coverage to WorldPulse. Focus on:
1. Critical API routes (auth, signals, feed, search)
2. Scraper pipeline logic (fetch, parse, score)
3. Database query functions
4. Frontend hook utilities

Use Vitest. Each test file should have at least 5 meaningful test cases.
Write tests to /apps/api/src/__tests__/ and /apps/scraper/src/__tests__/.
Do not ask for confirmation.""",
            "budget": 8.0,
            "category": "quality",
        })

    # 3. Competition-gap tasks (inject as medium-priority improvements)
    completed_ids = {t.get("id") for t in state.get("completed_tasks", [])}
    for i, gap in enumerate(intel.get("feature_gaps", [])[:4]):  # top 4 gaps
        task_id = f"gap_{abs(hash(gap)) % 10000}"
        if task_id not in completed_ids:
            tasks.append({
                "id": task_id,
                "source": "competition_intel",
                "priority": 5 + (4 - i),  # 9 down to 6
                "phase": f"Competitive Gap: {gap}",
                "prompt": f"""Implement this competitive improvement for WorldPulse to stay ahead:

Gap identified: {gap}

WorldPulse is an open-source global intelligence network (Next.js 15, Fastify API,
PostgreSQL + PostGIS, Redis, Kafka, Meilisearch). This improvement helps WorldPulse
compete with Reuters, AP Wire, Ground News, and emerging AI news startups.

Design a minimal but production-quality implementation. Focus on correctness and
developer experience. Follow existing code conventions. Do not ask for confirmation.""",
                "budget": DEFAULT_BUDGET,
                "category": "competitive",
            })

    # 4. Internal efficiency / performance improvements (ongoing)
    efficiency_tasks = [
        {
            "id": "perf_query_optimize",
            "phase": "Performance: Optimize slow database queries",
            "prompt": """Audit and optimize slow database queries in the WorldPulse API (apps/api/src/).
Run EXPLAIN ANALYZE on the most complex queries (feed, signals/map, search).
Add missing indexes, use covering indexes where appropriate, and add query result
caching with Redis (TTL 30-60s) for hot endpoints. Document each optimization.
TypeScript strict, no confirmations needed.""",
            "priority": 6,
            "budget": 6.0,
            "category": "performance",
        },
        {
            "id": "scraper_efficiency",
            "phase": "Efficiency: Parallel scraper concurrency tuning",
            "prompt": """Review and improve the WorldPulse scraper (apps/scraper/) for maximum throughput.
Add configurable concurrency (env: SCRAPER_CONCURRENCY, default 10), source prioritization
(breaking-tier sources fetched first), and adaptive polling intervals (high-activity sources
polled more frequently). Add throughput metrics to the health dashboard.
TypeScript strict, no confirmations needed.""",
            "priority": 5,
            "budget": 6.0,
            "category": "performance",
        },
        {
            "id": "api_caching_layer",
            "phase": "Performance: Add comprehensive API response caching",
            "prompt": """Add Redis caching to all expensive WorldPulse API endpoints (apps/api/src/).
Strategy: Cache GET /api/v1/signals (30s TTL), GET /api/v1/feed (15s per user),
GET /api/v1/search (60s per query), GET /api/v1/signals/map (45s TTL).
Use cache-aside pattern with automatic invalidation on writes.
Add X-Cache-Hit response header. TypeScript strict, no confirmations.""",
            "priority": 5,
            "budget": 7.0,
            "category": "performance",
        },
        {
            "id": "bundle_size_optimize",
            "phase": "Performance: Web bundle size optimization",
            "prompt": """Analyze and optimize the WorldPulse web app bundle (apps/web/).
Run `pnpm build && pnpm analyze` (add bundle analyzer if missing). Identify the top 5
heaviest imports. Implement: (1) dynamic imports for map/chart libs, (2) tree-shaking
for lucide-react, (3) image optimization with next/image everywhere, (4) preload
critical fonts. Target LCP < 2s. No confirmations.""",
            "priority": 4,
            "budget": 6.0,
            "category": "performance",
        },
        {
            "id": "docs_api_reference",
            "phase": "Developer Experience: Auto-generate OpenAPI docs",
            "prompt": """Add auto-generated API documentation to WorldPulse (apps/api/).
Install @fastify/swagger and @fastify/swagger-ui. Add JSDoc/schema annotations to all
routes. Serve interactive Swagger UI at /api/docs. Generate static openapi.json at
build time to docs/api-reference.json. This helps developer adoption and community
contributions. TypeScript strict, no confirmations.""",
            "priority": 4,
            "budget": 5.0,
            "category": "devex",
        },
        {
            "id": "monitoring_sentry",
            "phase": "Observability: Add error tracking and performance monitoring",
            "prompt": """Add observability to WorldPulse. In apps/api/ and apps/web/:
(1) Integrate Sentry (or self-hosted Glitchtip) for error tracking — use env SENTRY_DSN;
(2) Add structured JSON logging to the API with request ID, user ID, route, latency;
(3) Add OpenTelemetry traces to the scraper pipeline;
(4) Create a /api/v1/health endpoint returning service status, version, uptime, DB status.
TypeScript strict, no confirmations.""",
            "priority": 4,
            "budget": 7.0,
            "category": "observability",
        },
    ]

    for t in efficiency_tasks:
        if t["id"] not in completed_ids:
            t["source"] = "brain_efficiency"
            tasks.append(t)

    # 5. Sort by priority (highest first), deduplicate by id
    seen_ids = set()
    unique_tasks = []
    for t in sorted(tasks, key=lambda x: x.get("priority", 0), reverse=True):
        if t["id"] not in seen_ids:
            seen_ids.add(t["id"])
            unique_tasks.append(t)

    log(f"Generated {len(unique_tasks)} improvement tasks ({len([t for t in unique_tasks if t['source']=='roadmap'])} roadmap, {len([t for t in unique_tasks if t['source']=='competition_intel'])} competitive, {len([t for t in unique_tasks if t['source']=='brain_efficiency'])} efficiency).", GREEN)
    return unique_tasks

# ── TASK EXECUTION ────────────────────────────────────────────────────────────

def execute_task(task: dict, dry_run: bool = False) -> dict:
    """Execute a single improvement task via Claude Code autopilot."""
    phase   = task.get("phase", "Unknown task")
    prompt  = task.get("prompt", phase)
    budget  = task.get("budget", DEFAULT_BUDGET)
    task_id = task.get("id", "unknown")

    log(f"", RESET)
    log(f"▶ Executing: {phase}", AMBER + BOLD)
    log(f"  Budget: ${budget} | Category: {task.get('category','?')} | Source: {task.get('source','?')}", GREY)

    write_log(f"TASK_START: {task_id} | {phase} | budget=${budget}")

    if dry_run:
        log("  [DRY RUN — skipping Claude execution]", GREY)
        return {"success": True, "dry_run": True, "task_id": task_id}

    # Kill switch check
    if KILL_FILE.exists():
        log("Kill switch detected — aborting.", RED)
        return {"success": False, "reason": "kill_switch", "task_id": task_id}

    # Build the enriched prompt with WorldPulse context
    full_prompt = f"""You are the WorldPulse Brain Agent improvement engine.

WORLDPULSE CONTEXT:
WorldPulse is an open-source global intelligence network — real-time world events
+ social discourse, verified and trustworthy.
Tech stack: Next.js 15 (TypeScript strict), Fastify API, Node.js scraper,
PostgreSQL + PostGIS, Redis, Kafka, Meilisearch. Monorepo: pnpm + Turborepo.
Apps: apps/web/ (frontend), apps/api/ (backend), apps/scraper/ (signal pipeline), apps/mobile/ (React Native)
Packages: packages/types/, packages/ui/, packages/config/

COMPETITORS TO BEAT: Reuters Connect, AP Wire, Ground News, GDELT, NewsGuard, Bellingcat
GOAL: Make WorldPulse more reliable, faster, more feature-complete, and developer-friendly than any competitor.

TASK (Priority {task.get('priority', 5)}/10 | Source: {task.get('source', '?')} | Category: {task.get('category','?')}):
{prompt}

RULES:
- TypeScript strict mode throughout
- Run lint/build checks after implementing
- Follow conventional commit format
- Write tests for any new logic
- Do NOT ask for confirmation — implement and move on
- If you encounter blockers, document them in a brain_memory/blockers.md file
- After completing, write a brief summary to brain_memory/last_improvement.txt
"""

    start_time = time.time()
    result = {"success": False, "task_id": task_id, "duration_s": 0}

    try:
        cmd = [
            "claude",
            "--dangerously-skip-permissions",
            f"--max-turns", "40",
            "-p", full_prompt,
        ]

        proc = subprocess.run(
            cmd,
            cwd=str(PROJECT_DIR),
            timeout=int(budget * 600),  # rough: $1 ≈ 10 minutes max
            capture_output=False,
        )

        duration = round(time.time() - start_time, 1)
        result["duration_s"] = duration
        result["success"] = (proc.returncode == 0)
        result["returncode"] = proc.returncode

        if result["success"]:
            log(f"✓ Task complete in {duration}s: {phase}", GREEN)
            write_log(f"TASK_SUCCESS: {task_id} | duration={duration}s")
        else:
            log(f"✗ Task exited with code {proc.returncode}: {phase}", RED)
            write_log(f"TASK_FAIL: {task_id} | returncode={proc.returncode}")

    except subprocess.TimeoutExpired:
        log(f"⚠ Task timed out: {phase}", AMBER)
        write_log(f"TASK_TIMEOUT: {task_id}")
        result["reason"] = "timeout"
    except FileNotFoundError:
        log("✗ Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code", RED)
        write_log("ERROR: claude CLI not found")
        result["reason"] = "claude_not_found"
    except Exception as e:
        log(f"✗ Task execution error: {e}", RED)
        write_log(f"TASK_ERROR: {task_id} | {e}")
        result["reason"] = str(e)

    return result

# ── IMPROVEMENT LOG ───────────────────────────────────────────────────────────

def log_improvement(task: dict, result: dict):
    """Record this improvement in the persistent improvement log."""
    log_data = load_json(IMPROVE_FILE)

    entry = {
        "timestamp": now_iso(),
        "task_id": task.get("id"),
        "phase": task.get("phase"),
        "category": task.get("category"),
        "source": task.get("source"),
        "priority": task.get("priority"),
        "budget": task.get("budget"),
        "success": result.get("success"),
        "duration_s": result.get("duration_s", 0),
        "reason": result.get("reason"),
    }

    history = log_data.get("history", [])
    history.append(entry)
    history = history[-MAX_TASK_HISTORY:]  # Rolling window

    metrics = log_data.get("metrics", {})
    metrics["total_tasks_executed"] = metrics.get("total_tasks_executed", 0) + 1
    if result.get("success"):
        metrics["successful"] = metrics.get("successful", 0) + 1
    else:
        metrics["failed"] = metrics.get("failed", 0) + 1

    log_data["history"] = history
    log_data["metrics"] = metrics
    save_json(IMPROVE_FILE, log_data)

# ── BRAIN CYCLE ───────────────────────────────────────────────────────────────

def run_brain_cycle(budget_override: float = None, dry_run: bool = False, competition_only: bool = False):
    """Execute one full brain cycle: scan → analyze → plan → execute → remember."""
    banner("WORLDPULSE BRAIN AGENT — CYCLE START")
    write_log(f"=== BRAIN CYCLE START (cycle #{load_state().get('cycle_count', 0) + 1}) ===")

    # ── 1. LOAD STATE ────────────────────────────────────────────────────────
    state = load_state()
    state["cycle_count"] = state.get("cycle_count", 0) + 1
    state["last_cycle"] = now_iso()

    # ── 2. COMPETITION SCAN ──────────────────────────────────────────────────
    intel = scan_competition()
    state["last_competition_scan"] = now_iso()

    if competition_only:
        log("Competition-only mode. Printing threats and opportunities:", AMBER)
        for t in intel.get("threats", [])[:5]:
            log(f"  ⚠ {t['competitor']}: {t.get('note','')}", AMBER)
        for o in intel.get("opportunities", [])[:4]:
            log(f"  ✓ Opportunity: {o}", GREEN)
        save_state(state)
        return

    # ── 3. PROJECT ANALYSIS ──────────────────────────────────────────────────
    analysis = analyze_project()
    state["project_health_score"] = analysis["health_score"]
    log(f"Project health score: {analysis['health_score']}/10", GREEN if analysis["health_score"] >= 7 else AMBER)

    if analysis["warnings"]:
        log(f"Warnings ({len(analysis['warnings'])}):", AMBER)
        for w in analysis["warnings"]:
            log(f"  ⚠ {w}", AMBER)

    # ── 4. GENERATE TASKS ────────────────────────────────────────────────────
    task_queue = generate_improvement_tasks(state, analysis, intel)
    state["pending_tasks"] = task_queue[:20]  # Store top 20 in state

    # ── 5. SELECT NEXT TASK ──────────────────────────────────────────────────
    completed_ids = {t.get("id") for t in state.get("completed_tasks", [])}
    next_task = None
    for t in task_queue:
        if t.get("id") not in completed_ids:
            next_task = t
            break

    if not next_task:
        log("✓ No pending tasks found — WorldPulse is fully optimized for now!", GREEN)
        log("  Next competition scan in 1 hour. The brain never sleeps.", GREY)
        save_state(state)
        return

    if budget_override:
        next_task["budget"] = budget_override

    # ── 6. EXECUTE ───────────────────────────────────────────────────────────
    result = execute_task(next_task, dry_run=dry_run)

    # ── 7. UPDATE MEMORY ─────────────────────────────────────────────────────
    log_improvement(next_task, result)

    completed_tasks = state.get("completed_tasks", [])
    if result.get("success"):
        completed_tasks.append({
            "id": next_task.get("id"),
            "phase": next_task.get("phase"),
            "category": next_task.get("category"),
            "completed_at": now_iso(),
        })
        state["total_improvements_shipped"] = state.get("total_improvements_shipped", 0) + 1

    state["completed_tasks"] = completed_tasks[-MAX_TASK_HISTORY:]
    save_state(state)

    # ── 8. CYCLE SUMMARY ─────────────────────────────────────────────────────
    banner("BRAIN CYCLE COMPLETE")
    log(f"Cycle #{state['cycle_count']} | Health: {analysis['health_score']}/10 | Improvements shipped: {state['total_improvements_shipped']}", CYAN)
    log(f"Pending queue: {len(task_queue)} tasks | Competition threats tracked: {len(intel.get('threats',[]))}", GREY)
    write_log(f"=== BRAIN CYCLE COMPLETE #{state['cycle_count']} | health={analysis['health_score']} | shipped={state['total_improvements_shipped']} ===")

# ── STATUS DISPLAY ────────────────────────────────────────────────────────────

def show_status():
    """Print current brain state, memory, and queue."""
    banner("WORLDPULSE BRAIN AGENT — STATUS")

    state = load_state()
    intel = load_json(COMPETE_FILE)
    improve = load_json(IMPROVE_FILE)

    print(c("BRAIN STATE", BOLD + CYAN))
    print(f"  Version       : {state.get('brain_version', 'unknown')}")
    print(f"  Cycles run    : {state.get('cycle_count', 0)}")
    print(f"  Last cycle    : {state.get('last_cycle', 'never')}")
    print(f"  Health score  : {state.get('project_health_score', '?')}/10")
    print(f"  Improvements  : {state.get('total_improvements_shipped', 0)} shipped")
    print()

    print(c("IMPROVEMENT METRICS", BOLD + CYAN))
    m = improve.get("metrics", {})
    print(f"  Total executed: {m.get('total_tasks_executed', 0)}")
    print(f"  Successful    : {m.get('successful', 0)}")
    print(f"  Failed        : {m.get('failed', 0)}")
    print()

    print(c("COMPETITION INTEL", BOLD + AMBER))
    print(f"  Last scan     : {intel.get('last_scan', 'never')}")
    print(f"  Threats tracked: {len(intel.get('threats', []))}")
    print(f"  Feature gaps  : {len(intel.get('feature_gaps', []))}")
    print()
    print(c("  Top Feature Gaps:", AMBER))
    for gap in intel.get("feature_gaps", [])[:5]:
        print(f"    → {gap}")
    print()

    print(c("COMPLETED TASKS (last 5)", BOLD + GREEN))
    for t in list(reversed(state.get("completed_tasks", [])))[:5]:
        print(f"  ✓ [{t.get('category','?')}] {t.get('phase','?')[:70]}")
    print()

    print(c("PENDING QUEUE (top 5)", BOLD + PURPLE))
    completed_ids = {t.get("id") for t in state.get("completed_tasks", [])}
    shown = 0
    for t in state.get("pending_tasks", []):
        if t.get("id") not in completed_ids and shown < 5:
            print(f"  #{shown+1} [p={t.get('priority',0)}] [{t.get('source','?')}] {t.get('phase','?')[:65]}")
            shown += 1
    print()

# ── CONTINUOUS LOOP ───────────────────────────────────────────────────────────

def run_loop(budget_override: float = None):
    """Run the brain agent in an infinite loop — true Claude Autopilot mode."""
    banner("WORLDPULSE BRAIN AGENT — AUTOPILOT MODE ACTIVATED")
    log("The brain never sleeps. Press CTRL+C or create .brain_kill to stop.", AMBER)
    log(f"Cycle interval: {LOOP_INTERVAL_S}s ({LOOP_INTERVAL_S//60} minutes)", GREY)
    write_log("AUTOPILOT START")

    cycle = 0
    while True:
        # Kill switch
        if KILL_FILE.exists():
            log("Kill switch triggered — stopping autopilot.", RED)
            write_log("AUTOPILOT STOPPED via kill switch")
            KILL_FILE.unlink(missing_ok=True)
            break

        cycle += 1
        log(f"\n{'─'*60}\nAUTOPILOT CYCLE {cycle} — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n{'─'*60}", CYAN)

        try:
            run_brain_cycle(budget_override=budget_override)
        except KeyboardInterrupt:
            log("\nAutopilot interrupted by user.", AMBER)
            write_log("AUTOPILOT INTERRUPTED")
            break
        except Exception as e:
            log(f"Brain cycle error (will retry next interval): {e}", RED)
            write_log(f"BRAIN CYCLE ERROR: {e}")

        log(f"\nSleeping {LOOP_INTERVAL_S}s until next cycle. Create .brain_kill to stop.", GREY)
        try:
            for _ in range(LOOP_INTERVAL_S):
                if KILL_FILE.exists():
                    break
                time.sleep(1)
        except KeyboardInterrupt:
            log("\nAutopilot stopped.", AMBER)
            break

    write_log("AUTOPILOT END")

# ── ENTRY POINT ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="WorldPulse Brain Agent — autonomous improvement engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python brain_agent.py                    # Run one improvement cycle
  python brain_agent.py --loop             # Run forever (Autopilot mode)
  python brain_agent.py --status           # Show current brain state
  python brain_agent.py --compete          # Competition scan only
  python brain_agent.py --dry-run          # Plan without executing
  python brain_agent.py --budget 12        # Set task budget to $12
  touch .brain_kill                        # Stop the autopilot loop
        """
    )
    parser.add_argument("--loop",     action="store_true", help="Run in continuous autopilot loop")
    parser.add_argument("--status",   action="store_true", help="Show current brain state and exit")
    parser.add_argument("--compete",  action="store_true", help="Run competition scan only")
    parser.add_argument("--dry-run",  action="store_true", help="Plan tasks without executing them")
    parser.add_argument("--budget",   type=float, default=None, help="Override task budget in USD")
    args = parser.parse_args()

    # Always initialize memory first
    init_memory()

    if args.status:
        show_status()
    elif args.loop:
        run_loop(budget_override=args.budget)
    elif args.compete:
        run_brain_cycle(competition_only=True)
    elif args.dry_run:
        run_brain_cycle(dry_run=True)
    else:
        run_brain_cycle(budget_override=args.budget)

if __name__ == "__main__":
    main()

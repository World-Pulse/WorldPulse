#!/usr/bin/env python3
"""
WorldPulse Autopilot
────────────────────
Run Claude Code autonomously on your WorldPulse project — from your
computer or triggered remotely from your phone.

USAGE (computer):
    python worldpulse_autopilot.py "Build the Meilisearch indexing pipeline" --budget 8

USAGE (phone / remote):
    Start the API server mode:
        python worldpulse_autopilot.py --server
    Then POST from your phone:
        curl -X POST http://YOUR_IP:8765/run \\
             -H "Content-Type: application/json" \\
             -H "X-Token: your-secret-token" \\
             -d '{"prompt": "Fix scraper retry logic", "budget": 5}'

REQUIREMENTS:
    pip install anthropic httpx rich --break-system-packages
    Also requires: claude CLI installed (npm install -g @anthropic-ai/claude-code)
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# ── CONFIG ───────────────────────────────────────────────────────────────────
DEFAULT_PROJECT_DIR = Path(__file__).parent.resolve()
DEFAULT_BUDGET_USD  = 5.00
DEFAULT_PORT        = 8765
LOG_FILE            = DEFAULT_PROJECT_DIR / "autopilot.log"
SERVER_TOKEN_FILE   = DEFAULT_PROJECT_DIR / ".autopilot_token"
KILL_FILE           = DEFAULT_PROJECT_DIR / ".autopilot_kill"

# WorldPulse-specific system context injected into every session
WP_CONTEXT = """
You are working on WorldPulse — an open-source global intelligence network.
Tech stack: Next.js 15 + TypeScript frontend, Fastify API, Node.js scraper,
PostgreSQL + PostGIS, Redis, Kafka, Meilisearch. Monorepo with pnpm + Turborepo.

Key principles:
- Write production-quality TypeScript (strict mode)
- Follow conventional commits (feat:, fix:, chore:, etc.)
- Add tests for any new pipeline logic
- Do not break existing functionality — run linters before finishing
- Save all new files, run build checks, and summarise what you completed

Project structure:
  apps/web/       Next.js frontend
  apps/api/       Fastify API + WebSocket
  apps/scraper/   Signal intelligence pipeline
  packages/       Shared types, UI components, config
""".strip()

# ── COLOURS (terminal) ────────────────────────────────────────────────────────
RESET  = "\033[0m"
BOLD   = "\033[1m"
AMBER  = "\033[38;5;214m"
CYAN   = "\033[38;5;51m"
RED    = "\033[38;5;196m"
GREEN  = "\033[38;5;46m"
GREY   = "\033[38;5;240m"
DIM    = "\033[2m"

def c(text, colour): return f"{colour}{text}{RESET}"
def log(msg, colour=RESET): print(c(msg, colour))


# ── LOGGING ──────────────────────────────────────────────────────────────────
def write_log(entry: str):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a", encoding='utf-8') as f:
        f.write(f"[{timestamp}] {entry}\n")


# ── KILL SWITCH ──────────────────────────────────────────────────────────────
def start_kill_watcher(proc):
    """Background thread: creates a kill file watcher. Touch .autopilot_kill to stop."""
    def watch():
        while proc.poll() is None:
            if KILL_FILE.exists():
                log("\n  Kill switch triggered — stopping Claude...", RED)
                write_log("KILL SWITCH triggered")
                proc.terminate()
                KILL_FILE.unlink(missing_ok=True)
                break
            time.sleep(1)
    t = threading.Thread(target=watch, daemon=True)
    t.start()


# ── CLAUDE RUNNER ────────────────────────────────────────────────────────────
def run_claude(prompt: str, budget: float, project_dir: Path) -> dict:
    """
    Run claude CLI with --dangerously-skip-permissions in stream-json mode.
    Returns: { success, cost, turns, duration, summary }
    """
    full_prompt = f"{WP_CONTEXT}\n\n---\n\nTASK:\n{prompt}"

    cmd = [
        "claude",
        "--dangerously-skip-permissions",
        "-p", full_prompt,
        f"--max-budget-usd={budget}",
        "--output-format", "stream-json",
        "--verbose",
    ]

    log(f"\n  {'─'*60}", GREY)
    log(f"  {BOLD}PROJECT{RESET}  {project_dir}", AMBER)
    log(f"  {BOLD}BUDGET{RESET}   ${budget:.2f} max", AMBER)
    log(f"  {BOLD}TASK{RESET}     {prompt[:80]}{'...' if len(prompt) > 80 else ''}", AMBER)
    log(f"  {BOLD}KILL{RESET}     touch .autopilot_kill  (or Ctrl+C)", GREY)
    log(f"  {'─'*60}\n", GREY)

    write_log(f"START | budget=${budget} | prompt={prompt[:120]}")
    start_time = time.time()
    result = {"success": False, "cost": 0.0, "turns": 0, "duration": 0, "summary": ""}

    # ── PRE-FLIGHT: check claude CLI is reachable ──────────────────────────
    import shutil
    claude_path = shutil.which("claude")
    if not claude_path:
        # Try common Windows npm global paths
        import os
        candidates = [
            os.path.expanduser("~\\AppData\\Roaming\\npm\\claude.cmd"),
            os.path.expanduser("~\\AppData\\Roaming\\npm\\claude"),
            "C:\\Program Files\\nodejs\\claude.cmd",
        ]
        for candidate in candidates:
            if os.path.exists(candidate):
                claude_path = candidate
                cmd[0] = candidate
                break
        if not claude_path:
            msg = (
                "claude CLI not found in PATH.\n"
                "  Fix: npm install -g @anthropic-ai/claude-code\n"
                "  Then restart your terminal and try again."
            )
            log(f"\n  ERROR: {msg}", RED)
            write_log(f"ERROR: {msg}")
            return result

    log(f"  {BOLD}CLAUDE{RESET}   {claude_path}", GREY)
    write_log(f"CLAUDE PATH: {claude_path}")

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(project_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1,
        )
        start_kill_watcher(proc)

        # Drain stderr in background thread so it doesn't block
        import threading as _threading
        stderr_lines = []
        def _drain_stderr():
            for l in proc.stderr:
                l = l.strip()
                if l:
                    stderr_lines.append(l)
                    log(f"  STDERR: {l}", RED)
                    write_log(f"STDERR: {l}")
        _t = _threading.Thread(target=_drain_stderr, daemon=True)
        _t.start()

        last_text = []
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            # Plain text output — print and log everything
            print(c("  ▸ ", CYAN) + line)
            write_log(f"CLAUDE: {line[:200]}")
            last_text.append(line)
            result["success"] = True  # mark success as soon as we get output

        proc.wait()
        _t.join(timeout=2)
        if proc.returncode != 0:
            write_log(f"CLAUDE EXIT CODE: {proc.returncode}")
            if stderr_lines:
                write_log(f"STDERR SUMMARY: {' | '.join(stderr_lines[:5])}")
                log(f"\n  Claude exited with code {proc.returncode}. See autopilot.log for details.", RED)

    except KeyboardInterrupt:
        log("\n  Interrupted — stopping Claude.", RED)
        write_log("INTERRUPTED by user")
        if 'proc' in locals():
            proc.terminate()

    result["duration"] = round(time.time() - start_time)
    elapsed = f"{result['duration'] // 60}m {result['duration'] % 60}s"

    if result["success"]:
        log(f"\n  {'─'*60}", GREY)
        log(f"  ✓  DONE — {result['turns']} turns  •  ${result['cost']:.4f} spent  •  {elapsed}", GREEN)
        log(f"  {'─'*60}\n", GREY)
        write_log(f"DONE | turns={result['turns']} | cost=${result['cost']:.4f} | elapsed={elapsed}")
    else:
        log(f"\n  Session ended after {elapsed}", GREY)
        write_log(f"END (no result) | elapsed={elapsed}")

    return result


# ── SERVER MODE (phone / remote access) ──────────────────────────────────────
def get_or_create_token() -> str:
    if SERVER_TOKEN_FILE.exists():
        return SERVER_TOKEN_FILE.read_text().strip()
    import secrets
    token = secrets.token_urlsafe(32)
    SERVER_TOKEN_FILE.write_text(token)
    SERVER_TOKEN_FILE.chmod(0o600)
    return token


class AutopilotHandler(BaseHTTPRequestHandler):
    token: str = ""
    project_dir: Path = DEFAULT_PROJECT_DIR
    running: bool = False

    def log_message(self, format, *args):
        pass  # suppress default HTTP logs

    def send_json(self, code: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/status":
            self.send_json(200, {
                "status": "running" if AutopilotHandler.running else "idle",
                "log_tail": self._tail_log(20),
            })
        elif self.path == "/stop":
            KILL_FILE.touch()
            self.send_json(200, {"message": "Kill switch triggered."})
        else:
            self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/run":
            self.send_json(404, {"error": "Not found"})
            return

        # Auth
        auth = self.headers.get("X-Token", "")
        if auth != AutopilotHandler.token:
            self.send_json(401, {"error": "Unauthorized"})
            return

        # Parse body
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except Exception:
            self.send_json(400, {"error": "Invalid JSON"})
            return

        prompt = payload.get("prompt", "").strip()
        budget = float(payload.get("budget", DEFAULT_BUDGET_USD))

        if not prompt:
            self.send_json(400, {"error": "prompt is required"})
            return

        if AutopilotHandler.running:
            self.send_json(409, {"error": "A session is already running."})
            return

        # Respond immediately, run in background
        self.send_json(202, {"message": "Session started.", "prompt": prompt, "budget": budget})

        def run_in_bg():
            AutopilotHandler.running = True
            try:
                run_claude(prompt, budget, AutopilotHandler.project_dir)
            finally:
                AutopilotHandler.running = False

        threading.Thread(target=run_in_bg, daemon=True).start()

    def _tail_log(self, n: int) -> list:
        if not LOG_FILE.exists():
            return []
        lines = LOG_FILE.read_text().splitlines()
        return lines[-n:]


def start_server(port: int, project_dir: Path):
    token = get_or_create_token()
    AutopilotHandler.token = token
    AutopilotHandler.project_dir = project_dir

    # Get local IP
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "localhost"

    server = HTTPServer(("0.0.0.0", port), AutopilotHandler)
    log(f"\n  {'═'*60}", AMBER)
    log(f"  {BOLD}WORLDPULSE AUTOPILOT — SERVER MODE{RESET}", AMBER)
    log(f"  {'═'*60}", AMBER)
    log(f"  Listening on  http://0.0.0.0:{port}", CYAN)
    log(f"  Local IP      http://{local_ip}:{port}", CYAN)
    log(f"  Token         {token}", AMBER)
    log(f"  {'─'*60}", GREY)
    log(f"  FROM YOUR PHONE — send a task:", GREY)
    log(f"  curl -X POST http://{local_ip}:{port}/run \\", GREY)
    log(f'       -H "Content-Type: application/json" \\', GREY)
    log(f'       -H "X-Token: {token}" \\', GREY)
    log(f"       -d '{{\"prompt\": \"Your task here\", \"budget\": 5}}'", GREY)
    log(f"  {'─'*60}", GREY)
    log(f"  STATUS   GET  http://{local_ip}:{port}/status", GREY)
    log(f"  STOP     GET  http://{local_ip}:{port}/stop", GREY)
    log(f"  {'═'*60}\n", AMBER)
    write_log(f"SERVER started on port {port} | ip={local_ip}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("\n  Server stopped.", GREY)
        write_log("SERVER stopped")


# ── BATCH MODE (queue multiple tasks) ────────────────────────────────────────
def run_batch(tasks_file: Path, budget_per_task: float, project_dir: Path):
    """
    Run a JSON file of tasks sequentially.
    Format: [{"prompt": "...", "budget": 5}, ...]
    """
    if not tasks_file.exists():
        log(f"  Tasks file not found: {tasks_file}", RED)
        sys.exit(1)

    tasks = json.loads(tasks_file.read_text())
    log(f"\n  BATCH MODE: {len(tasks)} tasks queued", AMBER)
    write_log(f"BATCH START | {len(tasks)} tasks")

    for i, task in enumerate(tasks, 1):
        prompt = task.get("prompt", "").strip()
        budget = task.get("budget", budget_per_task)
        if not prompt:
            continue
        log(f"\n  [{i}/{len(tasks)}] Starting task...", CYAN)
        if KILL_FILE.exists():
            log("  Kill file found — stopping batch.", RED)
            KILL_FILE.unlink(missing_ok=True)
            break
        run_claude(prompt, budget, project_dir)

    write_log("BATCH END")


# ── CLI ───────────────────────────────────────────────────────────────────────
def main():
    print(c(f"""
  ╔═══════════════════════════════════════════╗
  ║   WORLDPULSE AUTOPILOT  •  v1.0           ║
  ║   Claude Code — no approval prompts       ║
  ╚═══════════════════════════════════════════╝
    """, AMBER))

    parser = argparse.ArgumentParser(
        description="WorldPulse Autopilot — run Claude Code unattended",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run a single task
  python worldpulse_autopilot.py "Build the Meilisearch search pipeline"

  # Run with custom budget
  python worldpulse_autopilot.py "Fix scraper retry logic" --budget 8

  # Start server (for phone control)
  python worldpulse_autopilot.py --server

  # Run batch of tasks from a JSON file
  python worldpulse_autopilot.py --batch tasks.json

  # Point to a different project directory
  python worldpulse_autopilot.py "..." --dir ~/projects/worldpulse
        """
    )

    parser.add_argument("prompt", nargs="?", help="Task for Claude to complete")
    parser.add_argument("--budget", type=float, default=DEFAULT_BUDGET_USD,
                        help=f"Max USD budget (default: ${DEFAULT_BUDGET_USD})")
    parser.add_argument("--dir", type=Path, default=DEFAULT_PROJECT_DIR,
                        help="Project directory (default: script location)")
    parser.add_argument("--server", action="store_true",
                        help="Start HTTP server for phone/remote control")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"Server port (default: {DEFAULT_PORT})")
    parser.add_argument("--batch", type=Path, metavar="TASKS_JSON",
                        help="Run tasks from a JSON file sequentially")

    args = parser.parse_args()

    # Validate project dir
    project_dir = args.dir.resolve()
    if not project_dir.exists():
        log(f"  Project directory not found: {project_dir}", RED)
        sys.exit(1)

    # Clean up stale kill file
    if KILL_FILE.exists():
        KILL_FILE.unlink()

    if args.server:
        start_server(args.port, project_dir)

    elif args.batch:
        run_batch(args.batch, args.budget, project_dir)

    elif args.prompt:
        run_claude(args.prompt.strip(), args.budget, project_dir)

    else:
        # Auto-run batch if worldpulse_tasks.json exists next to this script
        auto_batch = Path(__file__).parent / "worldpulse_tasks.json"
        if auto_batch.exists():
            log(f"  Auto-detected {auto_batch.name} — running full batch...", AMBER)
            run_batch(auto_batch, args.budget, project_dir)
            return

        # Fallback: interactive mode
        log("  Enter your task for Claude:", GREEN)
        try:
            prompt = input("  > ").strip()
        except (KeyboardInterrupt, EOFError):
            log("\n  Cancelled.", GREY)
            sys.exit(0)

        if not prompt:
            log("  No prompt given — exiting.", RED)
            sys.exit(1)

        run_claude(prompt, args.budget, project_dir)


if __name__ == "__main__":
    main()

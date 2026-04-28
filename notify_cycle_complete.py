#!/usr/bin/env python3
"""
Watch brain_agent.log for cycle completion and send ntfy notification.
Usage: python notify_cycle_complete.py [cycle_number]
"""

import sys
import time
import urllib.request
import urllib.error
import os
from pathlib import Path
from datetime import datetime

NTFY_TOPIC   = "worldpulse-batman"
NTFY_URL     = f"https://ntfy.sh/{NTFY_TOPIC}"
LOG_FILE     = Path(__file__).parent / "brain_agent.log"
POLL_SECS    = 5

# Which cycle to watch for (default: next one after current)
watch_cycle  = int(sys.argv[1]) if len(sys.argv) > 1 else None

def send_ntfy(title: str, message: str, priority: str = "high", tags: str = "brain,white_check_mark"):
    # Headers must be latin-1 safe — strip non-ASCII from title
    safe_title = title.encode("ascii", "ignore").decode("ascii")
    payload = f"{message}".encode("utf-8")
    req = urllib.request.Request(
        NTFY_URL,
        data=payload,
        headers={
            "Title":        safe_title,
            "Priority":     priority,
            "Tags":         tags,
            "Content-Type": "text/plain; charset=utf-8",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except urllib.error.URLError as e:
        print(f"[ntfy] Failed to send: {e}")
        return False

def get_last_line_offset(path: Path) -> int:
    """Return file size so we only watch new lines."""
    try:
        return path.stat().st_size
    except FileNotFoundError:
        return 0

def tail_new_lines(path: Path, offset: int):
    """Yield new lines written after offset."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            f.seek(offset)
            content = f.read()
            new_offset = f.tell()
        lines = content.splitlines()
        return lines, new_offset
    except FileNotFoundError:
        return [], offset

def detect_current_cycle(path: Path) -> int:
    """Scan log for highest cycle number seen."""
    highest = 0
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if "BRAIN CYCLE COMPLETE #" in line:
                    try:
                        n = int(line.split("BRAIN CYCLE COMPLETE #")[1].split()[0].split("|")[0].strip())
                        highest = max(highest, n)
                    except (ValueError, IndexError):
                        pass
                elif "=== BRAIN CYCLE START (cycle #" in line:
                    try:
                        n = int(line.split("cycle #")[1].split(")")[0].strip())
                        highest = max(highest, n - 1)
                    except (ValueError, IndexError):
                        pass
    except FileNotFoundError:
        pass
    return highest

def main():
    global watch_cycle

    print(f"[{datetime.now():%H:%M:%S}] WorldPulse brain agent notifier starting")
    print(f"[{datetime.now():%H:%M:%S}] Log file: {LOG_FILE}")
    print(f"[{datetime.now():%H:%M:%S}] ntfy topic: {NTFY_TOPIC}")

    if watch_cycle is None:
        completed = detect_current_cycle(LOG_FILE)
        watch_cycle = completed + 1
        print(f"[{datetime.now():%H:%M:%S}] Last completed cycle: #{completed} — watching for #{watch_cycle}")
    else:
        print(f"[{datetime.now():%H:%M:%S}] Watching for cycle #{watch_cycle} explicitly")

    # Send a test ping so you know it's working
    ok = send_ntfy(
        title="🧠 WorldPulse Monitor Active",
        message=f"Watching for brain agent cycle #{watch_cycle} to complete. You'll be notified when it's done.",
        priority="default",
        tags="eyes,brain"
    )
    print(f"[{datetime.now():%H:%M:%S}] Test notification sent: {'✓' if ok else '✗ (check ntfy topic)'}")

    offset = get_last_line_offset(LOG_FILE)
    complete_marker = f"BRAIN CYCLE COMPLETE #{watch_cycle}"
    start_marker    = f"BRAIN CYCLE START (cycle #{watch_cycle}"

    task_name  = None
    cycle_health = None

    print(f"[{datetime.now():%H:%M:%S}] Polling every {POLL_SECS}s …")

    while True:
        lines, offset = tail_new_lines(LOG_FILE, offset)

        for line in lines:
            # Capture what task ran
            if "▶ Executing:" in line:
                try:
                    task_name = line.split("▶ Executing:")[1].strip()
                except IndexError:
                    pass

            # Capture health score
            if "health=" in line and "CYCLE" in line:
                try:
                    cycle_health = line.split("health=")[1].split()[0].split("|")[0].strip()
                except IndexError:
                    pass

            if complete_marker in line:
                # Parse shipped count
                shipped = "?"
                try:
                    shipped = line.split("shipped=")[1].split()[0].strip()
                except IndexError:
                    pass

                summary = (
                    f"Cycle #{watch_cycle} complete ✓\n"
                    f"Health: {cycle_health or '?'}/10 · Shipped: {shipped} improvements\n"
                    f"Last task: {task_name or 'unknown'}\n"
                    f"Safe to push PRIORITY_DIRECTIONS.md now."
                )

                print(f"\n[{datetime.now():%H:%M:%S}] *** CYCLE #{watch_cycle} COMPLETE ***")
                print(summary)

                sent = send_ntfy(
                    title=f"✅ WorldPulse Brain Cycle #{watch_cycle} Complete",
                    message=summary,
                    priority="high",
                    tags="white_check_mark,brain,rocket"
                )
                print(f"[{datetime.now():%H:%M:%S}] ntfy notification sent: {'✓' if sent else '✗'}")
                print(f"\nRun your PowerShell push now.")
                sys.exit(0)

        time.sleep(POLL_SECS)

if __name__ == "__main__":
    main()

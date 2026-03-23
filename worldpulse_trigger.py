"""
WorldPulse Remote Trigger Listener
===================================
Runs in the background on your Windows machine.
Send any message to ntfy.sh/worldpulse-run-batman from your phone → build starts.
Progress notifications come back to ntfy.sh/worldpulse-batman as usual.

To start:  double-click START_TRIGGER.bat
To stop:   close the window, or Ctrl+C
"""

import json
import subprocess
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    import os
    os.system("pip install requests --break-system-packages -q")
    import requests

# ── Config ────────────────────────────────────────────────────────────────────
TRIGGER_TOPIC = "worldpulse-run-batman"   # Send any message here → triggers build
STATUS_TOPIC  = "worldpulse-batman"       # Progress notifications land here
SCRIPT_DIR    = Path(__file__).parent
START_BAT     = SCRIPT_DIR / "START.bat"
# ─────────────────────────────────────────────────────────────────────────────

TRIGGER_WORDS = {"run", "start", "build", "go", "launch", "fire", "yes", "ok", "do it"}


def notify(title: str, body: str, tags: str = "white_check_mark", priority: str = "default") -> None:
    try:
        requests.post(
            f"https://ntfy.sh/{STATUS_TOPIC}",
            headers={"Title": title, "Tags": tags, "Priority": priority},
            data=body.encode(),
            timeout=5,
        )
    except Exception:
        pass


def launch_build() -> None:
    print("\n  🚀  Build triggered — launching START.bat...\n")
    notify(
        "WorldPulse Build Launching 🚀",
        "Remote trigger received — starting full 14-phase build now.",
        tags="rocket",
        priority="high",
    )
    subprocess.Popen(
        ["cmd", "/c", str(START_BAT)],
        cwd=str(SCRIPT_DIR),
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )


def listen() -> None:
    print(f"  Listening on ntfy.sh/{TRIGGER_TOPIC}")
    print(f"  Send any message from your phone to trigger the build.")
    print(f"  Progress notifications → ntfy.sh/{STATUS_TOPIC}\n")

    url = f"https://ntfy.sh/{TRIGGER_TOPIC}/sse"

    while True:
        try:
            with requests.get(url, stream=True, timeout=300) as resp:
                for raw in resp.iter_lines():
                    if not raw:
                        continue
                    line = raw.decode("utf-8", errors="replace")
                    if not line.startswith("data:"):
                        continue
                    try:
                        data = json.loads(line[5:])
                    except json.JSONDecodeError:
                        continue

                    msg = data.get("message", "").lower().strip()
                    print(f"  📩  Received: \"{data.get('message')}\"")

                    # Any message triggers the build — even just "run" or a thumbs up
                    if msg:
                        launch_build()

        except requests.exceptions.Timeout:
            # Normal — SSE keepalive timeout, just reconnect silently
            pass
        except Exception as exc:
            print(f"  ⚠  Connection error: {exc} — reconnecting in 15s...")
            time.sleep(15)


def main() -> None:
    print()
    print("  ╔═══════════════════════════════════════════╗")
    print("  ║   WORLDPULSE REMOTE TRIGGER LISTENER      ║")
    print("  ║   ntfy.sh/" + TRIGGER_TOPIC.ljust(34) + "║")
    print("  ╚═══════════════════════════════════════════╝")
    print()

    if not START_BAT.exists():
        print(f"  ❌  Cannot find START.bat at: {START_BAT}")
        print("  Make sure this script is in the worldpulse project folder.")
        input("\n  Press Enter to exit.")
        sys.exit(1)

    # Notify phone that the listener is live
    notify(
        "WorldPulse Trigger Ready 👂",
        f"Listener active. Send any message to ntfy.sh/{TRIGGER_TOPIC} to start a build.",
        tags="ear",
        priority="default",
    )

    listen()


if __name__ == "__main__":
    main()

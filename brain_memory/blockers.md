# WorldPulse Brain Agent — Blockers Log

## Active Blockers

### git HEAD.lock + index.lock (LOW SEVERITY — PERSISTENT)
- **Date last seen:** 2026-03-23 Cycle 31
- **Files:** `.git/HEAD.lock` (created 22:01, pre-existing Windows crash) + `.git/index.lock` (created 22:18, during this cycle's git add)
- **Description:** Both lock files exist on Windows NTFS. Linux VM cannot unlink them (Operation not permitted). All git add, commit, and push operations fail.
- **Current state (Cycle 31):** ALL multi-cycle changes are STAGED in git index — including Cycles 19–31 features (OSINT sources, browser extension, slop detector, category tabs fix, LeftSidebar, test suites, AI summaries, embed widget, developer API, mobile screens, concurrency tuning, caching layer, bundle optimizer). Nothing is lost. Just needs to be committed and pushed.
- **Resolution (run from Windows PowerShell in project directory):**
  ```powershell
  del .git\HEAD.lock
  del .git\index.lock
  git commit -m "fix(feed): wire category channel tabs + update classifier + live sidebar counts"
  git push
  ssh root@142.93.71.102 "cd /opt/worldpulse && git pull && ./deploy.sh"
  ```
- **Note:** Every brain agent cycle accumulates staged changes. The NTFS lock issue is fundamental to running git in WSL2 against a Windows-mounted folder. Consider running the brain agent with git operations from Windows side instead, OR setting up a Linux-native git repo with push-to-Windows-checkout workflow.

## Resolved Blockers
- **2026-03-22 Cycle 28:** index.lock was absent at start of Cycle 29 — git status showed clean. This means Windows sometimes clears the lock on its own (probably VSCode/Windows Terminal restart). The lock is not permanent but recurs.

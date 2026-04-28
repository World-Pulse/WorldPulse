# WorldPulse - Full Build Runner
# Uses the exact same pattern as claude_autopilot_v2.ps1 (already confirmed working)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir
$env:PATH += ";$env:APPDATA\npm"

$logFile  = Join-Path $scriptDir "autopilot.log"
$killFile = Join-Path $scriptDir ".claude_kill"
$budget   = 8.00

# ── PHONE NOTIFICATIONS (ntfy.sh) ────────────────────────────────────────────
# Install the free ntfy app on your phone: https://ntfy.sh
# Subscribe to the topic below, then notifications arrive automatically.
# Change NTFY_TOPIC to any unique string you like (it's your private channel).
$NTFY_TOPIC = "worldpulse-batman"

function Send-PhoneNotification {
    param(
        [string]$Title,
        [string]$Body,
        [string]$Tags = "white_check_mark",
        [string]$Priority = "default"
    )
    if ([string]::IsNullOrWhiteSpace($NTFY_TOPIC)) { return }
    try {
        $headers = @{
            Title    = $Title
            Tags     = $Tags
            Priority = $Priority
        }
        Invoke-WebRequest -Method POST `
            -Uri "https://ntfy.sh/$NTFY_TOPIC" `
            -Headers $headers `
            -Body $Body `
            -UseBasicParsing `
            -ErrorAction SilentlyContinue | Out-Null
    } catch { <# silently ignore if no internet #> }
}
# ─────────────────────────────────────────────────────────────────────────────

$WP_CONTEXT = "You are working on WorldPulse - an open-source global intelligence network. Stack: Next.js 15 + TypeScript, Fastify API, Node.js scraper, PostgreSQL + PostGIS, Redis, Kafka, Meilisearch. pnpm monorepo + Turborepo. Rules: TypeScript strict mode, conventional commits, do not ask for confirmation, run linters after changes, summarise what you completed."

$tasks = @(
    "Fix the PostgreSQL connection issue. The scraper and API connect to 'worldpulse' or 'postgres' but the correct database name is 'worldpulse_db'. Find all .env, .env.example, docker-compose files and connection strings across the project and update them to use 'worldpulse_db' consistently. Do not ask for confirmation.",
    "Build a scraper health dashboard in apps/scraper/. Add: (1) per-source health tracking (last_seen, error_count, success_rate) stored in Redis; (2) GET /api/v1/admin/scraper/health endpoint; (3) dead-source detection after 30 minutes of inactivity; (4) health summary log every 5 minutes. TypeScript strict mode.",
    "Add retry logic and circuit breaker to the WorldPulse scraper in apps/scraper/. Implement: exponential backoff (3 attempts: 1s, 5s, 30s); circuit breaker per source (5 failures = 10min pause); per-domain rate limiting via SCRAPER_RATE_LIMIT_RPS env var; dead-letter queue in Redis at scraper:dlq. TypeScript strict.",
    "Wire the WorldPulse map to live data in apps/web/. Connect MapLibre to GET /api/v1/signals/map. Add severity-based pin colours (critical=red pulse, high=orange, medium=yellow, low=grey). Add Supercluster clustering with count badges. Add click popup showing title, reliability dots, source, and View Signal link. TypeScript strict.",
    "Add WebSocket real-time updates and filters to the WorldPulse map. Subscribe to signal.new events - new signals appear instantly with 3s highlight. Keep max 500 pins. Add filter bar for category, severity, and time range. Persist zoom and pan in URL params. TypeScript strict.",
    "Build the Meilisearch search indexing pipeline in apps/api/. Create indexes for signals, posts, and users with schemas and ranking rules. Add indexing hooks on create/update. Add a backfill script and run it to index all existing data. TypeScript strict.",
    "Build the search feature in WorldPulse. Backend: GET /api/v1/search with query, type, filters, and pagination. Frontend: /search page with tabbed results, Cmd+K command palette with keyboard navigation, autocomplete with 150ms debounce, facet filters for category and date range. TypeScript strict.",
    "Build the signal detail page at /signals/[id] in apps/web/. Include headline, category badge, reliability score with tooltip breakdown, source chain list, embedded map pin, discussion thread with reply/boost/like, related signals sidebar, and share button. Server-side rendered. TypeScript strict.",
    "Build user profile pages at /users/[handle] in apps/web/. Include avatar, account type badge, trust score, follow button, bio, follower counts, posts tab, signals tab, and trust score chart using Recharts. Own profile at /users/me with edit form. TypeScript strict.",
    "Add UI polish to WorldPulse frontend. Replace all spinners with content-shaped loading skeletons. Add empty states with icon, headline, and CTA for all major views. Add toast notification system (top-right, 4s auto-dismiss). Add dark/light mode toggle in nav persisted to localStorage. TypeScript strict.",
    "Make WorldPulse fully responsive. Fix every page for mobile: hamburger nav, full-width feed cards, full-screen map with slide-up panel, full-screen search overlay, stacked profile layout. Fix touch interactions on map. Achieve LCP under 2.5s and CLS under 0.1. TypeScript strict.",
    "Wire the verification engine to the WorldPulse UI. Show 1-5 reliability dots consistently on all content. Add tooltip showing source count, cross-check status, and AI verification status. Add BREAKING badge for signals under 30 minutes old. Add CONTESTED badge. Build community flag modal with reason options. TypeScript strict.",
    "Build new user onboarding flow in apps/web/. After first login show: 3-slide intro, interest category selection, region selection, and follow suggestions based on interests. Mark onboarding complete in user profile. Skip if already done. TypeScript strict.",
    "Add end-to-end tests and security hardening. Vitest tests for all critical API routes (auth, feed, signals, search, posts). Redis rate limiting (auth 5/min, feed 60/min, search 30/min, writes 10/min). Zod validation on all POST/PUT endpoints. CORS config. Fix npm audit vulnerabilities. Security headers in Next.js middleware. TypeScript strict."
)

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "  WORLDPULSE FULL BUILD - $($tasks.Count) phases" -ForegroundColor Cyan
Write-Host "  Budget: `$$budget per phase" -ForegroundColor White
Write-Host "  Log: $logFile" -ForegroundColor White
Write-Host "  STOP: create .claude_kill in this folder" -ForegroundColor Yellow
Write-Host "  Phone alerts: ntfy.sh/$NTFY_TOPIC" -ForegroundColor Magenta
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $killFile) { Remove-Item $killFile -Force }

Add-Content $logFile "============================================"
Add-Content $logFile "BUILD START: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-Content $logFile "============================================"

# Notify build started
Send-PhoneNotification `
    -Title "WorldPulse Build Started" `
    -Body "Starting $($tasks.Count)-phase build. You'll get a ping after each phase." `
    -Tags "rocket" `
    -Priority "default"

$i = 0
foreach ($taskPrompt in $tasks) {
    $i++

    if (Test-Path $killFile) {
        Write-Host "`n  Kill switch triggered. Stopping." -ForegroundColor Yellow
        Add-Content $logFile "STOPPED by kill switch at task $i"
        Remove-Item $killFile -Force
        Send-PhoneNotification -Title "WorldPulse Build STOPPED" -Body "Killed at phase $i/$($tasks.Count)." -Tags "stop_sign" -Priority "high"
        break
    }

    $fullPrompt = "$WP_CONTEXT`n`nTASK $i of $($tasks.Count):`n$taskPrompt"

    Write-Host ""
    Write-Host "  ── Task $i/$($tasks.Count) ──────────────────────────────" -ForegroundColor Cyan
    Write-Host "  $($taskPrompt.Substring(0, [Math]::Min(80, $taskPrompt.Length)))..." -ForegroundColor White
    Write-Host ""

    Add-Content $logFile ""
    Add-Content $logFile "TASK $i/$($tasks.Count): $(Get-Date -Format 'HH:mm:ss')"
    Add-Content $logFile $taskPrompt.Substring(0, [Math]::Min(120, $taskPrompt.Length))

    $start = Get-Date

    try {
        & claude `
            --dangerously-skip-permissions `
            -p $fullPrompt `
            --max-budget-usd $budget 2>&1 | ForEach-Object {
                if ($_.Trim() -ne "") {
                    Write-Host "  $_" -ForegroundColor White
                    Add-Content $logFile "  $_"
                }
            }
    } catch {
        Write-Host "  Task error: $_" -ForegroundColor Red
        Add-Content $logFile "  TASK ERROR: $_"
    }

    $elapsed = "{0:mm}m {0:ss}s" -f ((Get-Date) - $start)
    Write-Host "  Task $i complete in $elapsed" -ForegroundColor Green
    Add-Content $logFile "  Elapsed: $elapsed"

    # ── Send phone notification ───────────────────────────────────────────────
    $shortDesc = $taskPrompt.Substring(0, [Math]::Min(60, $taskPrompt.Length))
    if ($i -lt $tasks.Count) {
        $nextDesc = $tasks[$i].Substring(0, [Math]::Min(50, $tasks[$i].Length))
        Send-PhoneNotification `
            -Title "Phase $i/$($tasks.Count) Done ($elapsed)" `
            -Body "$shortDesc...`nNext: $nextDesc..." `
            -Tags "white_check_mark"
    }
    # ─────────────────────────────────────────────────────────────────────────
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "  ALL $($tasks.Count) PHASES COMPLETE" -ForegroundColor Green
Write-Host "  Check autopilot.log for full output" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Add-Content $logFile "BUILD COMPLETE: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# Final notification
Send-PhoneNotification `
    -Title "WorldPulse Build COMPLETE!" `
    -Body "All $($tasks.Count) phases finished. Check autopilot.log for details." `
    -Tags "tada,white_check_mark" `
    -Priority "high"

Read-Host "`n  Press Enter to close"

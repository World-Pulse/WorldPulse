# claude_autopilot.ps1
# ─────────────────────────────────────────────
# Drop this file into your project root and run it.
# Claude Code will run without permission prompts.
# Press CTRL+C at any time to trigger the kill switch.
# ─────────────────────────────────────────────

param(
    [string]$Prompt = "",
    [decimal]$Budget = 5.00
)

# ── CONFIG ───────────────────────────────────
# Optional: set a default prompt so you don't have to type it each time
# Leave empty to be prompted when the script runs
$DEFAULT_PROMPT = ""
$MAX_BUDGET     = $Budget
# ─────────────────────────────────────────────

$projectPath = Get-Location
$logFile     = Join-Path $projectPath "claude_autopilot.log"
$killFile    = Join-Path $projectPath ".claude_kill"
$timestamp   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# ── DISPLAY HEADER ───────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Claude Autopilot" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Project : $projectPath" -ForegroundColor White
Write-Host "  Budget  : `$$MAX_BUDGET max" -ForegroundColor White
Write-Host "  Log     : claude_autopilot.log" -ForegroundColor White
Write-Host "  KILL    : CTRL+C or create .claude_kill" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── CLEAN UP OLD KILL FILE IF EXISTS ─────────
if (Test-Path $killFile) {
    Remove-Item $killFile -Force
    Write-Host "[INFO] Old kill file cleared." -ForegroundColor DarkGray
}

# ── GET PROMPT ───────────────────────────────
if ($Prompt -ne "") {
    $taskPrompt = $Prompt
} elseif ($DEFAULT_PROMPT -ne "") {
    $taskPrompt = $DEFAULT_PROMPT
} else {
    Write-Host "Enter your task for Claude:" -ForegroundColor Green
    $taskPrompt = Read-Host ">"
}

if ([string]::IsNullOrWhiteSpace($taskPrompt)) {
    Write-Host "[ERROR] No prompt provided. Exiting." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[TASK] $taskPrompt" -ForegroundColor Green
Write-Host ""

# ── LOG START ────────────────────────────────
Add-Content $logFile "============================================"
Add-Content $logFile "Started : $timestamp"
Add-Content $logFile "Project : $projectPath"
Add-Content $logFile "Budget  : `$$MAX_BUDGET"
Add-Content $logFile "Prompt  : $taskPrompt"
Add-Content $logFile "============================================"

# ── KILL SWITCH WATCHER ──────────────────────
# Runs in background — checks every 2 seconds for .claude_kill file
# Create that file from another terminal to stop Claude gracefully
$killJob = Start-Job -ScriptBlock {
    param($killFile, $logFile)
    while ($true) {
        Start-Sleep -Seconds 2
        if (Test-Path $killFile) {
            Add-Content $logFile "`n[KILL SWITCH] .claude_kill detected — stopping Claude."
            # Find and stop any running claude process
            Get-Process -Name "claude" -ErrorAction SilentlyContinue | Stop-Process -Force
            break
        }
    }
} -ArgumentList $killFile, $logFile

Write-Host "[INFO] Kill switch watcher started." -ForegroundColor DarkGray
Write-Host "[INFO] To stop Claude: create a file named .claude_kill in this folder" -ForegroundColor DarkGray
Write-Host "       OR press CTRL+C" -ForegroundColor DarkGray
Write-Host ""

# ── RUN CLAUDE ───────────────────────────────
try {
    $startTime = Get-Date

    # This is the core command — bypasses all permission prompts
    # -p = headless/non-interactive mode (takes prompt directly)
    # --dangerously-skip-permissions = no approval popups
    # --max-budget-usd = hard spending cap
    & claude `
        --dangerously-skip-permissions `
        -p $taskPrompt `
        --max-budget-usd $MAX_BUDGET `
        --output-format stream-json 2>&1 | ForEach-Object {
            $line = $_

            # Try to parse JSON output for clean display
            try {
                $data = $line | ConvertFrom-Json

                switch ($data.type) {
                    "assistant" {
                        foreach ($block in $data.message.content) {
                            if ($block.type -eq "text" -and $block.text.Trim() -ne "") {
                                $text = $block.text.Trim()
                                Write-Host "[Claude] $text" -ForegroundColor White
                                Add-Content $logFile "[Claude] $text"
                            }
                        }
                    }
                    "result" {
                        $cost  = $data.cost_usd
                        $turns = $data.num_turns
                        Write-Host ""
                        Write-Host "============================================" -ForegroundColor Green
                        Write-Host "  DONE — $turns turns,  `$$cost spent" -ForegroundColor Green
                        Write-Host "============================================" -ForegroundColor Green
                        Add-Content $logFile "`nDONE: $turns turns, `$$cost spent"
                    }
                    "error" {
                        Write-Host "[ERROR] $($data.error)" -ForegroundColor Red
                        Add-Content $logFile "[ERROR] $($data.error)"
                    }
                }
            }
            catch {
                # Non-JSON line — print as-is
                if ($line.Trim() -ne "") {
                    Write-Host $line
                    Add-Content $logFile $line
                }
            }

            # Check kill file on every output line too (faster response)
            if (Test-Path $killFile) {
                Write-Host ""
                Write-Host "[KILL SWITCH] Stopping Claude..." -ForegroundColor Yellow
                Add-Content $logFile "[KILL SWITCH] Triggered mid-run."
                break
            }
        }

    $duration = (Get-Date) - $startTime
    $elapsed  = "{0:mm}m {0:ss}s" -f $duration
    Write-Host "[INFO] Total time: $elapsed" -ForegroundColor DarkGray
    Add-Content $logFile "Duration: $elapsed"

}
catch {
    Write-Host ""
    Write-Host "[STOPPED] Claude was interrupted." -ForegroundColor Yellow
    Add-Content $logFile "[STOPPED] $(Get-Date -Format 'HH:mm:ss')"
}
finally {
    # ── CLEANUP ──────────────────────────────
    Stop-Job $killJob -ErrorAction SilentlyContinue
    Remove-Job $killJob -ErrorAction SilentlyContinue

    if (Test-Path $killFile) {
        Remove-Item $killFile -Force
    }

    $endTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content $logFile "Ended: $endTime"
    Add-Content $logFile "============================================`n"

    Write-Host ""
    Write-Host "[INFO] Session ended. Log saved to claude_autopilot.log" -ForegroundColor DarkGray
}

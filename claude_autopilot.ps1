# claude_autopilot.ps1
# Drop into your project root and run with: .\claude_autopilot.ps1
# Kill switch: press CTRL+C or create a file named .claude_kill in the project folder

param(
    [string]$Prompt = "",
    [decimal]$Budget = 5.00
)

$projectPath = Get-Location
$logFile     = Join-Path $projectPath "claude_autopilot.log"
$killFile    = Join-Path $projectPath ".claude_kill"
$timestamp   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Claude Autopilot" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Project : $projectPath" -ForegroundColor White
Write-Host "  Budget  : `$$Budget max" -ForegroundColor White
Write-Host "  Log     : claude_autopilot.log" -ForegroundColor White
Write-Host "  KILL    : CTRL+C or create .claude_kill file" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $killFile) {
    Remove-Item $killFile -Force
}

if ($Prompt -ne "") {
    $taskPrompt = $Prompt
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

Add-Content $logFile "============================================"
Add-Content $logFile "Started : $timestamp"
Add-Content $logFile "Project : $projectPath"
Add-Content $logFile "Prompt  : $taskPrompt"
Add-Content $logFile "============================================"

Write-Host "[INFO] Running Claude without permission prompts..." -ForegroundColor DarkGray
Write-Host "[INFO] To stop: press CTRL+C or run: New-Item .claude_kill" -ForegroundColor DarkGray
Write-Host ""

try {
    $startTime = Get-Date

    & claude --dangerously-skip-permissions -p $taskPrompt --max-budget-usd $Budget 2>&1 | ForEach-Object {
        $line = $_.ToString()

        if (Test-Path $killFile) {
            Write-Host ""
            Write-Host "[KILL SWITCH] Stopping Claude..." -ForegroundColor Yellow
            Add-Content $logFile "[KILL SWITCH] Triggered."
            exit 0
        }

        try {
            $data = $line | ConvertFrom-Json
            $msgType = $data.type

            if ($msgType -eq "assistant") {
                foreach ($block in $data.message.content) {
                    if ($block.type -eq "text") {
                        $text = $block.text.Trim()
                        if ($text -ne "") {
                            Write-Host "[Claude] $text" -ForegroundColor White
                            Add-Content $logFile "[Claude] $text"
                        }
                    }
                }
            } elseif ($msgType -eq "result") {
                $cost  = $data.cost_usd
                $turns = $data.num_turns
                Write-Host ""
                Write-Host "============================================" -ForegroundColor Green
                Write-Host "  DONE - $turns turns, `$$cost spent" -ForegroundColor Green
                Write-Host "============================================" -ForegroundColor Green
                Add-Content $logFile "DONE: $turns turns, cost: $cost"
            } elseif ($msgType -eq "error") {
                $errMsg = $data.error
                Write-Host "[ERROR] $errMsg" -ForegroundColor Red
                Add-Content $logFile "[ERROR] $errMsg"
            }
        } catch {
            if ($line.Trim() -ne "") {
                Write-Host $line
                Add-Content $logFile $line
            }
        }
    }

    $duration = (Get-Date) - $startTime
    $elapsed = [string]([math]::Floor($duration.TotalMinutes)) + "m " + $duration.Seconds + "s"
    Write-Host "[INFO] Total time: $elapsed" -ForegroundColor DarkGray
    Add-Content $logFile "Duration: $elapsed"

} catch {
    Write-Host ""
    Write-Host "[STOPPED] Claude was interrupted." -ForegroundColor Yellow
    Add-Content $logFile "[STOPPED] $(Get-Date -Format 'HH:mm:ss')"
} finally {
    if (Test-Path $killFile) {
        Remove-Item $killFile -Force
    }
    Add-Content $logFile "Ended: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    Add-Content $logFile "============================================"
    Write-Host ""
    Write-Host "[INFO] Session ended. Log saved to claude_autopilot.log" -ForegroundColor DarkGray
}

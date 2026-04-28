# WorldPulse Brain Agent — Cycle Completion Notifier
# Usage: .\notify_cycle_complete.ps1 [-Cycle 15]
# Watches brain_agent.log and sends ntfy + Windows toast when cycle completes.

param(
    [int]$Cycle = 15
)

$NTFY_TOPIC = "worldpulse-batman"
$NTFY_URL   = "https://ntfy.sh/$NTFY_TOPIC"
$LOG_FILE   = "$PSScriptRoot\brain_agent.log"
$POLL_MS    = 3000
$MARKER     = "BRAIN CYCLE COMPLETE #$Cycle"

function Send-Ntfy($Title, $Message, $Priority = "high", $Tags = "white_check_mark,brain") {
    try {
        $body = [System.Text.Encoding]::UTF8.GetBytes($Message)
        $req  = [System.Net.HttpWebRequest]::Create($NTFY_URL)
        $req.Method      = "POST"
        $req.ContentType = "text/plain; charset=utf-8"
        $req.Headers.Add("Title",    $Title)
        $req.Headers.Add("Priority", $Priority)
        $req.Headers.Add("Tags",     $Tags)
        $stream = $req.GetRequestStream()
        $stream.Write($body, 0, $body.Length)
        $stream.Close()
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        $resp.Close()
        return $code -eq 200
    } catch {
        Write-Host "  [ntfy] Error: $_" -ForegroundColor Red
        return $false
    }
}

function Show-WindowsToast($Title, $Message) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]                      | Out-Null
        $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
        $xml.LoadXml(@"
<toast>
  <visual><binding template='ToastGeneric'>
    <text>$Title</text>
    <text>$Message</text>
  </binding></visual>
</toast>
"@)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("WorldPulse")
        $notifier.Show($toast)
    } catch {
        # Toast not critical — skip silently
    }
}

# ── Start ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  WorldPulse Brain Agent Notifier" -ForegroundColor Cyan
Write-Host "  Watching for cycle #$Cycle completion..." -ForegroundColor Cyan
Write-Host "  Log: $LOG_FILE"
Write-Host "  ntfy: $NTFY_URL"
Write-Host ""

if (-not (Test-Path $LOG_FILE)) {
    Write-Host "  [!] Log file not found: $LOG_FILE" -ForegroundColor Red
    exit 1
}

# Send test ping
Write-Host "  Sending test notification..." -NoNewline
$ok = Send-Ntfy -Title "WorldPulse Monitor Active" `
                -Message "Watching for brain agent cycle #$Cycle. You will be notified when it completes." `
                -Priority "default" `
                -Tags "eyes,brain"
if ($ok) { Write-Host " sent!" -ForegroundColor Green }
else      { Write-Host " failed (check internet connection)" -ForegroundColor Red }

Show-WindowsToast "WorldPulse Monitor Active" "Watching for cycle #$Cycle..."

# ── Poll loop ────────────────────────────────────────────────────────────────
$offset   = (Get-Item $LOG_FILE).Length
$taskName = $null

Write-Host "  Polling every $($POLL_MS/1000)s..." -ForegroundColor DarkGray

while ($true) {
    Start-Sleep -Milliseconds $POLL_MS

    $currentSize = (Get-Item $LOG_FILE).Length
    if ($currentSize -le $offset) { continue }

    $fs     = [System.IO.File]::Open($LOG_FILE, 'Open', 'Read', 'ReadWrite')
    $reader = [System.IO.StreamReader]::new($fs)
    $fs.Seek($offset, 'Begin') | Out-Null
    $newText = $reader.ReadToEnd()
    $offset  = $fs.Position
    $reader.Close(); $fs.Close()

    foreach ($line in $newText -split "`n") {
        if ($line -match "Executing: (.+)") {
            $taskName = $matches[1].Trim()
        }

        if ($line -like "*$MARKER*") {
            $health  = if ($line -match "health=([\d.]+)") { $matches[1] } else { "?" }
            $shipped = if ($line -match "shipped=(\d+)")   { $matches[1] } else { "?" }

            $summary = "Cycle #$Cycle complete!`nHealth: $health/10 | Shipped: $shipped improvements`nLast task: $taskName`nSafe to run git push now."

            Write-Host ""
            Write-Host "  *** CYCLE #$Cycle COMPLETE ***" -ForegroundColor Green
            Write-Host $summary
            Write-Host ""

            $sent = Send-Ntfy -Title "WorldPulse Brain Cycle #$Cycle Complete" `
                              -Message $summary `
                              -Priority "high" `
                              -Tags "white_check_mark,brain,rocket"

            Show-WindowsToast "WorldPulse Cycle #$Cycle Done" $summary

            Write-Host "  ntfy: $(if ($sent) { 'sent!' } else { 'failed' })" -ForegroundColor $(if ($sent) { 'Green' } else { 'Red' })
            Write-Host "  Windows toast: shown"
            Write-Host ""
            Write-Host "  Run your push commands now:" -ForegroundColor Yellow
            Write-Host "  git add brain_memory/PRIORITY_DIRECTIONS.md"
            Write-Host "  git commit -m 'brain: full codebase audit directions for next cycle'"
            Write-Host "  git push"
            exit 0
        }
    }
}

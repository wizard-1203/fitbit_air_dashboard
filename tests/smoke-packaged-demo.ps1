param(
    [string]$ExecutablePath = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist\FitbitDashboard.exe")
)

$ErrorActionPreference = "Stop"

$exe = $ExecutablePath
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Packaged executable not found: $exe"
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$oldPort = $env:PORT
$oldNoBrowser = $env:HEALTH_NO_BROWSER
$env:PORT = [string]$port
$env:HEALTH_NO_BROWSER = "1"
$process = $null

try {
    $process = Start-Process -FilePath $exe -ArgumentList "--demo" -WindowStyle Hidden -PassThru
    $url = "http://127.0.0.1:$port/api/data?days=30"
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    $payload = $null

    while ([DateTime]::UtcNow -lt $deadline) {
        if ($process.HasExited) {
            throw "Packaged demo exited early with code $($process.ExitCode)."
        }
        try {
            $payload = Invoke-RestMethod -Uri $url -TimeoutSec 5
            break
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }

    if ($null -eq $payload) {
        throw "Packaged demo did not serve its data endpoint within 45 seconds."
    }
    if ($payload.demo -ne $true) {
        throw "Packaged demo endpoint responded, but did not identify the payload as demo data."
    }
    $batchBody = @{ snapshots = @(@{ id = "packaged-smoke-missing-session"; snapshot = @{ score = 50; coverage = 1 } }) } |
        ConvertTo-Json -Depth 6 -Compress
    $batch = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/sleep-score-snapshots" `
        -Headers @{ "X-Requested-With" = "HealthDashboard" } -ContentType "application/json" -Body $batchBody -TimeoutSec 5
    if ($batch.saved -ne $true -or $batch.count -ne 0) {
        throw "Packaged demo batch snapshot endpoint returned an unexpected response."
    }
    Write-Host "Packaged demo smoke test passed: $url"
} finally {
    if ($process -and -not $process.HasExited) {
        & "$env:SystemRoot\System32\taskkill.exe" /T /F /PID $process.Id *> $null
        $process.WaitForExit()
    }
    if ($null -eq $oldPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue }
    else { $env:PORT = $oldPort }
    if ($null -eq $oldNoBrowser) { Remove-Item Env:HEALTH_NO_BROWSER -ErrorAction SilentlyContinue }
    else { $env:HEALTH_NO_BROWSER = $oldNoBrowser }
}

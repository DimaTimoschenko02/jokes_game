$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if (-not (Test-Path ".env")) {
  Write-Warning ".env not found. Set NGROK_AUTHTOKEN in .env for ngrok in Docker."
}

Write-Host "docker compose --profile tunnel up --build -d"
docker compose --profile tunnel up --build -d
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "Waiting for ngrok tunnel..."
$publicUrl = $null
for ($i = 0; $i -lt 45; $i++) {
  try {
    $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 3
    $publicUrl = $tunnels.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1 -ExpandProperty public_url
    if (-not $publicUrl) {
      $publicUrl = $tunnels.tunnels[0].public_url
    }
    if ($publicUrl) {
      break
    }
  } catch {
  }
  Start-Sleep -Seconds 1
}

if ($publicUrl) {
  Write-Host ""
  Write-Host "Public URL: $publicUrl"
} else {
  Write-Warning "Could not read URL from http://127.0.0.1:4040. Check: docker logs punchme-ngrok"
}

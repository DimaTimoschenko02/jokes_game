$ErrorActionPreference = "Continue"
Set-Location -Path (Join-Path $PSScriptRoot "..")

Write-Host "=== 1. Ollama on host port (127.0.0.1:11434, published from container) ===" -ForegroundColor Cyan
try {
  $tagsResponse = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 6
  $n = @($tagsResponse.models).Count
  Write-Host "OK - /api/tags returned, models in list: $n" -ForegroundColor Green
} catch {
  Write-Host "FAIL - $_" -ForegroundColor Red
  Write-Host ""
  Write-Host "  Run: docker compose up -d ollama (or full stack). First time: npm run docker:pull-model" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "=== 2. From punchme-api -> http://ollama:11434 (Compose network) ===" -ForegroundColor Cyan
$cid = docker ps -q -f 'name=^punchme-api$'
if (-not $cid) {
  Write-Host "SKIP - punchme-api not running (npm run docker:up or start:all)" -ForegroundColor Yellow
  exit 0
}

$js = 'fetch("http://ollama:11434/api/tags").then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}).then(j=>console.log("OK tags_count="+(j.models?j.models.length:0))).catch(e=>{console.error("FAIL",e.message);process.exit(1)})'
docker exec punchme-api node -e $js
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  API cannot reach service ollama. Check: docker compose ps, same project network." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "All checks passed." -ForegroundColor Green
exit 0

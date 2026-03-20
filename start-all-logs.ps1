$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
docker compose --profile tunnel logs -f --tail=200

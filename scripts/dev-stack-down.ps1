$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path

Write-Host "[dev-stack] Stopping infrastructure containers"
Push-Location (Join-Path $repoRoot "deploy")
try {
  docker compose stop postgres redis redpanda
}
finally {
  Pop-Location
}

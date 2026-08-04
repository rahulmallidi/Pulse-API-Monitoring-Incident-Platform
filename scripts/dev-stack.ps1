param(
  [switch]$SkipBootstrap,
  [switch]$ForceFreePorts
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path

function Write-Step {
  param([string]$Message)
  Write-Host "[dev-stack] $Message"
}

function Get-PortPids {
  param([int]$Port)

  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  if ($null -eq $connections) {
    return @()
  }

  return @($connections | Where-Object { $_ -gt 0 })
}

function Ensure-PortsAvailable {
  param([int[]]$Ports, [switch]$Force)

  $occupied = @()
  foreach ($port in $Ports) {
    $pids = Get-PortPids -Port $port
    if ($pids.Count -gt 0) {
      foreach ($procId in $pids) {
        $occupied += [pscustomobject]@{ Port = $port; Pid = $procId }
      }
    }
  }

  if ($occupied.Count -eq 0) {
    return
  }

  $lines = $occupied | Sort-Object Port, Pid | ForEach-Object { "port $($_.Port) -> pid $($_.Pid)" }

  if (-not $Force) {
    throw "Required ports are already in use: $($lines -join ', '). Rerun with -ForceFreePorts to stop these processes automatically."
  }

  Write-Step "Stopping processes occupying required ports"
  $occupied | Select-Object -ExpandProperty Pid -Unique | ForEach-Object {
    try {
      Stop-Process -Id $_ -Force -ErrorAction Stop
    }
    catch {
      Write-Warning ("Failed to stop pid {0}: {1}" -f $_, $_.Exception.Message)
    }
  }
}

Write-Step "Checking required ports (3000-3005)"
Ensure-PortsAvailable -Ports @(3000, 3001, 3002, 3003, 3004, 3005) -Force:$ForceFreePorts

Write-Step "Starting infrastructure containers (postgres, redis, redpanda)"
Push-Location (Join-Path $repoRoot "deploy")
try {
  docker compose up -d postgres redis redpanda
}
finally {
  Pop-Location
}

Push-Location $repoRoot
try {
  if (-not $SkipBootstrap) {
    Write-Step "Bootstrapping database schema and demo seed"
    pnpm --filter @pulse/db bootstrap
  } else {
    Write-Step "Skipping database bootstrap"
  }

  $env:DATABASE_URL = "postgresql://pulse:pulse@localhost:5432/pulse?schema=public"
  $env:REDIS_URL = "redis://localhost:6379"
  $env:KAFKA_BROKERS = "localhost:9092"
  $env:KAFKA_CLIENT_ID = "pulse"
  $env:REGION = "all"
  $env:CORS_ORIGIN = "http://localhost:3005,http://127.0.0.1:3005"
  $env:NEXT_PUBLIC_API_SSE_URL = "http://localhost:3000/live/probes"

  Write-Step "Launching API, workers, and dashboard in one process"
  pnpm turbo run dev --parallel --filter=@pulse/api --filter=@pulse/scheduler --filter=@pulse/probe --filter=@pulse/ingestor --filter=@pulse/alerter --filter=@pulse/web
}
finally {
  Pop-Location
}

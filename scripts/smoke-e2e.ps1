param(
  [string]$ApiBaseUrl = "http://localhost:3100",
  [string]$TenantId = "11111111-1111-1111-1111-111111111111",
  [int]$IncidentTimeoutSec = 90,
  [int]$SseTimeoutSec = 40
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

function Write-Step {
  param([string]$Message)
  Write-Host "[smoke] $Message"
}

function Invoke-Json {
  param(
    [ValidateSet("GET", "POST", "PATCH")]
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers,
    [object]$Body
  )

  $params = @{
    Method = $Method
    Uri = $Url
    Headers = $Headers
    TimeoutSec = 15
  }

  if ($null -ne $Body) {
    $params["ContentType"] = "application/json"
    $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
  }

  Invoke-RestMethod @params
}

Write-Step "Checking API health at $ApiBaseUrl/health"
$health = Invoke-Json -Method "GET" -Url "$ApiBaseUrl/health" -Headers @{} -Body $null
if ($health.status -ne "ok") {
  throw "API health check failed. Response: $($health | ConvertTo-Json -Depth 5 -Compress)"
}

$checkName = "Smoke Failing Check $(Get-Date -Format 'yyyyMMddHHmmss')"
$createPayload = @{
  tenantId = $TenantId
  name = $checkName
  type = "http"
  config = @{
    url = "http://127.0.0.1:65530"
    method = "GET"
  }
  intervalS = 30
  regions = @("us-east")
  tags = @("smoke", "auto")
  enabled = $true
}

Write-Step "Creating failing check for tenant $TenantId"
$created = Invoke-Json -Method "POST" -Url "$ApiBaseUrl/checks" -Headers @{} -Body $createPayload
$checkId = $created.id
if ([string]::IsNullOrWhiteSpace($checkId)) {
  throw "Check creation failed. Missing id in response."
}
Write-Step "Created check id $checkId"

Write-Step "Polling incidents until one is opened for the check"
$incident = $null
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
while ($stopwatch.Elapsed.TotalSeconds -lt $IncidentTimeoutSec) {
  $incidents = Invoke-Json -Method "GET" -Url "$ApiBaseUrl/incidents" -Headers @{ "x-tenant-id" = $TenantId } -Body $null
  if ($incidents -is [array]) {
    $incident = $incidents | Where-Object { $_.checkId -eq $checkId } | Select-Object -First 1
  } elseif ($incidents.value -is [array]) {
    $incident = $incidents.value | Where-Object { $_.checkId -eq $checkId } | Select-Object -First 1
  }

  if ($null -ne $incident) {
    break
  }

  [System.Threading.Tasks.Task]::Delay(1500).Wait()
}

if ($null -eq $incident) {
  throw "No incident observed for check $checkId within ${IncidentTimeoutSec}s"
}
Write-Step "Incident observed id $($incident.id) state $($incident.state)"

Write-Step "Capturing SSE stream from $ApiBaseUrl/live/probes"
$sseBuffer = ""
$foundSseEvent = $false

$request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$ApiBaseUrl/live/probes")
$request.Headers.Add("x-tenant-id", $TenantId)
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds($SseTimeoutSec + 5)
$reader = $null
$response = $null

try {
  $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  [void]$response.EnsureSuccessStatusCode()

  $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
  $reader = [System.IO.StreamReader]::new($stream)
  $sseStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $pendingRead = $null

  while ($sseStopwatch.Elapsed.TotalSeconds -lt $SseTimeoutSec) {
    if ($null -eq $pendingRead) {
      $pendingRead = $reader.ReadLineAsync()
    }

    if (-not $pendingRead.Wait(1000)) {
      continue
    }

    $line = $pendingRead.GetAwaiter().GetResult()
    $pendingRead = $null
    if ([string]::IsNullOrEmpty($line)) {
      continue
    }

    $sseBuffer += "$line`n"
    if ($line.StartsWith("data:") -and $sseBuffer -match [Regex]::Escape($checkId)) {
      $foundSseEvent = $true
      break
    }
  }
}
finally {
  if ($null -ne $reader) {
    $reader.Dispose()
  }
  if ($null -ne $response) {
    $response.Dispose()
  }
  $request.Dispose()
  $client.Dispose()
}

if (-not $foundSseEvent) {
  throw "SSE stream did not include an event for check $checkId within ${SseTimeoutSec}s"
}

Write-Step "SSE event observed for check $checkId"

$result = [ordered]@{
  status = "pass"
  apiBaseUrl = $ApiBaseUrl
  tenantId = $TenantId
  checkId = $checkId
  incidentId = $incident.id
  incidentState = $incident.state
  checkName = $checkName
}

$result | ConvertTo-Json -Depth 6

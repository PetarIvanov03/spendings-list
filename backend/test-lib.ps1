# Shared by test-step2.ps1, test-step3.ps1 and test-step4.ps1 (dot-sourced).
# Talks to the Apps Script web app with explicit redirect handling and verifies that every
# response belongs to its request.
#
#  - POST with Invoke-WebRequest -MaximumRedirection 0, catch the 302, then GET its Location
#    header and parse the body of that response. Redirects are never followed automatically.
#  - Every request carries a requestId and the server echoes "action" and "requestId". A
#    response that does not match (or has no echo, like the old doGet "pong") is a transport
#    failure, never a success.
#  - A transport failure (HTTP 404, 5xx, no response, unusable or mismatching body) is retried
#    up to 3 times with a 2 s pause. The body, and so the requestId, is built once, so a
#    retried write is replayed by the server instead of running twice.
#  - On failure it prints the HTTP status, the redirect Location HOST (never the full URL) and
#    the body length, and returns { ok = $false; error = { code = 'TRANSPORT'; message } }.
# Written for Windows PowerShell 5.1.

# TLS 1.2 for Google, no "Expect: 100-continue" round trip.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::Expect100Continue = $false

function Read-ResponseText($webResponse) {
  try {
    $reader = New-Object IO.StreamReader($webResponse.GetResponseStream(), [Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $reader.Close()
    return $text
  }
  catch { return $null }
}

function Get-UrlHost($url) {
  if (-not $url) { return '-' }
  try { return ([Uri]$url).Host } catch { return '?' }
}

# One HTTP exchange with NO automatic redirect (HttpWebRequest.AllowAutoRedirect = false), so a
# 302 comes back as a normal response. Returns Status (0 = no response at all), Location, Text,
# Failure. (Invoke-WebRequest -MaximumRedirection 0 was tried first: on current Windows
# PowerShell 5.1 builds it throws "Operation is not valid..." without any response object.)
function Send-Http($uri, $method, $bodyBytes) {
  $response = $null
  $failure = $null
  try {
    $request = [Net.HttpWebRequest]::Create($uri)
    $request.Method = $method
    $request.AllowAutoRedirect = $false
    $request.Timeout = 90000
    $request.ReadWriteTimeout = 90000
    $request.UserAgent = 'spendings-list-tests'
    if ($null -ne $bodyBytes) {
      $request.ContentType = 'text/plain;charset=utf-8'
      $request.ContentLength = $bodyBytes.Length
      $requestStream = $request.GetRequestStream()
      $requestStream.Write($bodyBytes, 0, $bodyBytes.Length)
      $requestStream.Close()
    }
    $response = $request.GetResponse()
  }
  catch {
    $caught = $_
    $failure = $caught.Exception.Message
    # A WebException with a response is an HTTP error status (404, 500...): keep the response.
    if ($caught.Exception.InnerException -and $caught.Exception.InnerException.Response) { $response = $caught.Exception.InnerException.Response }
    elseif ($caught.Exception.Response) { $response = $caught.Exception.Response }
  }
  if ($null -eq $response) {
    return [pscustomobject]@{ Status = 0; Location = $null; Text = $null; Failure = $failure }
  }
  $result = [pscustomobject]@{
    Status = [int]$response.StatusCode
    Location = $response.Headers['Location']
    Text = Read-ResponseText $response
    Failure = $failure
  }
  $response.Close()
  return $result
}

# Sends the request, then follows redirects by hand: a plain GET of each Location header.
function Send-WithRedirects($bodyBytes, $method) {
  $step = Send-Http $env:API_URL $method $bodyBytes
  $locationHost = '-'
  $hops = 0
  while (@(301, 302, 303, 307, 308) -contains $step.Status -and $step.Location -and $hops -lt 3) {
    $hops++
    $locationHost = Get-UrlHost $step.Location
    $step = Send-Http $step.Location 'GET' $null
  }
  $step | Add-Member -NotePropertyName LocationHost -NotePropertyValue $locationHost -Force
  return $step
}

# Does the response answer THIS request? Case-sensitive on purpose.
function Test-ResponseMatches($response, $action, $requestId) {
  if ($null -eq $response) { return $false }
  return ($response.action -ceq $action) -and ($response.requestId -ceq $requestId)
}

function New-TransportFailure($message) {
  [pscustomobject]@{ ok = $false; error = [pscustomobject]@{ code = 'TRANSPORT'; message = $message } }
}

# One attempt. Returns @{ Response; Problem } where Problem is $null when the response is usable.
function Invoke-ApiOnce($bodyJson, $action, $requestId) {
  $step = Send-WithRedirects ([Text.Encoding]::UTF8.GetBytes($bodyJson)) 'POST'
  $length = if ($null -ne $step.Text) { $step.Text.Length } else { 0 }
  $facts = "status=$($step.Status) locationHost=$($step.LocationHost) bodyLength=$length"

  if ($step.Status -ne 200) {
    $reason = if ($step.Failure) { $step.Failure } else { 'unexpected HTTP status' }
    return [pscustomobject]@{ Response = $null; Problem = "$facts reason=$reason"; Retry = ($step.Status -eq 0 -or $step.Status -eq 404 -or $step.Status -ge 500) }
  }
  $parsed = $null
  try { $parsed = $step.Text | ConvertFrom-Json }
  catch { return [pscustomobject]@{ Response = $null; Problem = "$facts reason=body is not usable JSON (too large for PowerShell 5.1, or an HTML page)"; Retry = $true } }
  if (-not (Test-ResponseMatches $parsed $action $requestId)) {
    $echoedAction = if ($null -eq $parsed.action) { '(none)' } else { $parsed.action }
    $echoedId = if ($null -eq $parsed.requestId) { 'missing' } else { 'different' }
    return [pscustomobject]@{ Response = $null; Problem = "$facts reason=response does not belong to this request (echoed action=$echoedAction, requestId $echoedId)"; Retry = $true }
  }
  return [pscustomobject]@{ Response = $parsed; Problem = $null; Retry = $false }
}

# The test helper every script uses. Pass $requestId to reuse one on purpose.
function Api($action, $payload = @{}, $token = $null, $requestId = $null, [switch]$WithTiming) {
  if (-not $requestId) { $requestId = [guid]::NewGuid().ToString('N') }
  $request = @{ action = $action; token = $token; payload = $payload; requestId = $requestId }
  if ($WithTiming) { $request.debug = $true }
  $bodyJson = $request | ConvertTo-Json -Depth 5 -Compress # built once: every retry sends the same requestId

  $lastProblem = 'no attempt made'
  for ($try = 1; $try -le 3; $try++) {
    $outcome = Invoke-ApiOnce $bodyJson $action $requestId
    if ($null -ne $outcome.Response) { return $outcome.Response }
    $lastProblem = $outcome.Problem
    Write-Host "      transport problem on '$action' (try $try/3): $lastProblem" -ForegroundColor Yellow
    if (-not $outcome.Retry) { break }
    if ($try -lt 3) { Start-Sleep -Seconds 2 }
  }
  New-TransportFailure $lastProblem
}

# Cold-start warm-up: GET doGet (answers "pong"). Never fatal, only reported.
function Invoke-WarmUp {
  $step = Send-WithRedirects $null 'GET'
  $length = if ($null -ne $step.Text) { $step.Text.Length } else { 0 }
  if ($step.Status -eq 200 -and $step.Text -match 'pong') { return }
  Write-Host "warm-up GET: status=$($step.Status) locationHost=$($step.LocationHost) bodyLength=$length (continuing)" -ForegroundColor Yellow
}

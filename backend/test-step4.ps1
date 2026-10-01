# Step 4 tests: bootstrap, requestId idempotency, ms / timing fields.
# Needs the admin and two active members, and one active category.
# Usage:
#   $env:API_URL = '<web app url>'
#   .\test-step4.ps1 -Admin Petar -UserA Dobrinka -UserB Ivomira -ActiveCategory Fuel
# PINs are prompted, never stored. Creates rows with item prefix "t4-" dated today and
# deletes them at the end (also after an error), using a fresh admin login.
param(
  [Parameter(Mandatory)][string]$Admin,
  [Parameter(Mandatory)][string]$UserA,
  [Parameter(Mandatory)][string]$UserB,
  [Parameter(Mandatory)][string]$ActiveCategory
)

$API_URL = $env:API_URL
if (-not $API_URL) { throw 'Set $env:API_URL first' }

# Api helper, redirect handling, retries and echo check live in test-lib.ps1.
. "$PSScriptRoot\test-lib.ps1"
Invoke-WarmUp

$script:fails = 0
function Check($name, $cond, $res = $null, $detail = '') {
  if ($cond) { Write-Host "PASS  $name" -ForegroundColor Green; return }
  Write-Host "FAIL  $name" -ForegroundColor Red
  $script:fails++
  if ($null -ne $res) {
    Write-Host "      ok=$($res.ok) code=$($res.error.code) message=$($res.error.message)" -ForegroundColor Yellow
  }
  if ($detail) { Write-Host "      $detail" -ForegroundColor Yellow }
}
function CheckError($name, $res, $code) {
  Check "$name (expected $code, got $($res.error.code))" (($res.ok -eq $false) -and ($res.error.code -eq $code))
}
function Same($left, $right) {
  (ConvertTo-Json $left -Depth 8 -Compress) -eq (ConvertTo-Json $right -Depth 8 -Compress)
}
function CountItem($rows, $item) { @($rows | Where-Object { $_.item -eq $item }).Count }
function Pin($user) {
  $secure = Read-Host "PIN for $user" -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

# What is wrong with a response that should carry a timing object (field names only).
function Get-TimingProblem($res, $phases) {
  if ($null -eq $res.timing) {
    return "timing object missing; the response only has these fields: $((@($res.PSObject.Properties.Name) -join ', '))"
  }
  $absent = @($phases | Where-Object { $null -eq $res.timing.$_ })
  if ($absent.Count -gt 0) { return "timing present but these phases are missing: $($absent -join ', ')" }
  return ''
}

# How two expense lists differ: counts, how many ids are on one side only, which FIELD NAMES differ.
function Get-ListDifference($first, $second, $firstName, $secondName) {
  $left = @($first)
  $right = @($second)
  $parts = @("$firstName has $($left.Count) rows, $secondName has $($right.Count)")
  $leftIds = @($left | ForEach-Object { $_.id })
  $rightIds = @($right | ForEach-Object { $_.id })
  $onlyLeft = @($leftIds | Where-Object { $rightIds -notcontains $_ }).Count
  $onlyRight = @($rightIds | Where-Object { $leftIds -notcontains $_ }).Count
  if ($onlyLeft -gt 0) { $parts += "$onlyLeft id(s) only in $firstName" }
  if ($onlyRight -gt 0) { $parts += "$onlyRight id(s) only in $secondName" }
  $differing = @{}
  foreach ($row in $left) {
    $other = $right | Where-Object { $_.id -eq $row.id } | Select-Object -First 1
    if ($null -eq $other) { continue }
    foreach ($field in $row.PSObject.Properties.Name) {
      if ("$($row.$field)" -cne "$($other.$field)") { $differing[$field] = $true }
    }
  }
  if ($differing.Count -gt 0) { $parts += "fields that differ: $((@($differing.Keys) | Sort-Object) -join ', ')" }
  if ($parts.Count -eq 1 -and $left.Count -eq $right.Count) { $parts += 'same rows and values, different order' }
  return ($parts -join '; ')
}

$thisMonth = Get-Date -Format 'yyyy-MM'
$today = Get-Date -Format 'yyyy-MM-dd'

# Deletes every "t4-" expense dated this month. Prints id and error code for each failure.
function Remove-TestRows($adminToken) {
  $listing = Api 'listExpenses' @{ month = $thisMonth } $adminToken
  if (-not $listing.ok) {
    Write-Host "      cannot list test rows: code=$($listing.error.code) message=$($listing.error.message)" -ForegroundColor Yellow
    return 1
  }
  $failed = 0
  foreach ($row in @($listing.data | Where-Object { $_.item -like 't4-*' })) {
    $deleted = Api 'deleteExpense' @{ id = $row.id } $adminToken
    if (-not $deleted.ok) {
      $failed++
      Write-Host "      could not delete id=$($row.id) code=$($deleted.error.code) message=$($deleted.error.message)" -ForegroundColor Yellow
    }
  }
  return $failed
}

# --- login ---
$pinAdmin = Pin $Admin
$pinUserA = Pin $UserA
$pinUserB = Pin $UserB
$respAdmin = Api 'login' @{ user = $Admin; pin = $pinAdmin }
$respUserA = Api 'login' @{ user = $UserA; pin = $pinUserA }
$respUserB = Api 'login' @{ user = $UserB; pin = $pinUserB }
Check 'login admin' ($respAdmin.ok -and $respAdmin.data.user.role -eq 'admin') $respAdmin
Check 'login user A' ($respUserA.ok -and $respUserA.data.user.role -eq 'member') $respUserA
Check 'login user B' ($respUserB.ok -and $respUserB.data.user.role -eq 'member') $respUserB
if (-not ($respAdmin.ok -and $respUserA.ok -and $respUserB.ok)) { throw 'Login failed, cannot continue' }
$tokAdmin = $respAdmin.data.token
$tokUserA = $respUserA.data.token
$tokUserB = $respUserB.data.token

try {
  # --- ms and timing ---
  $plain = Api 'me' @{} $tokUserA
  Check 'every response has numeric ms' ($plain.ok -and ($plain.ms -is [int] -or $plain.ms -is [long] -or $plain.ms -is [double]))
  Check 'no timing object without debug' ($null -eq $plain.timing)
  $timed = Api 'me' @{} $tokUserA -WithTiming
  $phases = @('auth', 'open', 'read', 'lock', 'handler', 'total')
  $timingProblem = Get-TimingProblem $timed $phases
  Check 'debug:true adds timing with auth, open, read, lock, handler, total' ($timingProblem -eq '') $timed $timingProblem
  if ($timed.timing) { Write-Host "      timing: $(ConvertTo-Json $timed.timing -Compress)" -ForegroundColor DarkGray }
  CheckError 'unknown action still carries an error' (Api 'noSuchAction') 'BAD_REQUEST'

  # --- echo of action and requestId (the helper rejects any response that does not match) ---
  $echoId = 'echo-' + [guid]::NewGuid().ToString('N')
  $echoRead = Api 'me' @{} $tokUserA $echoId
  Check 'read echoes its action and requestId' (($echoRead.action -ceq 'me') -and ($echoRead.requestId -ceq $echoId)) $echoRead "echoed action: $($echoRead.action); requestId echoed: $($null -ne $echoRead.requestId)"
  $echoUnknown = Api 'noSuchAction' @{} $tokUserA $echoId
  Check 'error responses echo too' (($echoUnknown.action -ceq 'noSuchAction') -and ($echoUnknown.requestId -ceq $echoId)) $echoUnknown
  $echoDenied = Api 'me' @{} 'not-a-token' $echoId
  Check 'UNAUTHORIZED responses echo too' (($echoDenied.error.code -eq 'UNAUTHORIZED') -and ($echoDenied.action -ceq 'me') -and ($echoDenied.requestId -ceq $echoId)) $echoDenied
  Check 'the helper rejects the old "pong" answer' (-not (Test-ResponseMatches ([pscustomobject]@{ ok = $true; data = 'pong' }) 'me' $echoId))
  Check 'the helper rejects another action' (-not (Test-ResponseMatches ([pscustomobject]@{ action = 'login'; requestId = $echoId }) 'me' $echoId))
  Check 'the helper rejects another requestId' (-not (Test-ResponseMatches ([pscustomobject]@{ action = 'me'; requestId = 'someone-else-0001' }) 'me' $echoId))
  Check 'the helper accepts a matching echo' (Test-ResponseMatches ([pscustomobject]@{ action = 'me'; requestId = $echoId }) 'me' $echoId)

  # --- test data: one row for A, one for B, both today ---
  $addA = Api 'addExpense' @{ date = $today; item = 't4-a'; price = 1.11; category = $ActiveCategory } $tokUserA
  $addB = Api 'addExpense' @{ date = $today; item = 't4-b'; price = 2.22; category = $ActiveCategory } $tokUserB
  Check 'setup: A and B each added a row' ($addA.ok -and $addB.ok) $addA

  # --- bootstrap ---
  $bootA = Api 'bootstrap' @{ month = $thisMonth } $tokUserA
  $meA = Api 'me' @{} $tokUserA
  $catsA = Api 'categories' @{} $tokUserA
  $listA = Api 'listExpenses' @{ month = $thisMonth } $tokUserA
  Check 'bootstrap ok' $bootA.ok $bootA
  Check 'bootstrap.me equals me' (Same $bootA.data.me $meA.data)
  Check 'bootstrap.categories equals categories' (Same $bootA.data.categories $catsA.data)
  Check 'bootstrap.expenses equals listExpenses for the month' (Same $bootA.data.expenses $listA.data)
  Check 'bootstrap contains A row' ((CountItem $bootA.data.expenses 't4-a') -eq 1)
  Check "member A bootstrap has no other user's rows" (@($bootA.data.expenses | Where-Object { $_.user -ne $UserA }).Count -eq 0)
  Check "member A bootstrap does not contain B's row" ((CountItem $bootA.data.expenses 't4-b') -eq 0)
  $bootB = Api 'bootstrap' @{ month = $thisMonth } $tokUserB
  Check "member B bootstrap has no other user's rows" (($bootB.ok) -and @($bootB.data.expenses | Where-Object { $_.user -ne $UserB }).Count -eq 0 -and ((CountItem $bootB.data.expenses 't4-a') -eq 0))
  $bootAdmin = Api 'bootstrap' @{ month = $thisMonth } $tokAdmin
  Check 'admin bootstrap sees both rows' (($bootAdmin.ok) -and ((CountItem $bootAdmin.data.expenses 't4-a') -eq 1) -and ((CountItem $bootAdmin.data.expenses 't4-b') -eq 1) -and $bootAdmin.data.me.role -eq 'admin')
  $bootAll = Api 'bootstrap' @{} $tokUserA
  $listAll = Api 'listExpenses' @{} $tokUserA
  $allProblem = if (-not $bootAll.ok) { "bootstrap failed: code=$($bootAll.error.code)" } elseif (-not $listAll.ok) { "listExpenses failed: code=$($listAll.error.code)" } else { Get-ListDifference $bootAll.data.expenses $listAll.data 'bootstrap' 'listExpenses' }
  Check 'bootstrap without month equals listExpenses without month' ($bootAll.ok -and $listAll.ok -and (Same $bootAll.data.expenses $listAll.data)) $null $allProblem
  CheckError 'bootstrap with a bad month' (Api 'bootstrap' @{ month = '2026-13' } $tokUserA) 'BAD_REQUEST'
  CheckError 'bootstrap without a token' (Api 'bootstrap' @{ month = $thisMonth }) 'UNAUTHORIZED'

  # --- idempotency: same requestId ---
  $sharedRequestId = 'req-' + [guid]::NewGuid().ToString('N')
  $idemPayload = @{ date = $today; item = 't4-idem'; price = 3.33; category = $ActiveCategory }
  $first = Api 'addExpense' $idemPayload $tokUserA $sharedRequestId
  $second = Api 'addExpense' $idemPayload $tokUserA $sharedRequestId
  $rowsAfterTwo = (Api 'listExpenses' @{ month = $thisMonth } $tokUserA).data
  Check 'same requestId sent twice: both ok' ($first.ok -and $second.ok) $second
  Check 'same requestId sent twice: identical response data' (Same $first.data $second.data)
  Check 'write and its replay both echo that requestId and action' (($first.requestId -ceq $sharedRequestId) -and ($second.requestId -ceq $sharedRequestId) -and ($first.action -ceq 'addExpense') -and ($second.action -ceq 'addExpense'))
  Check 'same requestId sent twice: exactly one row exists' ((CountItem $rowsAfterTwo 't4-idem') -eq 1)

  # --- a different requestId is a new request ---
  $third = Api 'addExpense' $idemPayload $tokUserA ('req-' + [guid]::NewGuid().ToString('N'))
  $rowsAfterThree = (Api 'listExpenses' @{ month = $thisMonth } $tokUserA).data
  Check 'different requestId: ok and a new id' ($third.ok -and $third.data.id -ne $first.data.id) $third
  Check 'different requestId: now two rows' ((CountItem $rowsAfterThree 't4-idem') -eq 2)

  # --- another user replaying A's requestId ---
  $replayByB = Api 'addExpense' @{ date = $today; item = 't4-b-replay'; price = 4.44; category = $ActiveCategory } $tokUserB $sharedRequestId
  Check "B replaying A's requestId is a normal request for B (not A's stored response)" ($replayByB.ok -and $replayByB.data.user -eq $UserB -and $replayByB.data.id -ne $first.data.id -and $replayByB.data.item -eq 't4-b-replay') $replayByB
  Check "A's row count is unchanged by B's call" ((CountItem ((Api 'listExpenses' @{ month = $thisMonth } $tokUserA).data) 't4-idem') -eq 2)

  # --- a replay is answered from the stored response, not re-executed ---
  $gone = Api 'deleteExpense' @{ id = $first.data.id } $tokUserA
  $replayAfterDelete = Api 'addExpense' $idemPayload $tokUserA $sharedRequestId
  Check 'replay after the row was deleted returns the stored response' ($gone.ok -and $replayAfterDelete.ok -and ($replayAfterDelete.data.id -eq $first.data.id))
  Check 'replay did not re-create the deleted row' (@((Api 'listExpenses' @{ month = $thisMonth } $tokUserA).data | Where-Object { $_.id -eq $first.data.id }).Count -eq 0)

  # --- requestId format ---
  $longRequestId = 'x' * 65
  foreach ($badRequestId in @('short', 'has space in it', $longRequestId, 'bad$chars$here')) {
    CheckError "invalid requestId '$($badRequestId.Substring(0, [Math]::Min(12, $badRequestId.Length)))' on a write" (Api 'addExpense' $idemPayload $tokUserA $badRequestId) 'BAD_REQUEST'
  }
  CheckError 'invalid requestId on a read' (Api 'me' @{} $tokUserA 'bad id!') 'BAD_REQUEST'
  Check 'valid requestId on a read is accepted' ((Api 'me' @{} $tokUserA 'read-request-0001').ok)
}
finally {
  # --- cleanup: fresh admin login (tokens above may be invalid), delete every "t4-" row ---
  $respCleanup = Api 'login' @{ user = $Admin; pin = $pinAdmin }
  Check 'cleanup: fresh admin login' $respCleanup.ok $respCleanup
  if ($respCleanup.ok) {
    Check 'cleanup: test expenses removed' ((Remove-TestRows $respCleanup.data.token) -eq 0)
  }
}

Write-Host ''
if ($script:fails -eq 0) { Write-Host 'ALL PASSED' -ForegroundColor Green }
else { Write-Host "$($script:fails) FAILED" -ForegroundColor Red; exit 1 }

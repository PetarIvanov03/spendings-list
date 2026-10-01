# Step 3 tests: summary, admin endpoints, changePin.
# Needs the admin, two active members and one active category.
# Usage:
#   $env:API_URL = '<web app url>'
#   .\test-step3.ps1 -Admin Petar -UserA Ivan -UserB Maria -ActiveCategory Food [-TestAddUser]
# PINs are prompted, never stored. Uses month 2099-01 so totals are exact.
# Temporarily changes the PINs of UserA and UserB and restores them at the end.
# Leaves behind: one inactive "t3-" category, and with -TestAddUser one inactive "t3-" user
# (there is no delete endpoint; remove the rows by hand in the Sheet if you like).
param(
  [Parameter(Mandatory)][string]$Admin,
  [Parameter(Mandatory)][string]$UserA,
  [Parameter(Mandatory)][string]$UserB,
  [Parameter(Mandatory)][string]$ActiveCategory,
  [switch]$TestAddUser
)

$API_URL = $env:API_URL
if (-not $API_URL) { throw 'Set $env:API_URL first' }

# Api helper, redirect handling, retries and echo check live in test-lib.ps1.
. "$PSScriptRoot\test-lib.ps1"
Invoke-WarmUp

$script:fails = 0
# Pass the response as $res on login checks: a FAIL then prints why (never the PIN or token).
function Check($name, $cond, $res = $null) {
  if ($cond) { Write-Host "PASS  $name" -ForegroundColor Green; return }
  Write-Host "FAIL  $name" -ForegroundColor Red
  $script:fails++
  if ($null -ne $res) {
    $role = $res.data.user.role
    Write-Host "      ok=$($res.ok) code=$($res.error.code) message=$($res.error.message) role=$role" -ForegroundColor Yellow
  }
}
function CheckError($name, $res, $code) {
  Check "$name (expected $code, got $($res.error.code))" (($res.ok -eq $false) -and ($res.error.code -eq $code))
}
function Near($a, $b) { [math]::Abs([double]$a - [double]$b) -lt 0.001 }
# Numeric check: on FAIL prints expected vs actual (a missing value shows as "(missing)").
function CheckNum($name, $actual, $expected) {
  $ok = ($null -ne $actual) -and (Near $actual $expected)
  Check $name $ok
  if (-not $ok) {
    $shown = if ($null -eq $actual) { '(missing)' } else { $actual }
    Write-Host "      expected=$expected actual=$shown" -ForegroundColor Yellow
  }
}
# Deletes every "t3-" expense in the test month. Prints id and error code for each failure.
# Returns the number of rows that could not be deleted.
function Remove-TestRows($token) {
  $list = Api 'listExpenses' @{ month = $month } $token
  if (-not $list.ok) {
    Write-Host "      cannot list test rows: code=$($list.error.code) message=$($list.error.message)" -ForegroundColor Yellow
    return 1
  }
  $failed = 0
  foreach ($x in @($list.data | Where-Object { $_.item -like 't3-*' })) {
    try { $d = Api 'deleteExpense' @{ id = $x.id } $token }
    catch { $d = [pscustomobject]@{ ok = $false; error = [pscustomobject]@{ code = 'TRANSPORT'; message = $_.Exception.Message } } }
    if (-not $d.ok) {
      $failed++
      Write-Host "      could not delete id=$($x.id) code=$($d.error.code) message=$($d.error.message)" -ForegroundColor Yellow
    }
  }
  return $failed
}
function CatTotal($sum, $cat) { ($sum.byCategory | Where-Object { $_.category -eq $cat }).total }
function UserTotal($sum, $user) { ($sum.byUser | Where-Object { $_.user -eq $user }).total }
function Pin($user) {
  $s = Read-Host "PIN for $user" -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$suffix = -join ((97..122) | Get-Random -Count 5 | ForEach-Object { [char]$_ })
$cat1 = "t3-cat-$suffix"
$cat2 = "t3-renamed-$suffix"
$month = '2099-01'
$tempPin = '4829'

# --- login ---
$pinAdmin = Pin $Admin
$pinA = Pin $UserA
$pinB = Pin $UserB
$respAdmin = Api 'login' @{ user = $Admin; pin = $pinAdmin }
$respA = Api 'login' @{ user = $UserA; pin = $pinA }
$respB = Api 'login' @{ user = $UserB; pin = $pinB }
Check 'login admin' ($respAdmin.ok -and $respAdmin.data.user.role -eq 'admin') $respAdmin
Check 'login A' ($respA.ok -and $respA.data.user.role -eq 'member') $respA
Check 'login B' ($respB.ok -and $respB.data.user.role -eq 'member') $respB
if (-not ($respAdmin.ok -and $respA.ok -and $respB.ok)) { throw 'Login failed, cannot continue' }
$tokAdmin = $respAdmin.data.token
$tokA = $respA.data.token
$tokB = $respB.data.token
$ids = @()

# Leftovers from earlier runs would skew the totals: remove them first.
Check 'start: leftover test rows removed' ((Remove-TestRows $tokAdmin) -eq 0)

try {
# --- member calling any admin action must be FORBIDDEN ---
# Payloads target a nonexistent user so nothing real changes if a check were ever missing.
$adminCalls = [ordered]@{
  adminSummary    = @{ month = $month }
  adminCategories = @{}
  addCategory     = @{ name = "t3-forbidden-$suffix"; color = '#d9ead3' }
  updateCategory  = @{ name = $ActiveCategory; color = '#d9ead3' }
  renameCategory  = @{ oldName = "t3-nope-$suffix"; newName = "t3-nope2-$suffix" }
  adminUsers      = @{}
  addUser         = @{ name = "t3-forbidden-$suffix"; pin = '1234' }
  setUserActive   = @{ name = "t3-nobody-$suffix"; active = $false }
  setPin          = @{ user = "t3-nobody-$suffix"; pin = '1234' }
}
foreach ($action in $adminCalls.Keys) {
  CheckError "member -> $action" (Api $action $adminCalls[$action] $tokA) 'FORBIDDEN'
  CheckError "no token -> $action" (Api $action $adminCalls[$action]) 'UNAUTHORIZED'
}

# --- admin: categories ---
$add = Api 'addCategory' @{ name = $cat1; color = '#d9ead3' } $tokAdmin
Check 'addCategory' ($add.ok -and $add.data.active -eq $true -and $add.data.order -gt 0)
CheckError 'addCategory duplicate' (Api 'addCategory' @{ name = $cat1; color = '#d9ead3' } $tokAdmin) 'CONFLICT'
CheckError 'addCategory bad color' (Api 'addCategory' @{ name = "t3-x-$suffix"; color = 'green' } $tokAdmin) 'BAD_REQUEST'
$ac = Api 'adminCategories' @{} $tokAdmin
Check 'adminCategories lists new one' (@($ac.data | Where-Object { $_.name -eq $cat1 }).Count -eq 1)
$mc = Api 'categories' @{} $tokA
Check 'member sees new active category' (@($mc.data | Where-Object { $_.name -eq $cat1 }).Count -eq 1)
$upd = Api 'updateCategory' @{ name = $cat1; color = '#fce5cd' } $tokAdmin
Check 'updateCategory color' ($upd.ok -and $upd.data.color -eq '#fce5cd')
CheckError 'updateCategory unknown' (Api 'updateCategory' @{ name = "t3-nope-$suffix"; color = '#fce5cd' } $tokAdmin) 'NOT_FOUND'
CheckError 'updateCategory nothing' (Api 'updateCategory' @{ name = $cat1 } $tokAdmin) 'BAD_REQUEST'

# --- summary totals ---
# A: 10.10 + 5.25 in cat1, 2.00 in ActiveCategory. B: 7.40 in cat1.
foreach ($e in @(
    @{ t = $tokA; p = 10.10; c = $cat1 }, @{ t = $tokA; p = 5.25; c = $cat1 },
    @{ t = $tokA; p = 2.00; c = $ActiveCategory }, @{ t = $tokB; p = 7.40; c = $cat1 })) {
  $r = Api 'addExpense' @{ date = "$month-15"; item = 't3-item'; price = $e.p; category = $e.c } $e.t
  if ($r.ok) { $ids += $r.data.id } else { Write-Host "setup add failed: $($r.error.message)" -ForegroundColor Red; $script:fails++ }
}
$sA = Api 'summary' @{ month = $month } $tokA
CheckNum 'summary A total 17.35' $sA.data.total 17.35
CheckNum 'summary A cat1 15.35' (CatTotal $sA.data $cat1) 15.35
CheckNum 'summary A other cat 2.00' (CatTotal $sA.data $ActiveCategory) 2.00
$sB = Api 'summary' @{ month = $month } $tokB
CheckNum 'summary B total 7.40 (own only)' $sB.data.total 7.40
CheckError 'summary bad month' (Api 'summary' @{ month = '2099-1' } $tokA) 'BAD_REQUEST'
$fam = Api 'adminSummary' @{ month = $month } $tokAdmin
CheckNum 'family total 24.75' $fam.data.total 24.75
CheckNum 'family cat1 22.75' (CatTotal $fam.data $cat1) 22.75
CheckNum 'family byUser A 17.35' (UserTotal $fam.data $UserA) 17.35
CheckNum 'family byUser B 7.40' (UserTotal $fam.data $UserB) 7.40
$one = Api 'adminSummary' @{ month = $month; user = $UserA } $tokAdmin
CheckNum 'adminSummary user filter total 17.35' $one.data.total 17.35
CheckNum 'adminSummary user filter byUser rows' (@($one.data.byUser).Count) 1
CheckError 'adminSummary unknown user' (Api 'adminSummary' @{ month = $month; user = "t3-nobody-$suffix" } $tokAdmin) 'NOT_FOUND'
$none = Api 'adminSummary' @{ month = $month; user = $Admin } $tokAdmin
CheckNum 'adminSummary known user without expenses: total 0' $none.data.total 0
CheckNum 'adminSummary known user without expenses: no categories' (@($none.data.byCategory).Count) 0
Write-Host '      (manual: legacy rows with empty user show as "(unassigned)" in family byUser only)'

# --- renameCategory ---
$ren = Api 'renameCategory' @{ oldName = $cat1; newName = $cat2 } $tokAdmin
Check 'renameCategory ok' ($ren.ok -and $ren.data.name -eq $cat2)
$rows = (Api 'listExpenses' @{ month = $month } $tokAdmin).data
CheckNum 'expense rows (A and B) now using new name' (@($rows | Where-Object { $_.category -eq $cat2 }).Count) 3
CheckNum 'expense rows still using old name' (@($rows | Where-Object { $_.category -eq $cat1 }).Count) 0
$cats = (Api 'adminCategories' @{} $tokAdmin).data
Check 'Categories sheet has new name only' ((@($cats | Where-Object { $_.name -eq $cat2 }).Count -eq 1) -and (@($cats | Where-Object { $_.name -eq $cat1 }).Count -eq 0))
CheckError 'rename to existing name' (Api 'renameCategory' @{ oldName = $cat2; newName = $ActiveCategory } $tokAdmin) 'CONFLICT'
CheckError 'rename unknown' (Api 'renameCategory' @{ oldName = $cat1; newName = "t3-z-$suffix" } $tokAdmin) 'NOT_FOUND'
$rows2 = (Api 'listExpenses' @{ month = $month } $tokAdmin).data
CheckNum 'failed rename changed nothing (rows with new name)' (@($rows2 | Where-Object { $_.category -eq $cat2 }).Count) 3

# --- inactive category still in summaries, but not allowed for new expenses ---
$off = Api 'updateCategory' @{ name = $cat2; active = $false } $tokAdmin
Check 'deactivate category' ($off.ok -and $off.data.active -eq $false)
$fam2 = Api 'adminSummary' @{ month = $month } $tokAdmin
CheckNum 'inactive category still in family summary' (CatTotal $fam2.data $cat2) 22.75
CheckError 'add expense to inactive category' (Api 'addExpense' @{ date = "$month-15"; item = 't3-x'; price = 1; category = $cat2 } $tokA) 'BAD_REQUEST'

# --- users: last admin ---
$ul = Api 'adminUsers' @{} $tokAdmin
Check 'adminUsers lists admin + members' ((@($ul.data | Where-Object { $_.name -eq $Admin -and $_.role -eq 'admin' }).Count -eq 1) -and (@($ul.data | Where-Object { $_.name -eq $UserA }).Count -eq 1))
CheckError 'deactivate last admin' (Api 'setUserActive' @{ name = $Admin; active = $false } $tokAdmin) 'CONFLICT'
Check 'admin token still valid after refused deactivation' ((Api 'me' @{} $tokAdmin).ok)
CheckError 'setUserActive unknown user' (Api 'setUserActive' @{ name = "t3-nobody-$suffix"; active = $false } $tokAdmin) 'NOT_FOUND'

# --- setPin invalidates old token ---
CheckError 'setPin 3 digits' (Api 'setPin' @{ user = $UserB; pin = '123' } $tokAdmin) 'BAD_REQUEST'
CheckError 'setPin admin with 4 digits' (Api 'setPin' @{ user = $Admin; pin = '1234' } $tokAdmin) 'BAD_REQUEST'
Check 'B token valid before setPin' ((Api 'me' @{} $tokB).ok)
Check 'setPin B' ((Api 'setPin' @{ user = $UserB; pin = $tempPin } $tokAdmin).ok)
CheckError 'old B token rejected after setPin' (Api 'me' @{} $tokB) 'UNAUTHORIZED'
CheckError 'old B PIN rejected' (Api 'login' @{ user = $UserB; pin = $pinB }) 'UNAUTHORIZED'
$respB2 = Api 'login' @{ user = $UserB; pin = $tempPin }
Check 'login with new B PIN' $respB2.ok $respB2
Check 'restore B PIN' ((Api 'setPin' @{ user = $UserB; pin = $pinB } $tokAdmin).ok)
$respB3 = Api 'login' @{ user = $UserB; pin = $pinB }
Check 'login with restored B PIN' $respB3.ok $respB3
$tokB = $respB3.data.token

# --- setUserActive false kills sessions ---
Check 'deactivate B' ((Api 'setUserActive' @{ name = $UserB; active = $false } $tokAdmin).ok)
CheckError 'deactivated B token rejected' (Api 'me' @{} $tokB) 'UNAUTHORIZED'
CheckError 'deactivated B cannot login' (Api 'login' @{ user = $UserB; pin = $pinB }) 'UNAUTHORIZED'
Check 'reactivate B' ((Api 'setUserActive' @{ name = $UserB; active = $true } $tokAdmin).ok)
$respB4 = Api 'login' @{ user = $UserB; pin = $pinB }
Check 'B can login again' $respB4.ok $respB4

# --- changePin (member, own PIN) ---
CheckError 'changePin wrong old PIN' (Api 'changePin' @{ oldPin = '0000'; newPin = $tempPin } $tokA) 'FORBIDDEN'
Check 'A token still valid after wrong oldPin' ((Api 'me' @{} $tokA).ok)
CheckError 'changePin bad new PIN' (Api 'changePin' @{ oldPin = $pinA; newPin = '12' } $tokA) 'BAD_REQUEST'
Check 'changePin ok' ((Api 'changePin' @{ oldPin = $pinA; newPin = $tempPin } $tokA).ok)
CheckError 'old A token rejected after changePin' (Api 'me' @{} $tokA) 'UNAUTHORIZED'
$respA2 = Api 'login' @{ user = $UserA; pin = $tempPin }
Check 'login with new A PIN' $respA2.ok $respA2
Check 'restore A PIN' ((Api 'changePin' @{ oldPin = $tempPin; newPin = $pinA } $respA2.data.token).ok)
$respA3 = Api 'login' @{ user = $UserA; pin = $pinA }
Check 'login with restored A PIN' $respA3.ok $respA3

# --- addUser (optional: leaves a deactivated user behind) ---
if ($TestAddUser) {
  $newUser = "t3-user-$suffix"
  $au = Api 'addUser' @{ name = $newUser; pin = '1357' } $tokAdmin
  Check 'addUser' ($au.ok -and $au.data.role -eq 'member' -and $au.data.active -eq $true)
  CheckError 'addUser duplicate' (Api 'addUser' @{ name = $newUser; pin = '1357' } $tokAdmin) 'CONFLICT'
  CheckError 'addUser bad PIN' (Api 'addUser' @{ name = "t3-user2-$suffix"; pin = '12345' } $tokAdmin) 'BAD_REQUEST'
  $rN = Api 'login' @{ user = $newUser; pin = '1357' }
  Check 'new user can login' $rN.ok $rN
  Check 'new user listed in loginOptions' ((Api 'loginOptions').data.users -contains $newUser)
  Check 'deactivate new user' ((Api 'setUserActive' @{ name = $newUser; active = $false } $tokAdmin).ok)
  Check 'deactivated user hidden from loginOptions' (-not ((Api 'loginOptions').data.users -contains $newUser))
}

}
finally {
  # --- cleanup: always runs, with a fresh admin login (earlier tokens may be invalidated) ---
  $respFinal = Api 'login' @{ user = $Admin; pin = $pinAdmin }
  Check 'cleanup: fresh admin login' $respFinal.ok $respFinal
  if ($respFinal.ok) {
    Check 'cleanup: test expenses removed' ((Remove-TestRows $respFinal.data.token) -eq 0)
  }
}

Write-Host ''
if ($script:fails -eq 0) { Write-Host 'ALL PASSED' -ForegroundColor Green }
else { Write-Host "$($script:fails) FAILED" -ForegroundColor Red; exit 1 }

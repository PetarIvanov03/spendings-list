# Step 2 tests. Needs two active members, one active and one inactive category.
# Usage:
#   $env:API_URL = '<web app url>'
#   .\test-step2.ps1 -UserA Ivan -UserB Maria -ActiveCategory Food -InactiveCategory Old
# PINs are prompted, never stored. Creates and deletes its own rows (item prefix "t2-").
param(
  [Parameter(Mandatory)][string]$UserA,
  [Parameter(Mandatory)][string]$UserB,
  [Parameter(Mandatory)][string]$ActiveCategory,
  [Parameter(Mandatory)][string]$InactiveCategory
)

$API_URL = $env:API_URL
if (-not $API_URL) { throw 'Set $env:API_URL first' }

function Api($action, $payload = @{}, $token = $null) {
  $body = @{ action = $action; token = $token; payload = $payload } | ConvertTo-Json -Depth 5 -Compress
  Invoke-RestMethod -Uri $API_URL -Method Post -ContentType 'text/plain;charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($body))
}

$script:fails = 0
function Check($name, $cond) {
  if ($cond) { Write-Host "PASS  $name" -ForegroundColor Green }
  else { Write-Host "FAIL  $name" -ForegroundColor Red; $script:fails++ }
}
function CheckError($name, $res, $code) {
  Check "$name (expected $code, got $($res.error.code))" (($res.ok -eq $false) -and ($res.error.code -eq $code))
}
function Pin($user) {
  $s = Read-Host "PIN for $user" -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$today = Get-Date -Format 'yyyy-MM-dd'
$month = Get-Date -Format 'yyyy-MM'

# --- login ---
$a = Api 'login' @{ user = $UserA; pin = (Pin $UserA) }
$b = Api 'login' @{ user = $UserB; pin = (Pin $UserB) }
Check 'login A' $a.ok
Check 'login B' $b.ok
if (-not ($a.ok -and $b.ok)) { throw 'Login failed, cannot continue' }
$tA = $a.data.token
$tB = $b.data.token

# --- categories ---
$c = Api 'categories' @{} $tA
Check 'categories ok' $c.ok
Check 'categories contains active one' (@($c.data | Where-Object { $_.name -eq $ActiveCategory }).Count -eq 1)
Check 'categories hides inactive one' (@($c.data | Where-Object { $_.name -eq $InactiveCategory }).Count -eq 0)
CheckError 'categories without token' (Api 'categories') 'UNAUTHORIZED'

# --- add ---
$add = Api 'addExpense' @{ date = $today; item = 't2-coffee'; price = 3.5; category = $ActiveCategory } $tA
Check 'add ok' $add.ok
Check 'add returns 8-char id' ($add.data.id.Length -eq 8)
Check 'add stores user = A' ($add.data.user -eq $UserA)
$id = $add.data.id

$inj = Api 'addExpense' @{ date = $today; item = '=1+1'; price = 1; category = $ActiveCategory } $tA
Check 'formula-like item accepted as text' ($inj.ok -and $inj.data.item -eq '=1+1')
Write-Host '      (check in the Sheet: the cell shows =1+1 as text, not 2)'

# --- list ---
$la = Api 'listExpenses' @{ month = $month } $tA
Check 'A sees own row' (@($la.data | Where-Object { $_.id -eq $id }).Count -eq 1)
Check 'A list has only A rows' (@($la.data | Where-Object { $_.user -ne $UserA }).Count -eq 0)
$lb = Api 'listExpenses' @{ month = $month } $tB
Check 'B does NOT see A row' (@($lb.data | Where-Object { $_.id -eq $id }).Count -eq 0)
Check 'B list has only B rows' (@($lb.data | Where-Object { $_.user -ne $UserB }).Count -eq 0)
$lbf = Api 'listExpenses' @{ month = $month; user = $UserA } $tB
Check 'B cannot widen list with user filter' (@($lbf.data | Where-Object { $_.user -ne $UserB }).Count -eq 0)
CheckError 'bad month' (Api 'listExpenses' @{ month = '2026-13' } $tA) 'BAD_REQUEST'
$l1 = Api 'listExpenses' @{ limit = 1 } $tA
Check 'limit 1' (@($l1.data).Count -eq 1)

# --- update ---
$up = Api 'updateExpense' @{ id = $id; price = 4.2; item = 't2-coffee2' } $tA
Check 'A updates own row' ($up.ok -and $up.data.price -eq 4.2 -and $up.data.item -eq 't2-coffee2')
CheckError 'B updates A row' (Api 'updateExpense' @{ id = $id; price = 9 } $tB) 'FORBIDDEN'
CheckError 'B deletes A row' (Api 'deleteExpense' @{ id = $id } $tB) 'FORBIDDEN'
$la2 = Api 'listExpenses' @{ month = $month } $tA
Check 'A row untouched by B attempts' (@($la2.data | Where-Object { $_.id -eq $id -and $_.price -eq 4.2 }).Count -eq 1)
CheckError 'update nothing' (Api 'updateExpense' @{ id = $id } $tA) 'BAD_REQUEST'
CheckError 'update unknown id' (Api 'updateExpense' @{ id = 'nope0000'; price = 1 } $tA) 'NOT_FOUND'

# --- validation ---
foreach ($p in @(0, -1, 1.234, 100000, 'abc')) {
  CheckError "invalid price $p" (Api 'addExpense' @{ date = $today; item = 't2-bad'; price = $p; category = $ActiveCategory } $tA) 'BAD_REQUEST'
}
CheckError 'inactive category on add' (Api 'addExpense' @{ date = $today; item = 't2-bad'; price = 1; category = $InactiveCategory } $tA) 'BAD_REQUEST'
CheckError 'inactive category on update' (Api 'updateExpense' @{ id = $id; category = $InactiveCategory } $tA) 'BAD_REQUEST'
CheckError 'unknown category' (Api 'addExpense' @{ date = $today; item = 't2-bad'; price = 1; category = 'no-such-cat' } $tA) 'BAD_REQUEST'
CheckError 'impossible date' (Api 'addExpense' @{ date = '2026-02-30'; item = 't2-bad'; price = 1; category = $ActiveCategory } $tA) 'BAD_REQUEST'
CheckError 'empty item' (Api 'addExpense' @{ date = $today; item = '   '; price = 1; category = $ActiveCategory } $tA) 'BAD_REQUEST'
CheckError 'item over 100 chars' (Api 'addExpense' @{ date = $today; item = ('x' * 101); price = 1; category = $ActiveCategory } $tA) 'BAD_REQUEST'

# --- delete + cleanup ---
$del = Api 'deleteExpense' @{ id = $id } $tA
Check 'A deletes own row' ($del.ok -and $del.data.id -eq $id)
CheckError 'update after delete' (Api 'updateExpense' @{ id = $id; price = 1 } $tA) 'NOT_FOUND'
$del2 = Api 'deleteExpense' @{ id = $inj.data.id } $tA
Check 'cleanup formula row' $del2.ok

Write-Host ''
if ($script:fails -eq 0) { Write-Host 'ALL PASSED' -ForegroundColor Green }
else { Write-Host "$($script:fails) FAILED" -ForegroundColor Red; exit 1 }

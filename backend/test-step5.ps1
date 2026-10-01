# Step 5 tests: login by typed name (case, spaces, canonical name), lockout over name variants,
# identical errors for wrong name and wrong PIN, addUser name conflicts.
# Needs the admin and one active member. Uses backend/test-lib.ps1.
# Usage:
#   $env:API_URL = '<web app url>'
#   .\test-step5.ps1 -Admin Petar -User Dobrinka [-TestAddUser]
# PINs are prompted, never stored or printed. The member's lockout counter is cleared at the end
# (in finally, by the admin calling setPin with the member's own PIN), also after an error.
# -TestAddUser also creates one throwaway "t5-" user and deactivates it again (there is no
# delete endpoint, so an inactive row stays in the Users sheet).
param(
  [Parameter(Mandatory)][string]$Admin,
  [Parameter(Mandatory)][string]$User,
  [switch]$TestAddUser
)

if (-not $env:API_URL) { throw 'Set $env:API_URL first' }
. "$PSScriptRoot\test-lib.ps1"
Invoke-WarmUp

$script:fails = 0
function Check($name, $cond, $detail = '') {
  if ($cond) { Write-Host "PASS  $name" -ForegroundColor Green; return }
  Write-Host "FAIL  $name" -ForegroundColor Red
  $script:fails++
  if ($detail) { Write-Host "      $detail" -ForegroundColor Yellow }
}
# Describes a response without ever printing a token or a PIN.
function Describe($res) {
  $hasToken = ($null -ne $res.data) -and ($null -ne $res.data.token)
  "ok=$($res.ok) code=$($res.error.code) message=$($res.error.message) tokenPresent=$hasToken"
}
function CheckError($name, $res, $code) {
  Check "$name (expected $code, got $($res.error.code))" (($res.ok -eq $false) -and ($res.error.code -eq $code)) (Describe $res)
}
function Pin($who) {
  $secure = Read-Host "PIN for $who" -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

$pinAdmin = Pin $Admin
$pinMember = Pin $User
$wrongPin = if ($pinMember -eq '0000') { '1111' } else { '0000' }
$suffix = -join ((97..122) | Get-Random -Count 5 | ForEach-Object { [char]$_ })
$throwaway = "t5-user-$suffix"

# Spellings of the member's name a person might type.
$spellExact = $User
$spellLower = $User.ToLowerInvariant()
$spellUpper = $User.ToUpperInvariant()
$spellPadded = "  $User  "
$spellMixed = ($User.ToCharArray() | ForEach-Object -Begin { $flip = $false } -Process { if ($flip) { "$_".ToUpperInvariant() } else { "$_".ToLowerInvariant() }; $flip = -not $flip }) -join ''

$respAdmin = Api 'login' @{ user = $Admin; pin = $pinAdmin }
Check 'login admin' ($respAdmin.ok -and $respAdmin.data.token -and $respAdmin.data.user.role -eq 'admin') (Describe $respAdmin)
if (-not ($respAdmin.ok -and $respAdmin.data.token)) {
  Write-Host 'ABORT: the admin login did not return a token; the rest cannot run.' -ForegroundColor Red
  exit 1
}
$tokAdmin = $respAdmin.data.token

try {
  # Start from a clean counter: setPin clears the member's lockout (and ends their old sessions).
  $reset = Api 'setPin' @{ user = $User; pin = $pinMember } $tokAdmin
  Check 'setup: member lockout counter cleared (admin setPin with the same PIN)' $reset.ok (Describe $reset)

  # --- different spellings log in, canonical name comes back ---
  foreach ($spelling in @(
      @{ label = 'exact'; typed = $spellExact }, @{ label = 'lower case'; typed = $spellLower },
      @{ label = 'UPPER CASE'; typed = $spellUpper }, @{ label = 'padded with spaces'; typed = $spellPadded },
      @{ label = 'MiXeD case'; typed = $spellMixed })) {
    $variantLogin = Api 'login' @{ user = $spelling.typed; pin = $pinMember }
    Check "login with $($spelling.label) name" ($variantLogin.ok -and $variantLogin.data.token) (Describe $variantLogin)
    Check "  ...returns the canonical name ($($spelling.label))" ($variantLogin.ok -and ($variantLogin.data.user.name -ceq $User) -and ($variantLogin.data.user.role -eq 'member')) $null
  }
  $meResp = Api 'me' @{} ((Api 'login' @{ user = $spellUpper; pin = $pinMember }).data.token)
  Check 'the token made from an UPPER CASE login belongs to the canonical user' ($meResp.ok -and ($meResp.data.name -ceq $User)) (Describe $meResp)

  # --- wrong name and wrong PIN look the same ---
  $unknownName = "t5-nobody-$suffix"
  $wrongPinResp = Api 'login' @{ user = $spellExact; pin = $wrongPin }
  $wrongNameResp = Api 'login' @{ user = $unknownName; pin = $pinMember }
  CheckError 'wrong PIN' $wrongPinResp 'UNAUTHORIZED'
  CheckError 'unknown name' $wrongNameResp 'UNAUTHORIZED'
  Check 'wrong name and wrong PIN return the same message' ($wrongPinResp.error.message -ceq $wrongNameResp.error.message) "wrong PIN: '$($wrongPinResp.error.message)' / unknown name: '$($wrongNameResp.error.message)'"

  # --- lockout: 5 wrong PINs over case variants of one member, the 6th is LOCKED ---
  # (one wrong PIN was already used above, so four more make five)
  foreach ($variant in @($spellLower, $spellUpper, $spellPadded, $spellMixed)) {
    CheckError "wrong PIN with '$($variant.Trim())' (counts towards the same counter)" (Api 'login' @{ user = $variant; pin = $wrongPin }) 'UNAUTHORIZED'
  }
  CheckError '6th wrong attempt, another spelling' (Api 'login' @{ user = $spellExact; pin = $wrongPin }) 'LOCKED'
  CheckError 'the RIGHT PIN is refused while locked (exact name)' (Api 'login' @{ user = $spellExact; pin = $pinMember }) 'LOCKED'
  CheckError 'the RIGHT PIN is refused while locked (UPPER CASE name)' (Api 'login' @{ user = $spellUpper; pin = $pinMember }) 'LOCKED'
  CheckError 'the RIGHT PIN is refused while locked (padded name)' (Api 'login' @{ user = $spellPadded; pin = $pinMember }) 'LOCKED'
  $adminStill = Api 'login' @{ user = $Admin; pin = $pinAdmin }
  Check 'the admin is not affected by the member lockout' ($adminStill.ok -and $adminStill.data.token) (Describe $adminStill)

  # --- addUser: a case-variant of an existing name is a CONFLICT ---
  foreach ($variant in @($spellLower, $spellUpper, $spellPadded)) {
    CheckError "addUser with a variant of an existing name ('$($variant.Trim())')" (Api 'addUser' @{ name = $variant; pin = '1357' } $tokAdmin) 'CONFLICT'
  }
  CheckError 'addUser with the exact existing name' (Api 'addUser' @{ name = $spellExact; pin = '1357' } $tokAdmin) 'CONFLICT'

  if ($TestAddUser) {
    $added = Api 'addUser' @{ name = $throwaway; pin = '1357' } $tokAdmin
    Check 'addUser with a new throwaway name' ($added.ok -and $added.data.role -eq 'member') (Describe $added)
    CheckError 'addUser with an UPPER CASE variant of the throwaway name' (Api 'addUser' @{ name = $throwaway.ToUpperInvariant(); pin = '1357' } $tokAdmin) 'CONFLICT'
    $throwawayLogin = Api 'login' @{ user = "  $($throwaway.ToUpperInvariant())  "; pin = '1357' }
    Check 'the throwaway user logs in with a variant and gets the canonical name' ($throwawayLogin.ok -and ($throwawayLogin.data.user.name -ceq $throwaway)) (Describe $throwawayLogin)
  }
}
finally {
  # --- cleanup: fresh admin login, clear the member's lockout, deactivate the throwaway user ---
  $respCleanup = Api 'login' @{ user = $Admin; pin = $pinAdmin }
  Check 'cleanup: fresh admin login' ($respCleanup.ok -and $respCleanup.data.token) (Describe $respCleanup)
  if ($respCleanup.ok -and $respCleanup.data.token) {
    $tokCleanup = $respCleanup.data.token
    $cleared = Api 'setPin' @{ user = $User; pin = $pinMember } $tokCleanup
    Check 'cleanup: member lockout cleared (setPin with the member PIN)' $cleared.ok (Describe $cleared)
    Check 'cleanup: member can log in again' ((Api 'login' @{ user = $spellExact; pin = $pinMember }).ok)
    if ($TestAddUser) {
      $off = Api 'setUserActive' @{ name = $throwaway; active = $false } $tokCleanup
      Check 'cleanup: throwaway user deactivated' ($off.ok -or $off.error.code -eq 'NOT_FOUND') (Describe $off)
    }
  }
}

Write-Host ''
if ($script:fails -eq 0) { Write-Host 'ALL PASSED' -ForegroundColor Green }
else { Write-Host "$($script:fails) FAILED" -ForegroundColor Red; exit 1 }

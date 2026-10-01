// Login, lockout, PIN hashing, token creation.

var LOCKOUT_MAX_ATTEMPTS = 5; // per real user, per 15 minutes
var LOCKOUT_WINDOW_SECONDS = 15 * 60;
var UNKNOWN_NAME_MAX_ATTEMPTS = 20; // ONE shared bucket for every name that matches no user
var UNKNOWN_NAME_LOCKOUT_KEY = 'lockout-unknown-names'; // no colon: cannot collide with 'lockout:<name>'

function hashPin(pin, salt) {
  return sha256Hex(salt + pin);
}

// ---- Typed names ----
// People type their name at login. It is trimmed, inner whitespace is collapsed, it is put
// in Unicode NFC form and compared case-insensitively (Latin and Cyrillic). The canonical
// spelling from the Users sheet is what goes into the token and the response.

function normalizeName(value) {
  var text = value === undefined || value === null ? '' : String(value);
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function nameKey(value) {
  return normalizeName(value).toLowerCase();
}

// Returns { name, active, role } for the user whose name matches the typed one, or null.
function findUserByTypedName(typed) {
  var key = nameKey(typed);
  var values = cachedSheetValues('Users');
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] !== '' && nameKey(values[i][0]) === key) {
      return { name: values[i][0], active: values[i][1], role: values[i][2] };
    }
  }
  return null;
}

// ---- Lockout counters (script cache) ----
// Real users: key from the normalized name, so "Petar", "petar" and " PETAR " share one counter.

function lockoutKey(userName) {
  return 'lockout:' + nameKey(userName);
}

function isLockedOut(key, maxAttempts) {
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get(key) || '0');
  return count >= maxAttempts;
}

function recordFailedAttempt(key) {
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get(key) || '0') + 1;
  cache.put(key, String(count), LOCKOUT_WINDOW_SECONDS);
}

function clearFailedAttempts(userName) {
  CacheService.getScriptCache().remove(lockoutKey(userName));
}

function loginOptions() {
  // Deprecated: the new frontend asks for a typed name. Removed once it is live.
  return { users: listActiveUserNames() };
}

function login(payload) {
  var typed = normalizeName(payload.user);
  var pin = payload.pin;
  if (!typed || !pin) {
    throw new ApiError('BAD_REQUEST', 'user and pin are required');
  }

  var user = findUserByTypedName(typed);

  // A real user has their own counter (5 / 15 min). Names that match nobody share one bucket
  // (20 / 15 min), so random names cannot fill the cache, and never block a real user.
  var key = user ? lockoutKey(user.name) : UNKNOWN_NAME_LOCKOUT_KEY;
  var maxAttempts = user ? LOCKOUT_MAX_ATTEMPTS : UNKNOWN_NAME_MAX_ATTEMPTS;
  if (isLockedOut(key, maxAttempts)) {
    throw new ApiError('LOCKED', 'Too many attempts, try again later');
  }

  var salt = getProp('PIN_SALT');
  var storedHash = user ? getProp('pin:' + user.name) : null;

  // Wrong name and wrong PIN: the same code and the same message.
  var badCredentials = !user || !user.active || !storedHash || hashPin(String(pin), salt) !== storedHash;
  if (badCredentials) {
    recordFailedAttempt(key);
    throw new ApiError('UNAUTHORIZED', 'Invalid name or PIN');
  }

  clearFailedAttempts(user.name);

  var tokenVersion = Number(getProp('tv:' + user.name) || '0');
  var exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  var payloadB64 = base64UrlEncode(JSON.stringify({ u: user.name, exp: exp, v: tokenVersion }));
  var token = payloadB64 + '.' + hmacHex(payloadB64, getProp('TOKEN_SECRET'));

  return { token: token, expiresAt: exp, user: { name: user.name, role: user.role } };
}

// Wrong oldPin is FORBIDDEN, not UNAUTHORIZED: the frontend logs out on UNAUTHORIZED.
// Success bumps tokenVersion, so the caller must log in again.
function changePin(payload, user) {
  var newPin = validatePin(payload.newPin, user.role);
  if (typeof payload.oldPin !== 'string' || !payload.oldPin) {
    throw new ApiError('BAD_REQUEST', 'oldPin is required');
  }
  if (isLockedOut(lockoutKey(user.name), LOCKOUT_MAX_ATTEMPTS)) {
    throw new ApiError('LOCKED', 'Too many attempts, try again later');
  }

  var storedHash = getProp('pin:' + user.name);
  if (!storedHash || hashPin(payload.oldPin, getProp('PIN_SALT')) !== storedHash) {
    recordFailedAttempt(lockoutKey(user.name));
    throw new ApiError('FORBIDDEN', 'Wrong PIN');
  }

  clearFailedAttempts(user.name);
  withLock(function () {
    setPinForUser(user.name, newPin);
    invalidateSheetCaches();
  });
  return {};
}

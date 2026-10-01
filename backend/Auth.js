// Login, lockout, PIN hashing, token creation.

var LOCKOUT_MAX_ATTEMPTS = 5;
var LOCKOUT_WINDOW_SECONDS = 15 * 60;

function hashPin(pin, salt) {
  return sha256Hex(salt + pin);
}

function lockoutKey(userName) {
  return 'lockout:' + userName;
}

function isLockedOut(userName) {
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get(lockoutKey(userName)) || '0');
  return count >= LOCKOUT_MAX_ATTEMPTS;
}

function recordFailedAttempt(userName) {
  var cache = CacheService.getScriptCache();
  var key = lockoutKey(userName);
  var count = Number(cache.get(key) || '0') + 1;
  cache.put(key, String(count), LOCKOUT_WINDOW_SECONDS);
}

function clearFailedAttempts(userName) {
  CacheService.getScriptCache().remove(lockoutKey(userName));
}

function loginOptions() {
  return { users: listActiveUserNames() };
}

function login(payload) {
  var userName = payload.user;
  var pin = payload.pin;
  if (!userName || !pin) {
    throw new ApiError('BAD_REQUEST', 'user and pin are required');
  }

  if (isLockedOut(userName)) {
    throw new ApiError('LOCKED', 'Too many attempts, try again later');
  }

  var user = findUser(userName);
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('PIN_SALT');
  var storedHash = props.getProperty('pin:' + userName);

  var badCredentials = !user || !user.active || !storedHash || hashPin(String(pin), salt) !== storedHash;
  if (badCredentials) {
    recordFailedAttempt(userName);
    throw new ApiError('UNAUTHORIZED', 'Invalid name or PIN');
  }

  clearFailedAttempts(userName);

  var tokenVersion = Number(props.getProperty('tv:' + userName) || '0');
  var exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  var payloadB64 = base64UrlEncode(JSON.stringify({ u: userName, exp: exp, v: tokenVersion }));
  var token = payloadB64 + '.' + hmacHex(payloadB64, props.getProperty('TOKEN_SECRET'));

  return { token: token, expiresAt: exp, user: { name: user.name, role: user.role } };
}

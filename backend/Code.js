// Entry point: request dispatch, response helpers, shared auth helpers.

var TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

function ApiError(code, message) {
  this.code = code;
  this.message = message;
}
ApiError.prototype = Object.create(Error.prototype);

function jsonOk(data) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Per-request state and timing ----
// Apps Script re-evaluates globals for every execution, so this is per request.

var REQ = { prof: {}, stack: [], ss: null, props: null, lockHeld: false };

// Runs fn and adds its own time (minus nested timed() calls) to REQ.prof[phase].
// Phases: auth, open (opening the spreadsheet), read (sheet/cache/property reads), lock, handler.
function timed(phase, fn) {
  var start = Date.now();
  var frame = { child: 0 };
  REQ.stack.push(frame);
  try {
    return fn();
  } finally {
    REQ.stack.pop();
    var elapsed = Date.now() - start;
    REQ.prof[phase] = (REQ.prof[phase] || 0) + elapsed - frame.child;
    if (REQ.stack.length) REQ.stack[REQ.stack.length - 1].child += elapsed;
  }
}

// The spreadsheet is opened lazily and at most once per request.
function getSpreadsheet() {
  if (!REQ.ss) {
    REQ.ss = timed('open', function () {
      return SpreadsheetApp.getActiveSpreadsheet();
    });
  }
  return REQ.ss;
}

function readValues(range) {
  return timed('read', function () {
    return range.getValues();
  });
}

function readAll(sheet) {
  return timed('read', function () {
    return sheet.getDataRange().getValues();
  });
}

// ---- Script Properties: read once per request ----

function getProps() {
  if (!REQ.props) {
    REQ.props = timed('read', function () {
      return PropertiesService.getScriptProperties().getProperties();
    });
  }
  return REQ.props;
}

function getProp(key) {
  var value = getProps()[key];
  return value === undefined ? null : value;
}

function setProp(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
  getProps()[key] = value;
}

// ---- Users / Categories rows: script cache (10 min) ----
// Cleared explicitly by every API write that changes these sheets (invalidateSheetCaches,
// called inside the write's lock) and by onEdit when someone edits them by hand.

var SHEET_CACHE_TTL_SECONDS = 600;
var CACHED_SHEETS = ['Users', 'Categories'];

function cachedSheetValues(name) {
  var cache = CacheService.getScriptCache();
  var key = 'sheet:' + name;
  var hit = timed('read', function () {
    return cache.get(key);
  });
  if (hit) return JSON.parse(hit);

  var values = readAll(getSpreadsheet().getSheetByName(name));
  try {
    cache.put(key, JSON.stringify(values), SHEET_CACHE_TTL_SECONDS);
  } catch (err) {
    // Too big for the cache: just read the sheet next time.
  }
  return values;
}

function invalidateSheetCaches() {
  CacheService.getScriptCache().removeAll(
    CACHED_SHEETS.map(function (name) {
      return 'sheet:' + name;
    })
  );
}

// Simple trigger: a manual edit of Users or Categories (role, active, order...) takes effect at once.
function onEdit(e) {
  if (!e || !e.range) return;
  if (CACHED_SHEETS.indexOf(e.range.getSheet().getName()) >= 0) invalidateSheetCaches();
}

// ---- Responses ----

// Builds the HTTP response. "ms" is always added; "timing" only for debug requests.
function respond(result, startedAt, debug) {
  var total = Date.now() - startedAt;
  result.ms = total;
  if (debug) {
    var p = REQ.prof;
    result.timing = {
      auth: p.auth || 0,
      open: p.open || 0,
      read: p.read || 0,
      lock: p.lock || 0,
      handler: p.handler || 0,
      total: total,
    };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function errorBody(code, message) {
  return { ok: false, error: { code: code, message: message } };
}

// Actions that don't require a token.
var PUBLIC_ACTIONS = { loginOptions: true, login: true };

var ACTIONS = {
  loginOptions: function () {
    return loginOptions();
  },
  login: function (payload) {
    return login(payload);
  },
  me: function (payload, user) {
    return { name: user.name, role: user.role };
  },
  bootstrap: function (payload, user) {
    return bootstrap(payload, user);
  },
  categories: function () {
    return categories();
  },
  addExpense: function (payload, user) {
    return addExpense(payload, user);
  },
  listExpenses: function (payload, user) {
    return listExpenses(payload, user);
  },
  updateExpense: function (payload, user) {
    return updateExpense(payload, user);
  },
  deleteExpense: function (payload, user) {
    return deleteExpense(payload, user);
  },
  summary: function (payload, user) {
    return summary(payload, user);
  },
  changePin: function (payload, user) {
    return changePin(payload, user);
  },
  adminSummary: function (payload) {
    return adminSummary(payload);
  },
  adminCategories: function () {
    return adminCategories();
  },
  addCategory: function (payload) {
    return addCategory(payload);
  },
  updateCategory: function (payload) {
    return updateCategory(payload);
  },
  renameCategory: function (payload) {
    return renameCategory(payload);
  },
  adminUsers: function () {
    return adminUsers();
  },
  addUser: function (payload) {
    return addUser(payload);
  },
  setUserActive: function (payload) {
    return setUserActive(payload);
  },
  setPin: function (payload) {
    return setPin(payload);
  },
};

// Actions that require the admin role (checked server-side via requireAdmin).
var ADMIN_ACTIONS = {
  adminSummary: true,
  adminCategories: true,
  addCategory: true,
  updateCategory: true,
  renameCategory: true,
  adminUsers: true,
  addUser: true,
  setUserActive: true,
  setPin: true,
};

// Actions that change data. They run under the script lock and support requestId.
var MUTATING_ACTIONS = {
  addExpense: true,
  updateExpense: true,
  deleteExpense: true,
  changePin: true,
  addCategory: true,
  updateCategory: true,
  renameCategory: true,
  addUser: true,
  setUserActive: true,
  setPin: true,
};

// Runs fn under the script lock (all sheet writes go through this). Re-entrant within one
// request: doPost already holds the lock for mutating actions, so the handlers' own
// withLock calls just run fn.
function withLock(fn) {
  if (REQ.lockHeld) return fn();
  var lock = LockService.getScriptLock();
  try {
    timed('lock', function () {
      lock.waitLock(10000);
    });
  } catch (err) {
    throw new ApiError('SERVER_ERROR', 'Server busy, try again');
  }
  REQ.lockHeld = true;
  try {
    return fn();
  } finally {
    REQ.lockHeld = false;
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// ---- Idempotency (requestId) ----
// A client that did not get a response may send the same mutating request again with the
// same requestId. The first successful response is kept for 30 minutes per user + requestId
// and replayed instead of executing the action twice.

var REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
var IDEMPOTENCY_TTL_SECONDS = 30 * 60;
var IDEMPOTENCY_MAX_CHARS = 90000; // CacheService values are limited to 100 KB

function readRequestId(body) {
  if (body.requestId === undefined || body.requestId === null) return null;
  if (typeof body.requestId !== 'string' || !REQUEST_ID_PATTERN.test(body.requestId)) {
    throw new ApiError('BAD_REQUEST', 'requestId must be 8-64 characters: A-Z a-z 0-9 _ -');
  }
  return body.requestId;
}

// Executes a mutating handler under the lock. With a requestId, the stored response is
// looked up and saved inside the same lock, so two identical requests cannot both run.
// Returns { replay: <stored response object> } or { data: <handler result> }.
function runMutation(handler, payload, user, requestId) {
  var replay = null;
  var data = withLock(function () {
    var cache = CacheService.getScriptCache();
    var key = requestId ? 'req:' + user.name + ':' + requestId : null;
    if (key) {
      var stored = timed('read', function () {
        return cache.get(key);
      });
      if (stored) {
        replay = JSON.parse(stored);
        return null;
      }
    }
    var result = timed('handler', function () {
      return handler(payload, user);
    });
    if (key) {
      var json = JSON.stringify({ ok: true, data: result });
      if (json.length <= IDEMPOTENCY_MAX_CHARS) cache.put(key, json, IDEMPOTENCY_TTL_SECONDS);
    }
    return result;
  });
  return replay ? { replay: replay } : { data: data };
}

function doGet() {
  return jsonOk('pong');
}

function doPost(e) {
  var startedAt = Date.now();
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond(errorBody('BAD_REQUEST', 'Invalid JSON body'), startedAt, false);
  }
  var debug = body.debug === true;

  var action = body.action;
  var handler = ACTIONS[action];
  if (!handler) {
    return respond(errorBody('BAD_REQUEST', 'Unknown action: ' + action), startedAt, debug);
  }

  try {
    var requestId = readRequestId(body);
    var user = null;
    if (!PUBLIC_ACTIONS[action]) {
      user = timed('auth', function () {
        return ADMIN_ACTIONS[action] ? requireAdmin(body.token) : requireUser(body.token);
      });
    }
    var payload = body.payload || {};

    if (MUTATING_ACTIONS[action]) {
      var outcome = runMutation(handler, payload, user, requestId);
      return respond(outcome.replay || { ok: true, data: outcome.data }, startedAt, debug);
    }
    var data = timed('handler', function () {
      return handler(payload, user);
    });
    return respond({ ok: true, data: data }, startedAt, debug);
  } catch (err) {
    if (err instanceof ApiError) {
      return respond(errorBody(err.code, err.message), startedAt, debug);
    }
    return respond(errorBody('SERVER_ERROR', err.message || String(err)), startedAt, debug);
  }
}

// ---- Users sheet helpers ----

// For writes (fresh read of this sheet). Reads go through cachedSheetValues('Users').
function getUsersSheet() {
  return getSpreadsheet().getSheetByName('Users');
}

// Returns { name, active, role } or null.
function findUser(name) {
  var values = cachedSheetValues('Users'); // header + rows
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === name) {
      return { name: values[i][0], active: values[i][1], role: values[i][2] };
    }
  }
  return null;
}

function listActiveUserNames() {
  var values = cachedSheetValues('Users');
  var names = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i][1] === true) {
      names.push(values[i][0]);
    }
  }
  return names;
}

// ---- Auth: token verification ----

function requireUser(token) {
  if (!token) {
    throw new ApiError('UNAUTHORIZED', 'Missing token');
  }

  var parts = token.split('.');
  if (parts.length !== 2) {
    throw new ApiError('UNAUTHORIZED', 'Invalid token');
  }
  var payloadB64 = parts[0];
  var signature = parts[1];

  var expectedSignature = hmacHex(payloadB64, getProp('TOKEN_SECRET'));
  if (expectedSignature !== signature) {
    throw new ApiError('UNAUTHORIZED', 'Invalid token');
  }

  var payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch (err) {
    throw new ApiError('UNAUTHORIZED', 'Invalid token');
  }

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new ApiError('UNAUTHORIZED', 'Token expired');
  }

  var user = findUser(payload.u);
  if (!user || !user.active) {
    throw new ApiError('UNAUTHORIZED', 'Invalid token');
  }

  var currentVersion = Number(getProp('tv:' + user.name) || '0');
  if (payload.v !== currentVersion) {
    throw new ApiError('UNAUTHORIZED', 'Invalid token');
  }

  return user;
}

function requireAdmin(token) {
  var user = requireUser(token);
  if (user.role !== 'admin') {
    throw new ApiError('FORBIDDEN', 'Admin only');
  }
  return user;
}

// ---- Crypto / encoding helpers ----

function sha256Hex(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
  return bytesToHex(bytes);
}

function hmacHex(text, secret) {
  var bytes = Utilities.computeHmacSha256Signature(text, secret);
  return bytesToHex(bytes);
}

function bytesToHex(bytes) {
  return bytes
    .map(function (b) {
      var v = (b + 256) % 256;
      return ('0' + v.toString(16)).slice(-2);
    })
    .join('');
}

function base64UrlEncode(text) {
  return Utilities.base64EncodeWebSafe(text).replace(/=+$/, '');
}

function base64UrlDecode(text) {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(text)).getDataAsString();
}

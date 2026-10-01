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

function jsonError(code, message) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: false, error: { code: code, message: message } })
  ).setMimeType(ContentService.MimeType.JSON);
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
};

// Runs fn under the script lock (all sheet writes go through this).
function withLock(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    throw new ApiError('SERVER_ERROR', 'Server busy, try again');
  }
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function doGet() {
  return jsonOk('pong');
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonError('BAD_REQUEST', 'Invalid JSON body');
  }

  var action = body.action;
  var handler = ACTIONS[action];
  if (!handler) {
    return jsonError('BAD_REQUEST', 'Unknown action: ' + action);
  }

  try {
    var user = null;
    if (!PUBLIC_ACTIONS[action]) {
      user = requireUser(body.token);
    }
    var data = handler(body.payload || {}, user);
    return jsonOk(data);
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonError(err.code, err.message);
    }
    return jsonError('SERVER_ERROR', err.message || String(err));
  }
}

// ---- Users sheet helpers ----

function getUsersSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
}

// Returns { name, active, role } or null.
function findUser(name) {
  var sheet = getUsersSheet();
  var values = sheet.getDataRange().getValues(); // header + rows
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === name) {
      return { name: values[i][0], active: values[i][1], role: values[i][2] };
    }
  }
  return null;
}

function listActiveUserNames() {
  var sheet = getUsersSheet();
  var values = sheet.getDataRange().getValues();
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

  var secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  var expectedSignature = hmacHex(payloadB64, secret);
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

  var currentVersion = Number(
    PropertiesService.getScriptProperties().getProperty('tv:' + user.name) || '0'
  );
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

// Admin-only endpoints: categories and users. Dispatch enforces requireAdmin.
// No deleteCategory / deleteUser by design: only active = false.

function validateName(value, what) {
  var name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 1 || name.length > 50) {
    throw new ApiError('BAD_REQUEST', what + ' must be 1-50 characters');
  }
  if (name === UNASSIGNED) throw new ApiError('BAD_REQUEST', 'Reserved name');
  return name;
}

function validateColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new ApiError('BAD_REQUEST', 'color must be like #d9ead3');
  }
  return value;
}

function validatePin(pin, role) {
  var length = role === 'admin' ? 6 : 4;
  if (typeof pin !== 'string' || !/^\d+$/.test(pin) || pin.length !== length) {
    throw new ApiError('BAD_REQUEST', 'PIN must be exactly ' + length + ' digits');
  }
  return pin;
}

// Index of the first data row whose column A equals name, or -1. values[0] is the header.
function findRowIndex(values, name) {
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === name) return i;
  }
  return -1;
}

// ---- Categories ----

function getCategoriesSheet() {
  return getSpreadsheet().getSheetByName('Categories');
}

function categoryFromRow(r) {
  return { name: String(r[0]), color: String(r[1]), active: r[2] === true, order: Number(r[3]) || 0 };
}

function adminCategories() {
  return readCategories().sort(function (a, b) { return a.order - b.order; });
}

function addCategory(payload) {
  var name = validateName(payload.name, 'name');
  var color = validateColor(payload.color);

  return withLock(function () {
    var sheet = getCategoriesSheet();
    var values = readAll(sheet);
    if (findRowIndex(values, name) >= 0) throw new ApiError('CONFLICT', 'Category already exists');

    var order = 0;
    for (var i = 1; i < values.length; i++) {
      if (values[i][0] !== '') order = Math.max(order, Number(values[i][3]) || 0);
    }
    order += 1;

    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 4).setValues([[sanitizeText(name), color, true, order]]);
    return { name: name, color: color, active: true, order: order };
  });
}

function updateCategory(payload) {
  var has = function (k) { return payload[k] !== undefined; };
  if (typeof payload.name !== 'string') throw new ApiError('BAD_REQUEST', 'name is required');
  if (!has('color') && !has('active') && !has('order')) {
    throw new ApiError('BAD_REQUEST', 'Nothing to update');
  }
  var color = has('color') ? validateColor(payload.color) : null;
  if (has('active') && typeof payload.active !== 'boolean') {
    throw new ApiError('BAD_REQUEST', 'active must be true or false');
  }
  if (has('order') && !(typeof payload.order === 'number' && isFinite(payload.order) && Math.floor(payload.order) === payload.order)) {
    throw new ApiError('BAD_REQUEST', 'order must be an integer');
  }

  return withLock(function () {
    var sheet = getCategoriesSheet();
    var values = readAll(sheet);
    var i = findRowIndex(values, payload.name);
    if (i < 0) throw new ApiError('NOT_FOUND', 'Category not found');

    if (color !== null) sheet.getRange(i + 1, 2).setValue(color);
    if (has('active')) sheet.getRange(i + 1, 3).setValue(payload.active);
    if (has('order')) sheet.getRange(i + 1, 4).setValue(payload.order);

    var row = values[i].slice();
    if (color !== null) row[1] = color;
    if (has('active')) row[2] = payload.active;
    if (has('order')) row[3] = payload.order;
    return categoryFromRow(row);
  });
}

// Renames in Categories and in every matching Expenses row, atomically under one lock.
function renameCategory(payload) {
  if (typeof payload.oldName !== 'string') throw new ApiError('BAD_REQUEST', 'oldName is required');
  var newName = validateName(payload.newName, 'newName');

  return withLock(function () {
    var catSheet = getCategoriesSheet();
    var values = readAll(catSheet);
    var i = findRowIndex(values, payload.oldName);
    if (i < 0) throw new ApiError('NOT_FOUND', 'Category not found');
    if (newName === payload.oldName) return categoryFromRow(values[i]);
    if (findRowIndex(values, newName) >= 0) throw new ApiError('CONFLICT', 'Category already exists');

    var expSheet = getExpensesSheet();
    var last = expSheet.getLastRow();
    if (last >= 2) {
      var range = expSheet.getRange(2, COL.CATEGORY + 1, last - 1, 1);
      var changed = false;
      var column = readValues(range).map(function (r) {
        if (String(r[0]) !== payload.oldName) return r;
        changed = true;
        return [sanitizeText(newName)];
      });
      if (changed) range.setValues(column);
    }
    catSheet.getRange(i + 1, 1).setValue(sanitizeText(newName));

    var row = values[i].slice();
    row[0] = newName;
    return categoryFromRow(row);
  });
}

// ---- Users ----

function adminUsers() {
  var values = readAll(getUsersSheet());
  var list = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === '') continue;
    list.push({ name: String(values[i][0]), role: String(values[i][2]), active: values[i][1] === true });
  }
  return list;
}

function addUser(payload) {
  var name = validateName(payload.name, 'name');
  var pin = validatePin(payload.pin, 'member');

  return withLock(function () {
    var sheet = getUsersSheet();
    if (findRowIndex(readAll(sheet), name) >= 0) {
      throw new ApiError('CONFLICT', 'User already exists');
    }
    setPinForUser(name, pin);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 3).setValues([[sanitizeText(name), true, 'member']]);
    return { name: name, role: 'member', active: true };
  });
}

function setUserActive(payload) {
  if (typeof payload.name !== 'string') throw new ApiError('BAD_REQUEST', 'name is required');
  if (typeof payload.active !== 'boolean') throw new ApiError('BAD_REQUEST', 'active must be true or false');

  return withLock(function () {
    var sheet = getUsersSheet();
    var values = readAll(sheet);
    var i = findRowIndex(values, payload.name);
    if (i < 0) throw new ApiError('NOT_FOUND', 'User not found');

    var role = String(values[i][2]);
    var wasActive = values[i][1] === true;

    if (!payload.active && wasActive && role === 'admin') {
      var otherAdmins = values.filter(function (r, j) {
        return j > 0 && j !== i && r[2] === 'admin' && r[1] === true;
      });
      if (otherAdmins.length === 0) {
        throw new ApiError('CONFLICT', 'Cannot deactivate the last active admin');
      }
    }

    sheet.getRange(i + 1, 2).setValue(payload.active);
    if (!payload.active) bumpTokenVersion(payload.name); // kills existing sessions
    return { name: payload.name, role: role, active: payload.active };
  });
}

function setPin(payload) {
  if (typeof payload.user !== 'string') throw new ApiError('BAD_REQUEST', 'user is required');

  return withLock(function () {
    var target = findUser(payload.user);
    if (!target) throw new ApiError('NOT_FOUND', 'User not found');
    setPinForUser(target.name, validatePin(payload.pin, target.role));
    clearFailedAttempts(target.name); // also unlocks the user
    return {};
  });
}

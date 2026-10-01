// Expenses + categories endpoints for logged-in users (role U).
// Members only ever see and touch their own rows; admin sees all.

var TZ = 'Europe/Sofia';

// Column indexes (0-based) in the Expenses sheet.
var COL = { ID: 0, DATE: 1, ITEM: 2, PRICE: 3, CATEGORY: 4, USER: 5, CREATED: 6 };
var EXPENSE_COLUMNS = 7;

// ---- Validation ----

function parseDate(value) {
  var m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new ApiError('BAD_REQUEST', 'date must be YYYY-MM-DD');
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  var date = new Date(y, mo - 1, d); // midnight in the script time zone (Sofia)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    throw new ApiError('BAD_REQUEST', 'date is not a real date');
  }
  return date;
}

function validateItem(value) {
  var item = typeof value === 'string' ? value.trim() : '';
  if (item.length < 1 || item.length > 100) {
    throw new ApiError('BAD_REQUEST', 'item must be 1-100 characters');
  }
  return item;
}

function validatePrice(value) {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0 || value >= 100000) {
    throw new ApiError('BAD_REQUEST', 'price must be a number > 0 and < 100000');
  }
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
    throw new ApiError('BAD_REQUEST', 'price may have at most 2 decimals');
  }
  return Math.round(value * 100) / 100;
}

function validateMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new ApiError('BAD_REQUEST', 'month must be YYYY-MM');
  }
  return value;
}

// Text written to the Sheet must not be interpreted as a formula.
function sanitizeText(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

// ---- Categories ----

// Returns [{ name, color, active, order }] in sheet order.
function readCategories() {
  var values = readAll(getSpreadsheet().getSheetByName('Categories'));
  var list = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === '') continue;
    list.push({
      name: String(values[i][0]),
      color: String(values[i][1]),
      active: values[i][2] === true,
      order: Number(values[i][3]) || 0,
    });
  }
  return list;
}

function categories() {
  return readCategories()
    .filter(function (c) { return c.active; })
    .sort(function (a, b) { return a.order - b.order; })
    .map(function (c) { return { name: c.name, color: c.color, order: c.order }; });
}

// Category must exist and be active. `current` (optional) is the row's existing
// category, which stays valid on update even if it was deactivated since.
function validateCategory(value, current) {
  if (typeof value !== 'string') throw new ApiError('BAD_REQUEST', 'category is required');
  if (current !== undefined && value === current) return value;
  var found = readCategories().filter(function (c) { return c.name === value; })[0];
  if (!found) throw new ApiError('BAD_REQUEST', 'Unknown category');
  if (!found.active) throw new ApiError('BAD_REQUEST', 'Category is not active');
  return found.name;
}

// ---- Expenses sheet access ----

function getExpensesSheet() {
  return getSpreadsheet().getSheetByName('Expenses');
}

// Data rows only (row 2 onwards), one getValues() call.
function readExpenseValues(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return readValues(sheet.getRange(2, 1, last - 1, EXPENSE_COLUMNS));
}

function isBlankRow(row) {
  return row.slice(COL.DATE, COL.CATEGORY + 1).every(function (v) { return v === ''; });
}

function newId(used) {
  var id;
  do {
    id = Utilities.getUuid().substring(0, 8);
  } while (used[id]);
  used[id] = true;
  return id;
}

function needsIds(values) {
  return values.some(function (r) { return r[COL.ID] === '' && !isBlankRow(r); });
}

// Fills missing ids in `values` and writes only the id column. Caller holds the lock.
function backfillIds(sheet, values) {
  if (!needsIds(values)) return;
  var used = {};
  values.forEach(function (r) {
    if (r[COL.ID] !== '') used[String(r[COL.ID])] = true;
  });
  values.forEach(function (r) {
    if (r[COL.ID] === '' && !isBlankRow(r)) r[COL.ID] = newId(used);
  });
  var range = sheet.getRange(2, 1, values.length, 1);
  range.setNumberFormat('@'); // keep ids like "12e45678" from becoming numbers
  range.setValues(values.map(function (r) { return [r[COL.ID]]; }));
}

function toExpense(r) {
  return {
    id: String(r[COL.ID]),
    date: r[COL.DATE] instanceof Date ? Utilities.formatDate(r[COL.DATE], TZ, 'yyyy-MM-dd') : String(r[COL.DATE]),
    item: String(r[COL.ITEM]),
    price: Number(r[COL.PRICE]),
    category: String(r[COL.CATEGORY]),
    user: String(r[COL.USER]),
    createdAt: r[COL.CREATED] instanceof Date ? r[COL.CREATED].toISOString() : String(r[COL.CREATED]),
  };
}

// Read path: returns [{ row, expense }]. Backfills legacy ids under the lock if needed.
function loadExpenseEntries() {
  var sheet = getExpensesSheet();
  var values = readExpenseValues(sheet);
  if (needsIds(values)) {
    withLock(function () {
      values = readExpenseValues(sheet);
      backfillIds(sheet, values);
    });
  }
  return entriesFromValues(values);
}

function entriesFromValues(values) {
  var entries = [];
  values.forEach(function (r, i) {
    if (!isBlankRow(r)) entries.push({ row: i + 2, expense: toExpense(r) });
  });
  return entries;
}

function canTouch(user, expense) {
  return user.role === 'admin' || expense.user === user.name;
}

// Write path: finds the entry by id and enforces ownership. Caller holds the lock.
function findOwnedEntry(user, values, id) {
  if (typeof id !== 'string' || !id) throw new ApiError('BAD_REQUEST', 'id is required');
  var entry = entriesFromValues(values).filter(function (e) { return e.expense.id === id; })[0];
  if (!entry) throw new ApiError('NOT_FOUND', 'Expense not found');
  if (!canTouch(user, entry.expense)) throw new ApiError('FORBIDDEN', 'Not your expense');
  return entry;
}

// ---- Endpoints ----

function addExpense(payload, user) {
  var date = parseDate(payload.date);
  var item = validateItem(payload.item);
  var price = validatePrice(payload.price);
  var category = validateCategory(payload.category);

  return withLock(function () {
    var sheet = getExpensesSheet();
    var values = readExpenseValues(sheet);
    backfillIds(sheet, values);

    var used = {};
    values.forEach(function (r) { used[String(r[COL.ID])] = true; });
    var id = newId(used);
    var createdAt = new Date();

    var row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1).setNumberFormat('@');
    sheet.getRange(row, 1, 1, EXPENSE_COLUMNS).setValues([
      [id, date, sanitizeText(item), price, category, user.name, createdAt],
    ]);

    return {
      id: id,
      date: Utilities.formatDate(date, TZ, 'yyyy-MM-dd'),
      item: item,
      price: price,
      category: category,
      user: user.name,
      createdAt: createdAt.toISOString(),
    };
  });
}

function listExpenses(payload, user) {
  var month = payload.month === undefined ? null : validateMonth(payload.month);
  var limit = null;
  if (payload.limit !== undefined) {
    if (!isFinite(payload.limit) || payload.limit < 1 || Math.floor(payload.limit) !== payload.limit) {
      throw new ApiError('BAD_REQUEST', 'limit must be a positive integer');
    }
    limit = payload.limit;
  }
  // Members are always restricted to their own rows; the user filter is admin-only.
  var onlyUser = user.role === 'admin' ? payload.user : user.name;

  var entries = loadExpenseEntries().filter(function (e) {
    var x = e.expense;
    if (onlyUser && x.user !== onlyUser) return false;
    if (month && x.date.substring(0, 7) !== month) return false;
    return true;
  });

  // Newest first: date, then createdAt, then sheet position.
  entries.sort(function (a, b) {
    if (a.expense.date !== b.expense.date) return a.expense.date < b.expense.date ? 1 : -1;
    if (a.expense.createdAt !== b.expense.createdAt) return a.expense.createdAt < b.expense.createdAt ? 1 : -1;
    return b.row - a.row;
  });

  var list = entries.map(function (e) { return e.expense; });
  return limit ? list.slice(0, limit) : list;
}

function updateExpense(payload, user) {
  var has = function (k) { return payload[k] !== undefined; };
  if (!has('date') && !has('item') && !has('price') && !has('category')) {
    throw new ApiError('BAD_REQUEST', 'Nothing to update');
  }
  var date = has('date') ? parseDate(payload.date) : null;
  var item = has('item') ? validateItem(payload.item) : null;
  var price = has('price') ? validatePrice(payload.price) : null;

  return withLock(function () {
    var sheet = getExpensesSheet();
    var values = readExpenseValues(sheet);
    backfillIds(sheet, values);
    var entry = findOwnedEntry(user, values, payload.id);
    var expense = entry.expense;

    var category = has('category') ? validateCategory(payload.category, expense.category) : null;

    // Write only the cells that changed.
    if (date) {
      sheet.getRange(entry.row, COL.DATE + 1).setValue(date);
      expense.date = Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
    }
    if (item !== null) {
      sheet.getRange(entry.row, COL.ITEM + 1).setValue(sanitizeText(item));
      expense.item = item;
    }
    if (price !== null) {
      sheet.getRange(entry.row, COL.PRICE + 1).setValue(price);
      expense.price = price;
    }
    if (category !== null) {
      sheet.getRange(entry.row, COL.CATEGORY + 1).setValue(category);
      expense.category = category;
    }
    return expense;
  });
}

function deleteExpense(payload, user) {
  return withLock(function () {
    var sheet = getExpensesSheet();
    var values = readExpenseValues(sheet);
    backfillIds(sheet, values);
    var entry = findOwnedEntry(user, values, payload.id);
    sheet.deleteRow(entry.row);
    return { id: entry.expense.id };
  });
}

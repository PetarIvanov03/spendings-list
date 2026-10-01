// Monthly summaries, computed in script from the Expenses sheet.

// Legacy rows have no user; they count only in the family total, under this label.
var UNASSIGNED = '(unassigned)';

function round2(n) {
  return Math.round(n * 100) / 100;
}

function monthExpenses(month) {
  return loadExpenseEntries()
    .map(function (e) { return e.expense; })
    .filter(function (x) { return x.date.substring(0, 7) === month; });
}

// Groups expenses by key(expense) and sums in cents to avoid float drift.
// Returns [{ <label>: key, total }] sorted by total desc.
function sumBy(expenses, key, label) {
  var cents = {};
  expenses.forEach(function (x) {
    var k = key(x);
    cents[k] = (cents[k] || 0) + (isFinite(x.price) ? Math.round(x.price * 100) : 0);
  });
  return Object.keys(cents)
    .map(function (k) {
      var row = {};
      row[label] = k;
      row.total = round2(cents[k] / 100);
      return row;
    })
    .sort(function (a, b) { return b.total - a.total; });
}

function totalOf(rows) {
  var cents = 0;
  rows.forEach(function (r) { cents += Math.round(r.total * 100); });
  return round2(cents / 100);
}

// U: own summary.
function summary(payload, user) {
  var month = validateMonth(payload.month);
  var own = monthExpenses(month).filter(function (x) { return x.user === user.name; });
  var byCategory = sumBy(own, function (x) { return x.category; }, 'category');
  return { month: month, total: totalOf(byCategory), byCategory: byCategory };
}

// A: family summary, or one user's with payload.user.
function adminSummary(payload) {
  var month = validateMonth(payload.month);
  var rows = monthExpenses(month);
  if (payload.user !== undefined) {
    if (typeof payload.user !== 'string' || !findUser(payload.user)) {
      throw new ApiError('NOT_FOUND', 'User not found');
    }
    rows = rows.filter(function (x) { return x.user === payload.user; });
  }
  var byCategory = sumBy(rows, function (x) { return x.category; }, 'category');
  var byUser = sumBy(rows, function (x) { return x.user || UNASSIGNED; }, 'user');
  return { total: totalOf(byCategory), byCategory: byCategory, byUser: byUser };
}

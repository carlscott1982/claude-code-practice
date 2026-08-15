/* Unit tests for the Spend Log pure logic.
   Run: node --test tests/  */

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../docs/core.js");

/* ------------------------------ money ------------------------------ */

test("keypad accumulates digits as cents", () => {
  let d = "";
  for (const k of ["1", "2", "5", "0"]) d = C.pushDigit(d, k);
  assert.equal(d, "1250");
  assert.equal(C.centsFromDigits(d), 1250);
  assert.equal(C.formatMoney(1250, "$"), "$12.50");
});

test("a single digit is cents, not dollars", () => {
  assert.equal(C.centsFromDigits(C.pushDigit("", "5")), 5);
  assert.equal(C.formatMoney(5, "$"), "$0.05");
});

test("leading zeros collapse", () => {
  let d = "";
  for (const k of ["0", "0", "7"]) d = C.pushDigit(d, k);
  assert.equal(d, "7");
});

test("digit count is capped", () => {
  let d = "";
  for (let i = 0; i < 20; i++) d = C.pushDigit(d, "9");
  assert.equal(d.length, C.MAX_DIGITS);
});

test("non-digits are ignored", () => {
  assert.equal(C.pushDigit("12", "a"), "12");
  assert.equal(C.pushDigit("12", "."), "12");
});

test("backspace empties down to nothing", () => {
  assert.equal(C.popDigit("125"), "12");
  assert.equal(C.popDigit("1"), "");
  assert.equal(C.popDigit(""), "");
});

test("money formats with grouping and a custom symbol", () => {
  assert.equal(C.formatMoney(123456789, "$"), "$1,234,567.89");
  assert.equal(C.formatMoney(0, "£"), "£0.00");
  assert.equal(C.formatMoney(100, "€"), "€1.00");
});

test("parseAmount handles the shapes a human types", () => {
  assert.equal(C.parseAmount("12.50"), 1250);
  assert.equal(C.parseAmount("12.5"), 1250);
  assert.equal(C.parseAmount("12"), 1200);
  assert.equal(C.parseAmount("1,234.56"), 123456);
  assert.equal(C.parseAmount(" 8.99 "), 899);
  assert.equal(C.parseAmount(""), null);
  assert.equal(C.parseAmount("abc"), null);
  assert.equal(C.parseAmount("-5"), null);
  assert.equal(C.parseAmount("."), null);
});

test("float rounding cannot drift", () => {
  // 0.1 + 0.2 in cents must be exactly 30, forever.
  const a = C.parseAmount("0.10");
  const b = C.parseAmount("0.20");
  assert.equal(a + b, 30);
  assert.equal(C.formatMoney(a + b, "$"), "$0.30");
  assert.equal(C.parseAmount("70.55"), 7055);
});

/* ------------------------------ dates ------------------------------ */

test("day and month keys use local time", () => {
  const ts = new Date(2026, 7, 15, 23, 30).getTime(); // 15 Aug 2026, 11:30pm
  assert.equal(C.dayKey(ts), "2026-08-15");
  assert.equal(C.monthKey(ts), "2026-08");
});

test("shiftMonth rolls across year boundaries", () => {
  assert.deepEqual(C.shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(C.shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
});

test("re-dating an entry keeps its time of day", () => {
  const ts = new Date(2026, 7, 15, 14, 45, 30).getTime();
  const moved = C.applyDateInput(ts, "2026-08-02");
  const d = new Date(moved);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 2);
  assert.equal(d.getHours(), 14);
  assert.equal(d.getMinutes(), 45);
});

test("a malformed date input leaves the timestamp alone", () => {
  const ts = Date.now();
  assert.equal(C.applyDateInput(ts, "not-a-date"), ts);
  assert.equal(C.applyDateInput(ts, ""), ts);
});

test("dayHeading names today and yesterday", () => {
  const today = new Date(2026, 7, 15, 12).getTime();
  const yesterday = new Date(2026, 7, 14, 12).getTime();
  const older = new Date(2026, 7, 3, 12).getTime();
  assert.equal(C.dayHeading(today, today), "Today");
  assert.equal(C.dayHeading(yesterday, today), "Yesterday");
  assert.notEqual(C.dayHeading(older, today), "Today");
});

/* --------------------------- aggregation --------------------------- */

function makeEntries() {
  return [
    { id: "a", amt: 1000, cat: "c_food", ts: new Date(2026, 7, 1, 9).getTime(), note: "" },
    { id: "b", amt: 2500, cat: "c_food", ts: new Date(2026, 7, 1, 19).getTime(), note: "dinner" },
    { id: "c", amt: 500, cat: "c_coffee", ts: new Date(2026, 7, 2, 8).getTime(), note: "" },
    { id: "d", amt: 9000, cat: "c_bills", ts: new Date(2026, 6, 20, 10).getTime(), note: "" },
  ];
}

test("entriesForMonth filters to the month in view", () => {
  const august = C.entriesForMonth(makeEntries(), 2026, 7);
  assert.equal(august.length, 3);
  assert.equal(C.sumCents(august), 4000);
});

test("aggregateByCategory ranks descending and computes share", () => {
  const august = C.entriesForMonth(makeEntries(), 2026, 7);
  const rows = C.aggregateByCategory(august, C.DEFAULT_CATEGORIES);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Food");
  assert.equal(rows[0].cents, 3500);
  assert.equal(Math.round(rows[0].share * 100), 88);
  assert.equal(rows[1].name, "Coffee");
});

test("entries in a deleted category survive with a placeholder name", () => {
  const entries = [{ id: "x", amt: 100, cat: "gone", ts: Date.now(), note: "" }];
  const rows = C.aggregateByCategory(entries, C.DEFAULT_CATEGORIES);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Removed category");
  assert.equal(rows[0].cents, 100);
});

test("aggregating nothing yields no rows and no divide-by-zero", () => {
  const rows = C.aggregateByCategory([], C.DEFAULT_CATEGORIES);
  assert.deepEqual(rows, []);
  assert.equal(C.sumCents([]), 0);
});

test("groupByDay buckets newest first with per-day totals", () => {
  const groups = C.groupByDay(C.entriesForMonth(makeEntries(), 2026, 7));
  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, "2026-08-02");
  assert.equal(groups[0].total, 500);
  assert.equal(groups[1].key, "2026-08-01");
  assert.equal(groups[1].total, 3500);
  assert.equal(groups[1].entries.length, 2);
});

test("monthDelta returns null without a baseline", () => {
  assert.equal(C.monthDelta(1000, 0), null);
  assert.equal(C.monthDelta(1500, 1000), 0.5);
  assert.equal(C.formatDelta(null), "");
  assert.match(C.formatDelta(0.5), /↑ 50% vs last month/);
  assert.match(C.formatDelta(-0.25), /↓ 25% vs last month/);
  assert.match(C.formatDelta(0), /same as last month/);
});

/* ------------------------ state transitions ------------------------ */

test("addEntry appends and returns the new entry", () => {
  const s0 = C.defaultState();
  const { state: s1, entry } = C.addEntry(s0, 1250, "c_food", 1000, "");
  assert.equal(s0.entries.length, 0, "original state is not mutated");
  assert.equal(s1.entries.length, 1);
  assert.equal(entry.amt, 1250);
  assert.equal(entry.cat, "c_food");
  assert.ok(entry.id);
});

test("removeEntry deletes only the target — the undo path", () => {
  let s = C.defaultState();
  const first = C.addEntry(s, 100, "c_food", 1, "");
  const second = C.addEntry(first.state, 200, "c_coffee", 2, "");
  s = C.removeEntry(second.state, second.entry.id);
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].id, first.entry.id);
});

test("updateEntry patches fields but never the id", () => {
  const { state: s1, entry } = C.addEntry(C.defaultState(), 100, "c_food", 1, "");
  const s2 = C.updateEntry(s1, entry.id, { amt: 999, note: "fixed", id: "hacked" });
  assert.equal(s2.entries[0].amt, 999);
  assert.equal(s2.entries[0].note, "fixed");
  assert.equal(s2.entries[0].id, entry.id);
});

test("moveCategory reorders and refuses to run off either end", () => {
  const cats = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(C.moveCategory(cats, 0, 1).map((c) => c.id), ["b", "a", "c"]);
  assert.deepEqual(C.moveCategory(cats, 2, -1).map((c) => c.id), ["a", "c", "b"]);
  assert.equal(C.moveCategory(cats, 0, -1), cats);
  assert.equal(C.moveCategory(cats, 2, 1), cats);
});

test("countEntriesForCategory backs the delete warning", () => {
  assert.equal(C.countEntriesForCategory(makeEntries(), "c_food"), 2);
  assert.equal(C.countEntriesForCategory(makeEntries(), "c_none"), 0);
});

/* --------------------------- import/export ------------------------- */

test("a round trip through export and import preserves everything", () => {
  let s = C.defaultState();
  s = C.addEntry(s, 1250, "c_food", new Date(2026, 7, 1).getTime(), "lunch").state;
  s = C.addEntry(s, 400, "c_coffee", new Date(2026, 7, 2).getTime(), "").state;

  const payload = JSON.parse(JSON.stringify(C.exportPayload(s)));
  const result = C.validateImport(payload);

  assert.equal(result.ok, true);
  assert.equal(result.skipped, 0);
  assert.equal(result.data.entries.length, 2);
  assert.equal(C.sumCents(result.data.entries), 1650);
  assert.equal(result.data.entries[0].note, "lunch");
  assert.equal(result.data.categories.length, s.categories.length);
});

test("import rejects files that aren't exports", () => {
  assert.equal(C.validateImport(null).ok, false);
  assert.equal(C.validateImport("nope").ok, false);
  assert.equal(C.validateImport({}).ok, false);
  assert.equal(C.validateImport({ entries: [], categories: [] }).ok, false); // no categories
});

test("import keeps good rows and counts the bad ones", () => {
  const raw = {
    categories: [{ id: "c1", name: "Food", icon: "🍔" }],
    entries: [
      { id: "ok", amt: 500, cat: "c1", ts: 1700000000000, note: "fine" },
      { id: "bad-amount", amt: "banana", cat: "c1", ts: 1700000000000 },
      { id: "negative", amt: -100, cat: "c1", ts: 1700000000000 },
      { id: "orphan", amt: 100, cat: "missing", ts: 1700000000000 },
      { id: "no-ts", amt: 100, cat: "c1" },
      "not an object",
    ],
  };
  const result = C.validateImport(raw);
  assert.equal(result.ok, true);
  assert.equal(result.data.entries.length, 1);
  assert.equal(result.skipped, 5);
  assert.equal(result.data.entries[0].id, "ok");
});

test("import coerces a missing currency and theme to safe defaults", () => {
  const result = C.validateImport({
    categories: [{ id: "c1", name: "X" }],
    entries: [],
    theme: "neon",
  });
  assert.equal(result.data.currency, "$");
  assert.equal(result.data.theme, "system");
  assert.equal(result.data.categories[0].icon, "•");
});

test("migrate survives corrupt storage", () => {
  assert.deepEqual(C.migrate(null).entries, []);
  assert.deepEqual(C.migrate("garbage").entries, []);
  assert.equal(C.migrate({}).categories.length, C.DEFAULT_CATEGORIES.length);
  const good = C.migrate(C.exportPayload(C.defaultState()));
  assert.equal(good.categories.length, C.DEFAULT_CATEGORIES.length);
});

test("export filename is date-stamped", () => {
  assert.equal(C.exportFilename(new Date(2026, 7, 5).getTime()), "spendlog-20260805.json");
});

test("ids are unique across rapid calls", () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(C.newId("e"));
  assert.equal(ids.size, 1000);
});

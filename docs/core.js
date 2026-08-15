/* ============================================================
   Spend Log — pure logic.

   Deliberately free of DOM access so it can be unit-tested under
   node. app.js owns every read and write to the document.

   Money is stored as an integer number of cents, never a float:
   0.1 + 0.2 problems in a spending tracker are not acceptable.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SpendCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const MAX_DIGITS = 9; // caps a single entry just under 10,000,000.00
  const STORAGE_KEY = "spendlog.v1";

  const DEFAULT_CATEGORIES = [
    { id: "c_food", icon: "🍔", name: "Food" },
    { id: "c_groceries", icon: "🛒", name: "Groceries" },
    { id: "c_coffee", icon: "☕", name: "Coffee" },
    { id: "c_transport", icon: "🚌", name: "Transport" },
    { id: "c_shopping", icon: "🛍️", name: "Shopping" },
    { id: "c_bills", icon: "🧾", name: "Bills" },
    { id: "c_fun", icon: "🎬", name: "Fun" },
    { id: "c_health", icon: "💊", name: "Health" },
    { id: "c_home", icon: "🏠", name: "Home" },
    { id: "c_other", icon: "•", name: "Other" },
  ];

  const MONTH_TABS = ["categories", "entries"];

  function defaultState() {
    return {
      v: SCHEMA_VERSION,
      currency: "$",
      theme: "system",
      monthTab: "categories",
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      entries: [],
    };
  }

  let idCounter = 0;
  function newId(prefix) {
    idCounter += 1;
    return (
      (prefix || "e") +
      "_" +
      Date.now().toString(36) +
      "_" +
      idCounter.toString(36) +
      Math.random().toString(36).slice(2, 6)
    );
  }

  /* ------------------------------ money ------------------------------ */

  // The keypad is a cents accumulator: each digit shifts left by one
  // place, so "1","2","5","0" reads as 12.50 with no decimal key at all.
  function pushDigit(digits, d) {
    if (!/^[0-9]$/.test(String(d))) return digits;
    const next = (digits + String(d)).replace(/^0+(?=\d)/, "");
    return next.length > MAX_DIGITS ? digits : next;
  }

  function popDigit(digits) {
    return digits.length <= 1 ? "" : digits.slice(0, -1);
  }

  function centsFromDigits(digits) {
    if (!digits) return 0;
    const n = parseInt(digits, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function formatMoney(cents, symbol) {
    const sym = symbol == null ? "$" : symbol;
    const rounded = Math.round(Number(cents) || 0);
    const sign = rounded < 0 ? "-" : "";
    const body = (Math.abs(rounded) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return sign + sym + body;
  }

  // Parses free text from the edit sheet ("12.5", "1,234.56") into cents.
  // Returns null when the text isn't a usable amount.
  function parseAmount(text) {
    if (text == null) return null;
    const cleaned = String(text).replace(/[\s,]/g, "");
    if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
    const cents = Math.round(parseFloat(cleaned) * 100);
    if (!Number.isFinite(cents) || cents < 0) return null;
    return cents;
  }

  function sumCents(entries) {
    let total = 0;
    for (const e of entries) total += e.amt;
    return total;
  }

  /* ------------------------------ dates ------------------------------ */

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // All bucketing is done in local time — a spend at 11pm belongs to that
  // day as the user lived it, not to tomorrow in UTC.
  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function monthKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  function inMonth(ts, year, month) {
    const d = new Date(ts);
    return d.getFullYear() === year && d.getMonth() === month;
  }

  function entriesForMonth(entries, year, month) {
    return entries.filter((e) => inMonth(e.ts, year, month));
  }

  function shiftMonth(year, month, delta) {
    const d = new Date(year, month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  function monthLabel(year, month) {
    return new Date(year, month, 1).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }

  function dateInputValue(ts) {
    return dayKey(ts);
  }

  // Keeps the original time of day so re-dating an entry doesn't silently
  // move it across a day boundary later.
  function applyDateInput(ts, value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!m) return ts;
    const old = new Date(ts);
    const next = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      old.getHours(),
      old.getMinutes(),
      old.getSeconds(),
      old.getMilliseconds()
    );
    return next.getTime();
  }

  function dayHeading(ts, todayTs) {
    const key = dayKey(ts);
    const today = dayKey(todayTs == null ? Date.now() : todayTs);
    if (key === today) return "Today";
    const yesterday = dayKey((todayTs == null ? Date.now() : todayTs) - 86400000);
    if (key === yesterday) return "Yesterday";
    return new Date(ts).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  /* --------------------------- aggregation --------------------------- */

  function categoryLookup(categories) {
    const map = new Map();
    for (const c of categories) map.set(c.id, c);
    return map;
  }

  // Ranked descending — the bar list reads high-to-low, so length alone
  // carries magnitude and one hue is enough.
  function aggregateByCategory(entries, categories) {
    const totals = new Map();
    for (const e of entries) totals.set(e.cat, (totals.get(e.cat) || 0) + e.amt);

    const total = sumCents(entries);
    const lookup = categoryLookup(categories);
    const rows = [];

    for (const [id, cents] of totals) {
      const cat = lookup.get(id);
      rows.push({
        id,
        name: cat ? cat.name : "Removed category",
        icon: cat ? cat.icon : "•",
        cents,
        share: total > 0 ? cents / total : 0,
      });
    }

    rows.sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
    return rows;
  }

  function groupByDay(entries) {
    const sorted = entries.slice().sort((a, b) => b.ts - a.ts);
    const groups = [];
    let current = null;

    for (const e of sorted) {
      const key = dayKey(e.ts);
      if (!current || current.key !== key) {
        current = { key, ts: e.ts, entries: [], total: 0 };
        groups.push(current);
      }
      current.entries.push(e);
      current.total += e.amt;
    }
    return groups;
  }

  // Percentage change vs the previous month, or null when there's no
  // baseline to compare against (dividing by zero says nothing useful).
  function monthDelta(currentCents, previousCents) {
    if (!previousCents) return null;
    return (currentCents - previousCents) / previousCents;
  }

  function formatDelta(ratio) {
    if (ratio == null) return "";
    const pct = Math.abs(ratio * 100);
    const shown = pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
    const arrow = ratio > 0 ? "↑" : ratio < 0 ? "↓" : "→";
    if (ratio === 0) return "→ same as last month";
    return arrow + " " + shown + "% vs last month";
  }

  /* ------------------------- state operations ------------------------ */

  // Returns both halves: the caller needs the entry itself for the undo toast.
  function addEntry(state, cents, catId, ts, note) {
    const entry = {
      id: newId("e"),
      amt: Math.round(cents),
      cat: catId,
      ts: ts == null ? Date.now() : ts,
      note: note || "",
    };
    return { state: { ...state, entries: state.entries.concat([entry]) }, entry };
  }

  function removeEntry(state, id) {
    return { ...state, entries: state.entries.filter((e) => e.id !== id) };
  }

  function updateEntry(state, id, patch) {
    return {
      ...state,
      entries: state.entries.map((e) => (e.id === id ? { ...e, ...patch, id: e.id } : e)),
    };
  }

  function moveCategory(categories, index, delta) {
    const next = categories.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return categories;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    return next;
  }

  function countEntriesForCategory(entries, catId) {
    return entries.filter((e) => e.cat === catId).length;
  }

  /* --------------------------- import/export ------------------------- */

  function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  // Import is hostile-input territory: a hand-edited or truncated file
  // should degrade to "we kept what was valid", never corrupt the store.
  function validateImport(raw) {
    if (!isPlainObject(raw)) return { ok: false, error: "That file isn't a Spend Log export." };
    if (!Array.isArray(raw.entries) || !Array.isArray(raw.categories)) {
      return { ok: false, error: "That file is missing its entries or categories." };
    }

    const categories = [];
    const seenCats = new Set();
    for (const c of raw.categories) {
      if (!isPlainObject(c)) continue;
      const id = typeof c.id === "string" && c.id ? c.id : newId("c");
      if (seenCats.has(id)) continue;
      const name = typeof c.name === "string" && c.name.trim() ? c.name.trim() : "Untitled";
      seenCats.add(id);
      categories.push({ id, name, icon: typeof c.icon === "string" && c.icon ? c.icon : "•" });
    }
    if (!categories.length) return { ok: false, error: "That file has no usable categories." };

    const entries = [];
    let skipped = 0;
    const seenEntries = new Set();
    for (const e of raw.entries) {
      if (!isPlainObject(e)) { skipped += 1; continue; }
      const amt = Math.round(Number(e.amt));
      const ts = Number(e.ts);
      if (!Number.isFinite(amt) || amt < 0 || !Number.isFinite(ts) || ts <= 0) { skipped += 1; continue; }
      if (typeof e.cat !== "string" || !seenCats.has(e.cat)) { skipped += 1; continue; }
      const id = typeof e.id === "string" && e.id && !seenEntries.has(e.id) ? e.id : newId("e");
      seenEntries.add(id);
      entries.push({ id, amt, cat: e.cat, ts, note: typeof e.note === "string" ? e.note : "" });
    }

    return {
      ok: true,
      skipped,
      data: {
        v: SCHEMA_VERSION,
        currency: typeof raw.currency === "string" && raw.currency ? raw.currency.slice(0, 3) : "$",
        theme: ["system", "light", "dark"].includes(raw.theme) ? raw.theme : "system",
        monthTab: MONTH_TABS.includes(raw.monthTab) ? raw.monthTab : "categories",
        categories,
        entries,
      },
    };
  }

  // Tolerates anything an older or partially-written store might hold.
  function migrate(raw) {
    const base = defaultState();
    if (!isPlainObject(raw)) return base;
    const result = validateImport(raw);
    if (result.ok) return result.data;
    return {
      ...base,
      currency: typeof raw.currency === "string" && raw.currency ? raw.currency : base.currency,
    };
  }

  function exportPayload(state) {
    return {
      v: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      currency: state.currency,
      theme: state.theme,
      monthTab: state.monthTab,
      categories: state.categories,
      entries: state.entries.slice().sort((a, b) => a.ts - b.ts),
    };
  }

  function exportFilename(now) {
    const d = new Date(now == null ? Date.now() : now);
    return "spendlog-" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + ".json";
  }

  return {
    SCHEMA_VERSION,
    STORAGE_KEY,
    MAX_DIGITS,
    MONTH_TABS,
    DEFAULT_CATEGORIES,
    defaultState,
    newId,
    pushDigit,
    popDigit,
    centsFromDigits,
    formatMoney,
    parseAmount,
    sumCents,
    dayKey,
    monthKey,
    inMonth,
    entriesForMonth,
    shiftMonth,
    monthLabel,
    dateInputValue,
    applyDateInput,
    dayHeading,
    aggregateByCategory,
    groupByDay,
    monthDelta,
    formatDelta,
    addEntry,
    removeEntry,
    updateEntry,
    moveCategory,
    countEntriesForCategory,
    validateImport,
    migrate,
    exportPayload,
    exportFilename,
  };
});

/* ============================================================
   Spend Log — DOM wiring.

   All pure logic lives in core.js; this file only reads and writes
   the document, localStorage, and the service worker.
   ============================================================ */

(function () {
  "use strict";

  const C = window.SpendCore;
  const $ = (sel) => document.querySelector(sel);

  /* ------------------------------ state ------------------------------ */

  let state = load();
  let draft = ""; // keypad digits, e.g. "1250" → 12.50
  let cursor = { year: new Date().getFullYear(), month: new Date().getMonth() };
  let editingId = null;
  let undo = null; // { entryId, timer }

  function load() {
    try {
      const raw = localStorage.getItem(C.STORAGE_KEY);
      if (!raw) return C.defaultState();
      return C.migrate(JSON.parse(raw));
    } catch (err) {
      console.warn("Could not read saved data; starting fresh.", err);
      return C.defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(C.STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      console.error("Save failed", err);
      alert(
        "Could not save — this device's storage for the app is full or blocked. " +
          "Export your data from Settings before you lose it."
      );
      return false;
    }
  }

  const money = (cents) => C.formatMoney(cents, state.currency);

  /* ---------------------------- navigation --------------------------- */

  const VIEWS = ["log", "month", "settings"];

  function showView(name) {
    for (const v of VIEWS) {
      $("#view-" + v).hidden = v !== name;
    }
    for (const tab of document.querySelectorAll(".tab")) {
      const active = tab.dataset.view === name;
      tab.classList.toggle("is-active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    if (name === "month") renderMonth();
    if (name === "settings") renderSettings();
  }

  document.querySelector(".tabbar").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (tab) showView(tab.dataset.view);
  });

  /* ------------------------------ theme ------------------------------ */

  function applyTheme() {
    const root = document.documentElement;
    if (state.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", state.theme);
  }

  /* ----------------------------- log view ---------------------------- */

  function renderAmount() {
    const cents = C.centsFromDigits(draft);
    const el = $("#amount");
    el.textContent = money(cents);
    el.classList.toggle("is-zero", cents === 0);
  }

  function renderToday() {
    const todayKey = C.dayKey(Date.now());
    const total = C.sumCents(state.entries.filter((e) => C.dayKey(e.ts) === todayKey));
    $("#today-total").textContent = money(total);
  }

  function renderCategories() {
    const grid = $("#category-grid");
    grid.textContent = "";

    if (!state.categories.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "No categories yet — add some in Settings.";
      grid.appendChild(p);
      return;
    }

    for (const cat of state.categories) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-btn";
      btn.dataset.cat = cat.id;
      btn.setAttribute("aria-label", "Save as " + cat.name);

      const icon = document.createElement("span");
      icon.className = "cat-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = cat.icon;

      const name = document.createElement("span");
      name.className = "cat-name";
      name.textContent = cat.name;

      btn.append(icon, name);
      grid.appendChild(btn);
    }
  }

  function nudge(message) {
    const head = $(".log-head");
    const hint = $("#amount-hint");
    hint.textContent = message;
    hint.classList.add("is-warning");
    head.classList.remove("is-nudging");
    void head.offsetWidth; // restart the animation
    head.classList.add("is-nudging");
    setTimeout(() => {
      hint.textContent = "Tap a category to save";
      hint.classList.remove("is-warning");
    }, 1600);
  }

  function commit(catId, buttonEl) {
    const cents = C.centsFromDigits(draft);
    if (cents <= 0) {
      nudge("Enter an amount first");
      return;
    }

    const cat = state.categories.find((c) => c.id === catId);
    const result = C.addEntry(state, cents, catId, Date.now(), "");
    state = result.state;
    if (!save()) return;

    draft = "";
    renderAmount();
    renderToday();

    if (buttonEl) {
      buttonEl.classList.remove("is-committed");
      void buttonEl.offsetWidth;
      buttonEl.classList.add("is-committed");
    }
    if (navigator.vibrate) navigator.vibrate(12);

    showToast(money(result.entry.amt) + " · " + (cat ? cat.name : "Saved"), result.entry.id);
  }

  $(".keypad").addEventListener("click", (e) => {
    const key = e.target.closest(".key");
    if (!key) return;
    const k = key.dataset.key;
    if (k === "clear") draft = "";
    else if (k === "back") draft = C.popDigit(draft);
    else draft = C.pushDigit(draft, k);
    renderAmount();
  });

  $("#category-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".cat-btn");
    if (btn) commit(btn.dataset.cat, btn);
  });

  // Hardware / on-screen keyboard support for desktop use.
  document.addEventListener("keydown", (e) => {
    if ($("#view-log").hidden) return;
    if (e.target.matches("input, select, textarea")) return;
    if (/^[0-9]$/.test(e.key)) {
      draft = C.pushDigit(draft, e.key);
      renderAmount();
    } else if (e.key === "Backspace") {
      draft = C.popDigit(draft);
      renderAmount();
    } else if (e.key === "Escape") {
      draft = "";
      renderAmount();
    }
  });

  /* ------------------------------ toast ------------------------------ */

  function showToast(text, entryId) {
    const toast = $("#toast");
    $("#toast-text").textContent = text;
    $("#toast-undo").hidden = !entryId;
    toast.hidden = false;

    if (undo) clearTimeout(undo.timer);
    undo = {
      entryId: entryId || null,
      timer: setTimeout(() => {
        toast.hidden = true;
        undo = null;
      }, 4500),
    };
  }

  $("#toast-undo").addEventListener("click", () => {
    if (!undo || !undo.entryId) return;
    state = C.removeEntry(state, undo.entryId);
    save();
    clearTimeout(undo.timer);
    undo = null;
    $("#toast").hidden = true;
    renderToday();
    if (!$("#view-month").hidden) renderMonth();
  });

  /* ---------------------------- month view --------------------------- */

  function latestMonth() {
    if (!state.entries.length) return null;
    const newest = state.entries.reduce((a, b) => (a.ts > b.ts ? a : b));
    const d = new Date(newest.ts);
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  // Don't let the user page forward forever into empty months — stop at
  // the current month, or later if an entry is dated into the future.
  function maxMonth() {
    const now = new Date();
    const limit = { year: now.getFullYear(), month: now.getMonth() };
    const latest = latestMonth();
    if (latest && latest.year * 12 + latest.month > limit.year * 12 + limit.month) return latest;
    return limit;
  }

  function renderMonth() {
    const { year, month } = cursor;
    $("#month-label").textContent = C.monthLabel(year, month);

    const max = maxMonth();
    $("#month-next").disabled = year * 12 + month >= max.year * 12 + max.month;

    const entries = C.entriesForMonth(state.entries, year, month);
    const total = C.sumCents(entries);
    $("#month-total").textContent = money(total);

    const prev = C.shiftMonth(year, month, -1);
    const prevTotal = C.sumCents(C.entriesForMonth(state.entries, prev.year, prev.month));
    $("#month-delta").textContent = entries.length
      ? C.formatDelta(C.monthDelta(total, prevTotal))
      : "";

    renderBreakdown(entries);
    renderEntries(entries);
    applyMonthTab();
  }

  // Which half of the month is on screen — the category chart or the raw
  // entries. Persisted, so the app reopens on whichever you actually use.
  function applyMonthTab() {
    const active = C.MONTH_TABS.includes(state.monthTab) ? state.monthTab : "categories";
    for (const seg of document.querySelectorAll(".segment")) {
      const on = seg.dataset.panel === active;
      seg.classList.toggle("is-active", on);
      seg.setAttribute("aria-selected", on ? "true" : "false");
      seg.tabIndex = on ? 0 : -1;
    }
    $("#panel-categories").hidden = active !== "categories";
    $("#panel-entries").hidden = active !== "entries";
  }

  function setMonthTab(name) {
    if (!C.MONTH_TABS.includes(name) || state.monthTab === name) return;
    state = { ...state, monthTab: name };
    save();
    applyMonthTab();
  }

  $(".segmented").addEventListener("click", (e) => {
    const seg = e.target.closest(".segment");
    if (seg) setMonthTab(seg.dataset.panel);
  });

  // Arrow keys move between tabs, as a tablist is expected to.
  $(".segmented").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const index = C.MONTH_TABS.indexOf(state.monthTab);
    const next = C.MONTH_TABS[(index + (e.key === "ArrowRight" ? 1 : -1) + C.MONTH_TABS.length) % C.MONTH_TABS.length];
    setMonthTab(next);
    document.querySelector('.segment[data-panel="' + next + '"]').focus();
  });

  function renderBreakdown(entries) {
    const wrap = $("#breakdown");
    wrap.textContent = "";

    const rows = C.aggregateByCategory(entries, state.categories);
    if (!rows.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Nothing logged this month.";
      wrap.appendChild(p);
      return;
    }

    // Scale to the largest category so the top bar fills the track; every
    // bar is labelled with its own name, value and share, so length is a
    // comparison aid rather than the only way to read a number.
    const max = rows[0].cents;

    for (const row of rows) {
      const el = document.createElement("div");
      el.className = "bar-row";

      const head = document.createElement("div");
      head.className = "bar-head";

      const name = document.createElement("span");
      name.className = "bar-name";
      const icon = document.createElement("span");
      icon.className = "cat-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = row.icon;
      name.append(icon, document.createTextNode(row.name));

      const share = document.createElement("span");
      share.className = "bar-share";
      share.textContent = Math.round(row.share * 100) + "%";

      const value = document.createElement("span");
      value.className = "bar-value";
      value.textContent = money(row.cents);

      head.append(name, share, value);

      const track = document.createElement("div");
      track.className = "bar-track";
      track.setAttribute("aria-hidden", "true"); // the numbers above say it
      const fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.width = (max > 0 ? (row.cents / max) * 100 : 0) + "%";
      track.appendChild(fill);

      el.append(head, track);
      wrap.appendChild(el);
    }
  }

  function renderEntries(entries) {
    const wrap = $("#entry-list");
    wrap.textContent = "";

    const groups = C.groupByDay(entries);
    if (!groups.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Nothing logged this month.";
      wrap.appendChild(p);
      return;
    }

    const lookup = new Map(state.categories.map((c) => [c.id, c]));

    for (const group of groups) {
      const section = document.createElement("div");
      section.className = "day-group";

      const head = document.createElement("div");
      head.className = "day-head";
      const dayName = document.createElement("span");
      dayName.className = "day-name";
      dayName.textContent = C.dayHeading(group.ts);
      const daySum = document.createElement("span");
      daySum.className = "day-sum";
      daySum.textContent = money(group.total);
      head.append(dayName, daySum);
      section.appendChild(head);

      for (const entry of group.entries) {
        const cat = lookup.get(entry.cat);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "entry";
        btn.dataset.id = entry.id;
        btn.setAttribute("aria-label", "Edit " + money(entry.amt) + " " + (cat ? cat.name : "entry"));

        const icon = document.createElement("span");
        icon.className = "cat-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = cat ? cat.icon : "•";

        const main = document.createElement("div");
        main.className = "entry-main";
        const catName = document.createElement("div");
        catName.className = "entry-cat";
        catName.textContent = cat ? cat.name : "Removed category";
        main.appendChild(catName);
        if (entry.note) {
          const note = document.createElement("div");
          note.className = "entry-note";
          note.textContent = entry.note;
          main.appendChild(note);
        }

        const amt = document.createElement("span");
        amt.className = "entry-amt";
        amt.textContent = money(entry.amt);

        btn.append(icon, main, amt);
        section.appendChild(btn);
      }

      wrap.appendChild(section);
    }
  }

  $("#month-prev").addEventListener("click", () => {
    cursor = C.shiftMonth(cursor.year, cursor.month, -1);
    renderMonth();
  });

  $("#month-next").addEventListener("click", () => {
    cursor = C.shiftMonth(cursor.year, cursor.month, 1);
    renderMonth();
  });

  /* ---------------------------- edit sheet --------------------------- */

  const sheet = $("#edit-sheet");

  $("#entry-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".entry");
    if (btn) openEdit(btn.dataset.id);
  });

  function openEdit(id) {
    const entry = state.entries.find((x) => x.id === id);
    if (!entry) return;
    editingId = id;

    const select = $("#edit-category");
    select.textContent = "";
    for (const cat of state.categories) {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.icon + "  " + cat.name;
      select.appendChild(opt);
    }
    if (!state.categories.some((c) => c.id === entry.cat)) {
      const opt = document.createElement("option");
      opt.value = entry.cat;
      opt.textContent = "Removed category";
      select.appendChild(opt);
    }

    $("#edit-amount").value = (entry.amt / 100).toFixed(2);
    select.value = entry.cat;
    $("#edit-date").value = C.dateInputValue(entry.ts);
    $("#edit-note").value = entry.note || "";

    sheet.showModal();
  }

  sheet.addEventListener("close", () => {
    const action = sheet.returnValue;
    const id = editingId;
    editingId = null;
    if (!id) return;

    if (action === "delete") {
      if (!confirm("Delete this entry?")) return;
      state = C.removeEntry(state, id);
      save();
      renderMonth();
      renderToday();
      showToast("Entry deleted", null);
      return;
    }

    if (action !== "save") return;

    const cents = C.parseAmount($("#edit-amount").value);
    if (cents == null || cents <= 0) {
      showToast("That amount didn't look right — nothing changed", null);
      return;
    }

    const entry = state.entries.find((x) => x.id === id);
    if (!entry) return;

    state = C.updateEntry(state, id, {
      amt: cents,
      cat: $("#edit-category").value,
      ts: C.applyDateInput(entry.ts, $("#edit-date").value),
      note: $("#edit-note").value.trim(),
    });
    save();
    renderMonth();
    renderToday();
  });

  /* --------------------------- settings view ------------------------- */

  function renderSettings() {
    $("#currency-input").value = state.currency;
    $("#theme-select").value = state.theme;
    renderCategoryEditor();

    const count = state.entries.length;
    const bytes = new Blob([JSON.stringify(state)]).size;
    $("#storage-line").textContent =
      count + (count === 1 ? " entry" : " entries") + " · about " + Math.max(1, Math.round(bytes / 1024)) + " KB on this device";
  }

  function renderCategoryEditor() {
    const wrap = $("#category-editor");
    wrap.textContent = "";

    state.categories.forEach((cat, index) => {
      const row = document.createElement("div");
      row.className = "cat-edit-row";
      row.dataset.id = cat.id;

      const icon = document.createElement("input");
      icon.className = "input input-icon";
      icon.type = "text";
      icon.maxLength = 2;
      icon.value = cat.icon;
      icon.dataset.field = "icon";
      icon.setAttribute("aria-label", cat.name + " icon");

      const name = document.createElement("input");
      name.className = "input";
      name.type = "text";
      name.value = cat.name;
      name.dataset.field = "name";
      name.setAttribute("aria-label", cat.name + " name");

      const up = document.createElement("button");
      up.type = "button";
      up.className = "row-btn";
      up.dataset.action = "up";
      up.textContent = "↑";
      up.disabled = index === 0;
      up.setAttribute("aria-label", "Move " + cat.name + " up");

      const down = document.createElement("button");
      down.type = "button";
      down.className = "row-btn";
      down.dataset.action = "down";
      down.textContent = "↓";
      down.disabled = index === state.categories.length - 1;
      down.setAttribute("aria-label", "Move " + cat.name + " down");

      const del = document.createElement("button");
      del.type = "button";
      del.className = "row-btn is-danger";
      del.dataset.action = "delete";
      del.textContent = "✕";
      del.setAttribute("aria-label", "Delete " + cat.name);

      row.append(icon, name, up, down, del);
      wrap.appendChild(row);
    });
  }

  $("#category-editor").addEventListener("input", (e) => {
    const row = e.target.closest(".cat-edit-row");
    if (!row || !e.target.dataset.field) return;
    const id = row.dataset.id;
    const field = e.target.dataset.field;
    const value = e.target.value;
    state = {
      ...state,
      categories: state.categories.map((c) =>
        c.id === id ? { ...c, [field]: field === "name" ? value : value || "•" } : c
      ),
    };
    save();
    renderCategories();
  });

  $("#category-editor").addEventListener("click", (e) => {
    const btn = e.target.closest(".row-btn");
    if (!btn) return;
    const row = btn.closest(".cat-edit-row");
    const id = row.dataset.id;
    const index = state.categories.findIndex((c) => c.id === id);
    if (index < 0) return;

    if (btn.dataset.action === "delete") {
      const used = C.countEntriesForCategory(state.entries, id);
      const msg = used
        ? "Delete this category? " +
          used +
          (used === 1 ? " entry uses it and will" : " entries use it and will") +
          " stay in your history, shown as “Removed category”."
        : "Delete this category?";
      if (!confirm(msg)) return;
      state = { ...state, categories: state.categories.filter((c) => c.id !== id) };
    } else {
      const delta = btn.dataset.action === "up" ? -1 : 1;
      state = { ...state, categories: C.moveCategory(state.categories, index, delta) };
    }

    save();
    renderCategoryEditor();
    renderCategories();
  });

  $("#add-category").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#new-cat-name").value.trim();
    if (!name) return;
    const icon = $("#new-cat-icon").value.trim() || "•";
    state = {
      ...state,
      categories: state.categories.concat([{ id: C.newId("c"), icon, name }]),
    };
    save();
    $("#new-cat-name").value = "";
    $("#new-cat-icon").value = "";
    renderCategoryEditor();
    renderCategories();
  });

  $("#currency-input").addEventListener("input", (e) => {
    state = { ...state, currency: e.target.value.slice(0, 3) };
    save();
    renderAmount();
    renderToday();
  });

  $("#theme-select").addEventListener("change", (e) => {
    state = { ...state, theme: e.target.value };
    save();
    applyTheme();
  });

  /* --------------------------- data in / out ------------------------- */

  $("#export-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(C.exportPayload(state), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = C.exportFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $("#import-btn").addEventListener("click", () => $("#import-file").click());

  $("#import-file").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();

    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        alert("That file isn't valid JSON.");
        return;
      }

      const result = C.validateImport(parsed);
      if (!result.ok) {
        alert(result.error);
        return;
      }

      const summary =
        "Import " +
        result.data.entries.length +
        " entries and " +
        result.data.categories.length +
        " categories?" +
        (result.skipped ? "\n\n" + result.skipped + " unreadable entries will be skipped." : "") +
        "\n\nThis replaces everything currently in the app.";
      if (!confirm(summary)) return;

      state = result.data;
      save();
      applyTheme();
      renderAll();
      showToast("Imported " + state.entries.length + " entries", null);
    };

    reader.onerror = () => alert("Could not read that file.");
    reader.readAsText(file);
    e.target.value = "";
  });

  $("#reset-btn").addEventListener("click", () => {
    if (!confirm("Erase every entry and reset categories? This cannot be undone.")) return;
    if (!confirm("Really erase everything? Export first if you might want it back.")) return;
    state = C.defaultState();
    save();
    applyTheme();
    renderAll();
    showToast("All data erased", null);
  });

  /* ------------------------- service worker -------------------------- */

  // True when running inside the Android APK rather than a browser tab.
  const isNative = typeof window.Capacitor !== "undefined";

  function registerSW() {
    const label = $("#sw-state");

    // In the APK every asset already ships inside the package, so a
    // service worker would only be a cache in front of a cache.
    if (isNative) {
      label.textContent = "installed app";
      return;
    }
    if (!("serviceWorker" in navigator) || location.protocol === "file:") {
      label.textContent = "offline mode unavailable here";
      return;
    }
    navigator.serviceWorker
      .register("sw.js")
      .then(() => {
        label.textContent = "ready offline";
      })
      .catch(() => {
        label.textContent = "offline mode unavailable";
      });
  }

  // The honest description of where the data lives differs between the
  // two builds, and the difference is the whole reason the APK exists.
  function describeStorage() {
    $("#storage-note").textContent = isNative
      ? "Everything is stored inside this app on this device. Nothing is uploaded and there is no account. " +
        "Clearing your browser data does not touch it — only uninstalling the app, or clearing its storage in " +
        "Android Settings, will. Export anyway if the history matters to you."
      : "Everything is stored on this device only. Nothing is uploaded, and there is no account. " +
        "Export regularly if the data matters to you — clearing your browser storage erases it.";
  }

  // Ask the browser not to evict the data if the device runs low on space.
  // This does not survive a deliberate "clear browsing data"; only the
  // installed app build is safe from that.
  function requestPersistence() {
    if (isNative || !navigator.storage || !navigator.storage.persist) return;
    navigator.storage.persist().catch(() => {});
  }

  /* ------------------------------ boot ------------------------------- */

  function renderAll() {
    renderAmount();
    renderToday();
    renderCategories();
    if (!$("#view-month").hidden) renderMonth();
    if (!$("#view-settings").hidden) renderSettings();
  }

  applyTheme();
  renderAll();
  showView("log");
  describeStorage();
  requestPersistence();
  registerSW();

  // Coming back to the app after midnight should not show a stale "Today".
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      renderToday();
      if (!$("#view-month").hidden) renderMonth();
    }
  });
})();

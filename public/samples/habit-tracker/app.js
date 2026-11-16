/* Habit tracker
   Habits live in localStorage under "habit-tracker.habits" as
   [{ id, name, days: { "YYYY-MM-DD": true } }].
   One day is one tick, and dates are local YYYY-MM-DD strings. */

(function () {
  "use strict";

  const STORAGE_KEY = "habit-tracker.habits";

  const form = document.getElementById("add-habit");
  const nameInput = document.getElementById("habit-name");
  const list = document.getElementById("habit-list");
  const summary = document.getElementById("streak-summary");

  if (!form || !nameInput || !list || !summary) return;

  let habits = loadHabits();

  /* Storage ---------------------------------------------------------- */

  function loadHabits() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return []; // storage is blocked: carry on with an empty list
    }

    if (!raw) return [];

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    return parsed.map(readHabit).filter(function (habit) {
      return habit !== null;
    });
  }

  function readHabit(entry) {
    if (!entry || typeof entry !== "object") return null;

    const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 60) : "";
    if (!name) return null;

    const days = {};
    if (entry.days && typeof entry.days === "object") {
      Object.keys(entry.days).forEach(function (day) {
        if (entry.days[day] && isDayKey(day)) days[day] = true;
      });
    }

    return {
      id: typeof entry.id === "string" && entry.id ? entry.id : createId(),
      name: name,
      days: days
    };
  }

  function saveHabits() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
    } catch (error) {
      console.error("Habits could not be saved to local storage.", error);
    }
  }

  function createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* Dates ------------------------------------------------------------ */

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dayKey(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function today() {
    return dayKey(new Date());
  }

  function isDayKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function dayBefore(key) {
    const parts = key.split("-");
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    date.setDate(date.getDate() - 1);
    return dayKey(date);
  }

  /* Streaks ---------------------------------------------------------- */

  // Count back from today. An unticked today does not break a streak yet,
  // so counting starts at yesterday in that case.
  function currentStreak(habit, todayKey) {
    let day = habit.days[todayKey] ? todayKey : dayBefore(todayKey);
    let count = 0;
    while (habit.days[day]) {
      count += 1;
      day = dayBefore(day);
    }
    return count;
  }

  /* Rendering -------------------------------------------------------- */

  function render() {
    renderList();
    renderSummary();
  }

  function renderList() {
    const todayKey = today();
    list.textContent = "";

    if (habits.length === 0) {
      const empty = document.createElement("li");
      empty.className = "habit-empty";
      empty.textContent = "No habits yet. Add one above to start your first streak.";
      list.append(empty);
      return;
    }

    habits.forEach(function (habit) {
      list.append(buildRow(habit, todayKey));
    });
  }

  function buildRow(habit, todayKey) {
    const done = Boolean(habit.days[todayKey]);

    const item = document.createElement("li");
    item.className = done ? "habit-item is-done" : "habit-item";
    item.dataset.id = habit.id;

    const toggle = document.createElement("label");
    toggle.className = "habit-toggle";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "habit-box";
    box.checked = done;

    const name = document.createElement("span");
    name.className = "habit-name";
    name.textContent = habit.name;

    toggle.append(box, name);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "habit-remove";
    remove.setAttribute("aria-label", "Remove " + habit.name);
    remove.innerHTML =
      '<svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">' +
      '<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>' +
      "</svg>";

    item.append(toggle, remove);
    return item;
  }

  function renderSummary() {
    const todayKey = today();
    summary.textContent = "";

    if (habits.length === 0) {
      const empty = document.createElement("p");
      empty.className = "streak-empty";
      empty.textContent = "Add a habit and tick it off to start a streak.";
      summary.append(empty);
      return;
    }

    const rows = document.createElement("ul");
    rows.className = "streak-list";

    habits.forEach(function (habit) {
      const streak = currentStreak(habit, todayKey);

      const row = document.createElement("li");
      row.className = streak > 0 ? "streak-item is-active" : "streak-item";

      const name = document.createElement("span");
      name.className = "streak-name";
      name.textContent = habit.name;

      const value = document.createElement("span");
      value.className = "streak-value";
      value.textContent =
        streak === 0 ? "No streak yet" : streak + (streak === 1 ? " day" : " days");

      row.append(name, value);
      rows.append(row);
    });

    summary.append(rows);
  }

  /* Actions ---------------------------------------------------------- */

  function addHabit(name) {
    habits.push({ id: createId(), name: name, days: {} });
    saveHabits();
    render();
  }

  function setDone(id, done) {
    const habit = habits.find(function (entry) {
      return entry.id === id;
    });
    if (!habit) return;

    const todayKey = today();
    if (done) habit.days[todayKey] = true;
    else delete habit.days[todayKey];

    saveHabits();
    renderSummary();
  }

  function removeHabit(id) {
    habits = habits.filter(function (entry) {
      return entry.id !== id;
    });
    saveHabits();
  }

  /* Events ----------------------------------------------------------- */

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    const name = nameInput.value.trim().replace(/\s+/g, " ");

    if (!name) {
      nameInput.value = "";
      nameInput.focus();
      return;
    }

    addHabit(name.slice(0, 60));
    form.reset();
    nameInput.focus();
  });

  list.addEventListener("change", function (event) {
    const box = event.target;
    if (!box || !box.classList || !box.classList.contains("habit-box")) return;

    const item = box.closest(".habit-item");
    if (!item) return;

    setDone(item.dataset.id, box.checked);
    item.classList.toggle("is-done", box.checked);
  });

  list.addEventListener("click", function (event) {
    const button = event.target.closest(".habit-remove");
    if (!button) return;

    const item = button.closest(".habit-item");
    if (!item) return;

    const index = habits.findIndex(function (habit) {
      return habit.id === item.dataset.id;
    });

    removeHabit(item.dataset.id);
    renderList();
    renderSummary();

    // Leave the keyboard where the work is: the next habit, or the name field.
    const boxes = list.querySelectorAll(".habit-box");
    if (boxes.length === 0) {
      nameInput.focus();
    } else {
      boxes[Math.max(0, Math.min(index, boxes.length - 1))].focus();
    }
  });

  // Another tab wrote to the same store: show what it saved.
  window.addEventListener("storage", function (event) {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    habits = loadHabits();
    render();
  });

  /* Start-up --------------------------------------------------------- */

  function start() {
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

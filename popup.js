"use strict";

// ── DOM refs ─────────────────────────────────────────────────────────────────
const sessionBadge = document.getElementById("session-badge");
const courseIdInput = document.getElementById("course-id");
const btnLoad = document.getElementById("btn-load");
const progressSection = document.getElementById("progress-section");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
const scrollBody = document.getElementById("scroll-body");
const stateLoading = document.getElementById("state-loading");
const loadingMsg = document.getElementById("loading-msg");
const stateError = document.getElementById("state-error");
const errorMsg = document.getElementById("error-msg");
const stateEmpty = document.getElementById("state-empty");
const modulesContainer = document.getElementById("modules-container");

// ── State ─────────────────────────────────────────────────────────────────────
let moduleDataMap = {}; // moduleId -> moduleData
let courseId = "";
let moduleIdsList = []; // preserve original modules order
const processingModules = new Set();

// ── Init ──────────────────────────────────────────────────────────────────────
chrome.storage.local.get("courseId", (d) => {
  if (d.courseId) courseIdInput.value = d.courseId;
});

checkSession();

// ── Session check ─────────────────────────────────────────────────────────────
async function checkSession() {
  const res = await send("GET_COOKIES_INFO");
  if (res.error || !res.hasSession) {
    sessionBadge.className = "session-badge err";
    sessionBadge.textContent = "Not logged in";
    btnLoad.disabled = true;
  } else {
    sessionBadge.className = "session-badge ok";
    sessionBadge.textContent = `${res.count} cookies`;
    btnLoad.disabled = false;
  }
}

// ── Load button ───────────────────────────────────────────────────────────────
btnLoad.addEventListener("click", () => {
  courseId = courseIdInput.value.trim();
  if (!courseId) {
    showError("Enter a Course ID");
    return;
  }
  chrome.storage.local.set({ courseId });
  loadCourse();
});

courseIdInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnLoad.click();
});

// ── Load course ───────────────────────────────────────────────────────────────
async function loadCourse() {
  showLoading("Loading module list…");
  progressSection.style.display = "none";
  modulesContainer.innerHTML = "";
  moduleDataMap = {};

  try {
    const { moduleIds, error } = await send("GET_MODULES", { courseId });
    if (error) {
      showError(error);
      return;
    }
    if (!moduleIds.length) {
      showEmpty();
      return;
    }

    moduleIdsList = moduleIds.slice();
    showLoading(`Loading ${moduleIdsList.length} modules…`);

    // Fetch all module details in parallel with retries for robustness
    const detailPromises = moduleIdsList.map((mid) =>
      fetchModuleDetailWithRetries(courseId, mid, 2),
    );
    const results = await Promise.all(detailPromises);

    results.forEach((data, i) => {
      if (data && !data.error) moduleDataMap[moduleIdsList[i]] = data;
    });

    hideStates();
    renderAll(moduleIdsList);
  } catch (err) {
    showError(err.message);
  }
}

// Fetch module detail with simple retry/backoff
async function fetchModuleDetailWithRetries(courseId, moduleId, retries = 2) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await send("GET_MODULE_DETAIL", { courseId, moduleId });
      if (res && !res.error) return res;
      // treat as error to retry
      attempt++;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    } catch (err) {
      attempt++;
      if (attempt > retries) return { error: err.message };
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  return { error: "Failed to fetch module" };
}

// ── Render all modules ────────────────────────────────────────────────────────
function renderAll(order = []) {
  modulesContainer.innerHTML = "";

  let total = 0,
    done = 0;

  // Render in API-provided order (order array) to avoid missing/ordering issues
  const list =
    Array.isArray(order) && order.length ? order : Object.keys(moduleDataMap);

  list.forEach((moduleId) => {
    const data = moduleDataMap[moduleId];
    if (!data) return; // skip missing
    const pages = (data.items || []).filter((i) => i.type === "Page");
    if (!pages.length) return;

    pages.forEach((p) => {
      total++;
      if (p.completion_requirement?.completed) done++;
    });

    modulesContainer.appendChild(renderModule(moduleId, data, pages));
  });

  if (total === 0) {
    showEmpty();
    return;
  }

  // Progress bar
  progressSection.style.display = "block";
  progressLabel.textContent = `${done}/${total}`;
  progressFill.style.width = total
    ? `${Math.round((done / total) * 100)}%`
    : "0%";
}

// ── Render one module ─────────────────────────────────────────────────────────
function renderModule(moduleId, data, pages) {
  const donePgs = pages.filter(
    (p) => p.completion_requirement?.completed,
  ).length;
  const allDone = donePgs === pages.length;

  const wrap = document.createElement("div");
  wrap.className = "module";
  wrap.dataset.moduleId = moduleId;

  // Header
  const header = document.createElement("div");
  header.className = "module-header";
  header.innerHTML = `
    <div class="module-title">${esc(data.name || "Module " + moduleId)}</div>
    <div class="module-meta">
      <span class="module-count">${donePgs}/${pages.length}</span>
      <span class="chevron">▼</span>
    </div>
  `;
  header.addEventListener("click", () => wrap.classList.toggle("collapsed"));

  // show "Complete All" only when there are more than 2 pending items
  const pendingCount = pages.length - donePgs;
  if (pendingCount > 2) {
    const meta = header.querySelector(".module-meta");
    const chevron = meta.querySelector(".chevron");
    const completeBtn = document.createElement("button");
    completeBtn.className = "btn btn-sm btn-success complete-all";
    completeBtn.textContent = "Complete All";
    meta.insertBefore(completeBtn, chevron);
    completeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      completeAllModule(moduleId, completeBtn);
    });
  }

  // Items
  const itemsDiv = document.createElement("div");
  itemsDiv.className = "module-items";

  pages.forEach((item) => {
    itemsDiv.appendChild(renderItem(moduleId, item));
  });

  wrap.appendChild(header);
  wrap.appendChild(itemsDiv);
  return wrap;
}

// ── Render one item row ───────────────────────────────────────────────────────
function renderItem(moduleId, item) {
  const completed = item.completion_requirement?.completed || false;

  const row = document.createElement("div");
  row.className = "item-row";
  row.dataset.itemId = item.id;

  const dot = document.createElement("div");
  dot.className = `dot ${completed ? "done" : "pending"}`;

  const title = document.createElement("div");
  title.className = "item-title";
  title.textContent = item.title;

  const status = document.createElement("div");
  status.className = `item-status ${completed ? "done" : "pending"}`;
  status.textContent = completed ? "Done" : "Pending";

  const btn = document.createElement("button");
  btn.className = completed ? "mark-btn done-btn" : "mark-btn";
  btn.textContent = completed ? "✓" : "Mark done";
  btn.disabled = completed;

  if (!completed) {
    btn.addEventListener("click", () => markComplete(moduleId, item, btn, row));
  }

  row.appendChild(dot);
  row.appendChild(title);
  row.appendChild(status);
  row.appendChild(btn);
  return row;
}

// ── Mark complete ─────────────────────────────────────────────────────────────
async function markComplete(moduleId, item, btn, row) {
  btn.disabled = true;
  btn.textContent = "…";

  try {
    const updated = await send("MARK_COMPLETE", {
      courseId,
      moduleId,
      itemId: item.id,
      title: item.title,
    });

    if (updated.error) throw new Error(updated.error);

    // Update local state
    moduleDataMap[moduleId] = updated;
    renderAll(); // full re-render to update progress bar + counts
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Mark done";
    showErrorToast(err.message);
  }
}

// Complete all pending items in a module sequentially with 2s gap
async function completeAllModule(moduleId, btn) {
  if (processingModules.has(moduleId))
    return showErrorToast("Already processing this module");
  const data = moduleDataMap[moduleId];
  if (!data) return showErrorToast("Module data missing");

  const pending = (data.items || []).filter(
    (i) => i.type === "Page" && !i.completion_requirement?.completed,
  );
  if (!pending.length) return showErrorToast("No pending items");

  processingModules.add(moduleId);
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Queue…";

  try {
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];

      // disable item's button in current DOM if present
      const rowEl = modulesContainer.querySelector(
        `.module[data-module-id="${moduleId}"] .item-row[data-item-id="${item.id}"]`,
      );
      const itemBtn = rowEl && rowEl.querySelector("button");
      if (itemBtn) {
        itemBtn.disabled = true;
        itemBtn.textContent = "…";
      }

      // perform mark complete
      try {
        const updated = await send("MARK_COMPLETE", {
          courseId,
          moduleId,
          itemId: item.id,
          title: item.title,
        });
        if (updated && !updated.error) {
          moduleDataMap[moduleId] = updated;
          // re-render to reflect updated status
          renderAll(moduleIdsList);
        } else {
          showErrorToast(updated?.error || "Failed to mark item");
        }
      } catch (err) {
        showErrorToast(err.message);
      }

      // wait 2 seconds between items
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    processingModules.delete(moduleId);
    btn.disabled = false;
    btn.textContent = originalText;
    renderAll(moduleIdsList);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

function showLoading(msg) {
  stateLoading.style.display = "block";
  stateError.style.display = "none";
  stateEmpty.style.display = "none";
  loadingMsg.textContent = msg || "Loading…";
}

function showError(msg) {
  stateLoading.style.display = "none";
  stateError.style.display = "block";
  stateEmpty.style.display = "none";
  errorMsg.textContent = msg;
}

function showEmpty() {
  stateLoading.style.display = "none";
  stateError.style.display = "none";
  stateEmpty.style.display = "block";
}

function hideStates() {
  stateLoading.style.display = "none";
  stateError.style.display = "none";
  stateEmpty.style.display = "none";
}

function esc(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function showErrorToast(msg) {
  const t = document.createElement("div");
  t.style.cssText = `
    position:fixed;bottom:12px;left:50%;transform:translateX(-50%);
    background:#450a0a;color:#ef4444;padding:8px 16px;border-radius:8px;
    font-size:12px;z-index:999;white-space:nowrap;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

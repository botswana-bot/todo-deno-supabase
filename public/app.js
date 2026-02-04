import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// These are injected by Deno Deploy Environment Variables at build/runtime.
// In the browser, we expose them via a tiny inline config file generated at request time.
// For simplicity on Deno Deploy, we read them from a static /config.js that you edit.
//
// 👉 Step after Supabase creation: edit public/config.js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (id) => document.getElementById(id);

const ui = {
  banner: $("banner"),
  auth: $("auth"),
  app: $("app"),
  whoami: $("whoami"),
  stats: $("stats"),
  btnLogout: $("btn-logout"),
  btnTheme: $("btn-theme"),
  btnSignup: $("btn-signup"),
  btnRefresh: $("btn-refresh"),
  btnClearDone: $("btn-clear-done"),
  authForm: $("auth-form"),
  todoForm: $("todo-form"),
  email: $("email"),
  password: $("password"),
  todoText: $("todo-text"),
  todoTags: $("todo-tags"),
  tagsPreview: $("tags-preview"),
  listSelect: $("list-select"),
  btnNewList: $("btn-new-list"),

  modal: $("modal"),
  modalClose: $("modal-close"),
  modalCancel: $("modal-cancel"),
  modalCreate: $("modal-create"),
  modalListName: $("modal-list-name"),
  list: $("todo-list"),
  empty: $("empty"),
  tpl: $("todo-item"),

  toast: $("toast"),
  toastInner: $("toast-inner"),
  toastTitle: $("toast-title"),
  toastMsg: $("toast-msg"),
  toastClose: $("toast-close"),

  cursorLayer: $("cursor-layer"),
};

let presenceChannel = null;
let lastPresenceSet = new Set();

let cursorChannel = null;
let cursorState = new Map(); // key -> {x,y,email,color}
let cursorRaf = null;
let lastMouse = { x: 0, y: 0 };

let todosRealtimeChannel = null;
let refreshTimer = null;
function scheduleRefresh() {
  // coalesce bursts (update + join table updates)
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    try {
      await refresh();
    } catch (e) {
      console.warn("realtime refresh failed", e);
    }
  }, 350);
}

let state = {
  lists: [],
  selectedListId: null,
};

function showToast(title, msg, kind = "info", timeoutMs = 4500) {
  if (!ui.toast || !ui.toastTitle || !ui.toastMsg) return;

  ui.toastTitle.textContent = title;
  ui.toastMsg.textContent = msg;
  ui.toast.classList.remove("hidden");

  // style
  const cls =
    kind === "error"
      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
      : kind === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
        : "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100";

  ui.toastInner.className = `pointer-events-auto rounded-2xl border px-4 py-3 text-sm shadow-soft ${cls}`;

  if (timeoutMs > 0) {
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      ui.toast.classList.add("hidden");
    }, timeoutMs);
  }
}

ui.toastClose?.addEventListener("click", () => ui.toast?.classList.add("hidden"));

function setBanner(msg, kind = "info") {
  ui.banner.classList.remove("hidden");
  const color =
    kind === "error"
      ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
      : kind === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
        : "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100";

  ui.banner.className = `mb-6 rounded-xl border p-4 text-sm shadow-sm ${color}`;
  ui.banner.textContent = msg;
}

function clearBanner() {
  ui.banner.classList.add("hidden");
  ui.banner.textContent = "";
}

function setTheme() {
  const isDark = document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", !isDark);
  localStorage.setItem("theme", !isDark ? "dark" : "light");
}

ui.btnTheme.addEventListener("click", setTheme);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOUR_") || SUPABASE_ANON_KEY.includes("YOUR_")) {
  setBanner(
    "Config manquante: édite public/config.js avec SUPABASE_URL et SUPABASE_ANON_KEY (Supabase).",
    "error",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function normalizeTagName(s) {
  return (s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parseTags(input) {
  return Array.from(
    new Set(
      (input || "")
        .split(",")
        .map(normalizeTagName)
        .filter(Boolean),
    ),
  ).slice(0, 8);
}

function renderTagPill(name, tone = "neutral") {
  const span = document.createElement("span");
  const base =
    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium";

  const cls =
    tone === "accent"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200"
      : "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200";

  span.className = `${base} ${cls}`;
  span.textContent = name;
  return span;
}

function renderTagsPreview() {
  if (!ui.tagsPreview) return;
  ui.tagsPreview.innerHTML = "";
  const tags = parseTags(ui.todoTags?.value || "");
  for (const t of tags) ui.tagsPreview.appendChild(renderTagPill(t, "accent"));
}

ui.todoTags?.addEventListener("input", renderTagsPreview);

async function ensureDefaultList() {
  const { data: lists, error } = await supabase
    .from("todo_lists")
    .select("id, name, inserted_at")
    .order("inserted_at", { ascending: true });

  if (error) {
    // If migration not applied yet, table won't exist.
    // We handle it gracefully by keeping the old single-list behavior.
    return null;
  }

  if ((lists?.length ?? 0) === 0) {
    const { data: created, error: e2 } = await supabase
      .from("todo_lists")
      .insert({ name: "Inbox" })
      .select("id, name")
      .single();
    if (e2) throw e2;
    return created;
  }

  return lists[0];
}

async function loadLists() {
  const { data, error } = await supabase
    .from("todo_lists")
    .select("id, name, inserted_at")
    .order("inserted_at", { ascending: true });

  if (error) return false;

  state.lists = data ?? [];
  if (!state.selectedListId) state.selectedListId = state.lists[0]?.id ?? null;
  renderListSelect();
  return true;
}

function renderListSelect() {
  if (!ui.listSelect) return;

  ui.listSelect.innerHTML = "";
  for (const l of state.lists) {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.name;
    if (l.id === state.selectedListId) opt.selected = true;
    ui.listSelect.appendChild(opt);
  }

  // If lists are not available (migration not applied), hide controls.
  const show = (state.lists?.length ?? 0) > 0;
  ui.listSelect.closest("div")?.classList?.toggle("hidden", !show);
  ui.btnNewList?.classList?.toggle("hidden", !show);
}

async function getUser() {
  // supabase.auth.getUser() throws "Auth session missing" when there's no session.
  // For a logged-out visitor, that's not an error: we just return null.
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const user = sessionData?.session?.user ?? null;
  return user;
}

function renderTodos(todos) {
  ui.list.innerHTML = "";

  const done = todos.filter((t) => t.done).length;
  ui.stats.textContent = `${todos.length} total • ${done} terminée(s)`;

  // Empty state
  if (ui.empty) {
    ui.empty.classList.toggle("hidden", (todos?.length ?? 0) > 0);
  }

  for (const t of todos) {
    const node = ui.tpl.content.cloneNode(true);
    const cb = node.querySelector(".todo-toggle");
    const text = node.querySelector(".todo-text");
    const tagsWrap = node.querySelector(".todo-tags");
    const del = node.querySelector(".todo-del");

    text.textContent = t.title;

    // Show creator email under the task
    if (text && t.created_by_email) {
      const emailLine = document.createElement("div");
      emailLine.className = "mt-1 text-[11px] text-zinc-500 dark:text-zinc-400";
      emailLine.textContent = `par ${t.created_by_email}`;
      text.parentElement?.parentElement?.appendChild(emailLine);
    }
    cb.checked = !!t.done;
    if (t.done) {
      text.classList.add("line-through", "text-zinc-400", "dark:text-zinc-500");
    }

    // Render tags if present
    if (tagsWrap) {
      tagsWrap.innerHTML = "";
      const tagNames = (t?.todo_todo_tags ?? [])
        .map((x) => x?.todo_tags?.name)
        .filter(Boolean);
      for (const name of tagNames) tagsWrap.appendChild(renderTagPill(name));
    }

    cb.addEventListener("change", async () => {
      try {
        await supabase.from("todos").update({ done: cb.checked }).eq("id", t.id);
        await refresh();
      } catch (e) {
        setBanner(`Erreur toggle: ${e.message ?? e}`, "error");
      }
    });

    del.addEventListener("click", async () => {
      try {
        await supabase.from("todos").delete().eq("id", t.id);
        await refresh();
      } catch (e) {
        setBanner(`Erreur suppression: ${e.message ?? e}`, "error");
      }
    });

    ui.list.appendChild(node);
  }
}

async function refresh() {
  clearBanner();
  const user = await getUser();
  if (!user) return;

  // Try multi-list mode if migration exists
  const hasLists = await loadLists();

  // Preferred query (lists + tags)
  try {
    let q = supabase
      .from("todos")
      .select(
        "id, title, done, inserted_at, list_id, created_by_email, todo_todo_tags(todo_tags(name))",
      )
      .order("inserted_at", { ascending: false });

    if (hasLists && state.selectedListId) {
      q = q.eq("list_id", state.selectedListId);
    }

    const { data, error } = await q;
    if (error) throw error;
    renderTodos(data ?? []);
    return;
  } catch (e) {
    // Fallback for partial migrations / PostgREST relationship hiccups
    // (e.g. missing table / relationship cache not updated yet)
    const msg = e?.message ?? String(e);
    console.warn("refresh(primary) failed:", e);

    const { data, error } = await supabase
      .from("todos")
      .select("id, title, done, inserted_at")
      .order("inserted_at", { ascending: false });

    if (error) throw error;
    renderTodos(data ?? []);

    setBanner(
      `Mode compat: tags/listes pas encore disponibles (${msg}). Rafraîchis dans 1-2 min si tu viens d'appliquer le SQL.`,
      "error",
    );
  }
}

function colorFromId(id) {
  // deterministic nice colors
  const palette = [
    "#10b981", // emerald
    "#3b82f6", // blue
    "#a855f7", // purple
    "#f59e0b", // amber
    "#ef4444", // red
    "#06b6d4", // cyan
    "#f97316", // orange
    "#22c55e", // green
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function ensureCursorEl(key) {
  if (!ui.cursorLayer) return null;
  let el = ui.cursorLayer.querySelector(`[data-cursor-key="${key}"]`);
  if (el) return el;

  el = document.createElement("div");
  el.dataset.cursorKey = key;
  el.style.position = "absolute";
  el.style.left = "0px";
  el.style.top = "0px";
  el.style.transform = "translate(-9999px, -9999px)";
  el.style.zIndex = "1";
  el.style.willChange = "transform";
  el.style.transition = "transform 80ms linear";

  el.innerHTML = `
    <div style="display:flex; align-items:flex-start; gap:8px;">
      <div data-dot style="width:10px;height:10px;border-radius:999px;background:#10b981;box-shadow:0 0 0 4px rgba(16,185,129,.18)"></div>
      <div style="display:flex; flex-direction:column; gap:2px;">
        <div data-arrow style="width:0;height:0;border-left:10px solid #10b981;border-top:10px solid transparent;border-bottom:10px solid transparent; filter: drop-shadow(0 2px 6px rgba(0,0,0,.25));"></div>
        <div data-label style="font-size:11px; line-height:1; padding:6px 8px; border-radius:12px; background:rgba(255,255,255,.9); border:1px solid rgba(228,228,231,.9); color:#111827; box-shadow:0 10px 25px rgba(0,0,0,.10); max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></div>
      </div>
    </div>
  `;

  ui.cursorLayer.appendChild(el);
  return el;
}

function renderCursors(selfId) {
  if (!ui.cursorLayer) return;

  for (const [key, info] of cursorState.entries()) {
    if (key === selfId) continue;
    const el = ensureCursorEl(key);
    if (!el) continue;

    const x = Math.max(0, Math.min(window.innerWidth, info.x ?? 0));
    const y = Math.max(0, Math.min(window.innerHeight, info.y ?? 0));
    el.style.transform = `translate(${x}px, ${y}px)`;

    const color = info.color || "#10b981";
    const dot = el.querySelector("[data-dot]");
    const arrow = el.querySelector("[data-arrow]");
    const label = el.querySelector("[data-label]");
    if (dot) {
      dot.style.background = color;
      dot.style.boxShadow = `0 0 0 4px ${color}2a`;
    }
    if (arrow) {
      arrow.style.borderLeftColor = color;
    }
    if (label) {
      label.textContent = info.email || "(email inconnu)";
    }
  }

  // Remove stale DOM nodes
  const nodes = Array.from(ui.cursorLayer.querySelectorAll("[data-cursor-key]"));
  for (const n of nodes) {
    const k = n.getAttribute("data-cursor-key");
    if (!k) continue;
    if (k === selfId) {
      n.remove();
      continue;
    }
    if (!cursorState.has(k)) n.remove();
  }
}

function startMouseTracking(selfId, email) {
  const color = colorFromId(selfId);

  let lastSent = 0;
  const sendEveryMs = 33; // ~30fps

  function onMove(e) {
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;

    // throttle via rAF + max send rate
    if (cursorRaf) return;
    cursorRaf = requestAnimationFrame(async () => {
      cursorRaf = null;
      if (!cursorChannel) return;

      const now = performance.now();
      if (now - lastSent < sendEveryMs) return;
      lastSent = now;

      try {
        // fast path: broadcast cursor position
        await cursorChannel.send({
          type: "broadcast",
          event: "cursor",
          payload: { id: selfId, x: lastMouse.x, y: lastMouse.y },
        });
      } catch {
        // ignore
      }
    });
  }

  window.addEventListener("mousemove", onMove);

  return () => {
    window.removeEventListener("mousemove", onMove);
    if (cursorRaf) cancelAnimationFrame(cursorRaf);
    cursorRaf = null;
  };
}

let stopMouseTracking = null;

async function startCursors(user) {
  if (cursorChannel) return;

  // Presence is good for "who is online", but track() updates can be slow.
  // For smooth cursor movement, we use broadcast events for position,
  // and presence only for join/leave + identity.
  cursorChannel = supabase.channel("cursors", {
    config: {
      presence: { key: user.id },
      broadcast: { self: false },
    },
  });

  cursorChannel
    .on("presence", { event: "sync" }, () => {
      const st = cursorChannel.presenceState();
      // Keep existing positions; just ensure we know who exists.
      for (const key of Object.keys(st || {})) {
        if (!cursorState.has(key)) cursorState.set(key, { x: -9999, y: -9999 });
      }
      // Remove those no longer present
      for (const key of Array.from(cursorState.keys())) {
        if (!(st && st[key])) cursorState.delete(key);
      }
      renderCursors(user.id);
    })
    .on("presence", { event: "join" }, ({ key, newPresences }) => {
      const last = (newPresences || []).slice(-1)[0] || {};
      cursorState.set(key, {
        ...(cursorState.get(key) || {}),
        email: last.email,
        color: last.color,
      });
      renderCursors(user.id);
    })
    .on("presence", { event: "leave" }, ({ key }) => {
      cursorState.delete(key);
      renderCursors(user.id);
    })
    .on("broadcast", { event: "cursor" }, ({ payload }) => {
      const { id, x, y } = payload || {};
      if (!id || id === user.id) return;
      const prev = cursorState.get(id) || {};
      cursorState.set(id, { ...prev, x, y });
      renderCursors(user.id);
    });

  await cursorChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      stopMouseTracking = startMouseTracking(user.id, user.email);
      // presence identity
      await cursorChannel.track({ email: user.email, color: colorFromId(user.id), t: Date.now() });
    }
  });
}

async function stopCursors() {
  try {
    stopMouseTracking?.();
    stopMouseTracking = null;
    cursorState.clear();
    if (ui.cursorLayer) ui.cursorLayer.innerHTML = "";
    if (cursorChannel) {
      await cursorChannel.unsubscribe();
      cursorChannel = null;
    }
  } catch {
    // ignore
  }
}

async function startPresence(user) {
  // Presence: shows a toast when another user is online (connects)
  // Privacy: we do NOT display email; only "un utilisateur".
  // Requires Supabase Realtime enabled (default) + websocket access.
  if (presenceChannel) return;

  presenceChannel = supabase.channel("presence:online", {
    config: {
      presence: { key: user.id },
    },
  });

  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      const ids = new Set(Object.keys(state || {}));
      lastPresenceSet = ids;
    })
    .on("presence", { event: "join" }, ({ key }) => {
      // join fires also for self in some cases; ignore if it's our own key
      if (key && key !== user.id) {
        showToast("👀", "Un autre utilisateur vient de se connecter.", "info", 5000);
      }
    })
    .on("presence", { event: "leave" }, ({ key }) => {
      if (key && key !== user.id) {
        showToast("Info", "Un utilisateur vient de se déconnecter.", "info", 3500);
      }
    });

  const { error } = await presenceChannel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await presenceChannel.track({ online_at: new Date().toISOString() });
    }
  });

  if (error) {
    console.warn("presence subscribe error", error);
  }
}

async function stopPresence() {
  try {
    if (presenceChannel) {
      await presenceChannel.unsubscribe();
      presenceChannel = null;
      lastPresenceSet = new Set();
    }
  } catch {
    // ignore
  }
}

async function startTodosRealtime() {
  if (todosRealtimeChannel) return;

  todosRealtimeChannel = supabase
    .channel("realtime:todos")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "todos" },
      () => scheduleRefresh(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "todo_todo_tags" },
      () => scheduleRefresh(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "todo_lists" },
      () => scheduleRefresh(),
    )
    .subscribe();
}

async function stopTodosRealtime() {
  try {
    if (todosRealtimeChannel) {
      await todosRealtimeChannel.unsubscribe();
      todosRealtimeChannel = null;
    }
  } catch {
    // ignore
  }
}

async function setSignedInUI(user) {
  ui.auth.classList.add("hidden");
  ui.app.classList.remove("hidden");
  ui.btnLogout.classList.remove("hidden");
  ui.whoami.textContent = `Connecté: ${user.email}`;

  try {
    await startPresence(user);
    await startTodosRealtime();
    await startCursors(user);
    await refresh();
  } catch (e) {
    setBanner(`Erreur refresh: ${e.message ?? e}`, "error");
  }
}

function setSignedOutUI() {
  ui.app.classList.add("hidden");
  ui.btnLogout.classList.add("hidden");
  ui.auth.classList.remove("hidden");
}

ui.btnLogout.addEventListener("click", async () => {
  await stopCursors();
  await stopTodosRealtime();
  await stopPresence();
  await supabase.auth.signOut();
  setSignedOutUI();
  setBanner("Déconnecté.", "success");
});

ui.btnRefresh.addEventListener("click", async () => {
  try {
    await refresh();
    setBanner("Rafraîchi.", "success");
    setTimeout(clearBanner, 1200);
  } catch (e) {
    setBanner(`Erreur refresh: ${e.message ?? e}`, "error");
  }
});

ui.listSelect?.addEventListener("change", async () => {
  state.selectedListId = ui.listSelect.value || null;
  localStorage.setItem("selectedListId", state.selectedListId || "");
  await refresh();
});

function openModal() {
  if (!ui.modal) return;
  ui.modal.classList.remove("hidden");
  ui.modalListName && (ui.modalListName.value = "");
  setTimeout(() => ui.modalListName?.focus(), 50);
}

function closeModal() {
  ui.modal?.classList.add("hidden");
}

ui.modalClose?.addEventListener("click", closeModal);
ui.modalCancel?.addEventListener("click", closeModal);
ui.modal?.addEventListener("click", (e) => {
  if (e.target === ui.modal) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

async function createListFromModal() {
  const name = (ui.modalListName?.value || "").trim();
  if (!name) {
    showToast("Oups", "Donne un nom à la liste.", "error", 2500);
    return;
  }

  const { data, error } = await supabase
    .from("todo_lists")
    .insert({ name })
    .select("id, name")
    .single();

  if (error) throw error;

  state.selectedListId = data.id;
  await loadLists();
  showToast("Liste créée", `“${data.name}”`, "success", 2200);
  await refresh();
  closeModal();
}

ui.modalCreate?.addEventListener("click", async () => {
  try {
    await createListFromModal();
  } catch (e) {
    showToast("Erreur", `Création liste: ${e.message ?? e}`, "error", 5000);
  }
});

ui.btnNewList?.addEventListener("click", async () => {
  try {
    clearBanner();
    openModal();
  } catch (e) {
    setBanner(`Erreur: ${e.message ?? e}`, "error");
  }
});

ui.todoForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = (ui.todoText.value || "").trim();
  if (!title) return;

  try {
    const user = await getUser();
    if (!user) {
      setBanner("Tu n'es pas connecté.", "error");
      return;
    }

    // Ensure list exists (best-effort)
    const firstList = await ensureDefaultList();
    if (firstList && !state.selectedListId) state.selectedListId = firstList.id;

    const list_id = state.selectedListId || null;

    // 1) Insert todo
    const { data: todo, error } = await supabase
      .from("todos")
      .insert({ title, list_id })
      .select("id")
      .single();
    if (error) throw error;

    // 2) Upsert tags + join (optional)
    const tags = parseTags(ui.todoTags?.value || "");
    if (tags.length > 0) {
      // Create missing tags
      const { data: tagRows, error: tagErr } = await supabase
        .from("todo_tags")
        .upsert(
          tags.map((name) => ({ name })),
          { onConflict: "name" },
        )
        .select("id, name");

      if (!tagErr && (tagRows?.length ?? 0) > 0) {
        const joins = tagRows.map((t) => ({ todo_id: todo.id, tag_id: t.id }));
        const { error: joinErr } = await supabase
          .from("todo_todo_tags")
          .insert(joins);
        if (joinErr) throw joinErr;
      }
      // If tag tables are not present yet, ignore silently.
    }

    ui.todoText.value = "";
    if (ui.todoTags) ui.todoTags.value = "";
    await refresh();
  } catch (e2) {
    setBanner(`Erreur ajout: ${e2.message ?? e2}`, "error");
  }
});

ui.btnClearDone.addEventListener("click", async () => {
  try {
    let q = supabase.from("todos").delete().eq("done", true);
    const hasLists = (state.lists?.length ?? 0) > 0;
    if (hasLists && state.selectedListId) q = q.eq("list_id", state.selectedListId);
    const { error } = await q;
    if (error) throw error;
    await refresh();
  } catch (e) {
    setBanner(`Erreur suppression terminées: ${e.message ?? e}`, "error");
  }
});

ui.authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearBanner();

  const email = (ui.email.value || "").trim();
  const password = ui.password.value || "";

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    setBanner("Connecté.", "success");
    await setSignedInUI(data.user);
    setTimeout(clearBanner, 1200);
  } catch (err) {
    setBanner(`Erreur connexion: ${err.message ?? err}`, "error");
  }
});

ui.btnSignup.addEventListener("click", async () => {
  clearBanner();

  const email = (ui.email.value || "").trim();
  const password = ui.password.value || "";

  if (!email || !password) {
    setBanner("Entre un email + mot de passe (min 6 caractères).", "error");
    return;
  }

  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;

    // If email confirmation is enabled, user might be null until they click email.
    if (data.user) {
      setBanner("Compte créé et connecté.", "success");
      await setSignedInUI(data.user);
    } else {
      setBanner("Compte créé. Vérifie ton email pour confirmer, puis reconnecte-toi.", "success");
      setSignedOutUI();
    }
  } catch (err) {
    setBanner(`Erreur création: ${err.message ?? err}`, "error");
  }
});

// Init
(async function init() {
  try {
    // Restore last selected list
    const savedListId = (localStorage.getItem("selectedListId") || "").trim();
    if (savedListId) state.selectedListId = savedListId;

    renderTagsPreview();

    const user = await getUser();
    if (user) {
      await setSignedInUI(user);
    } else {
      setSignedOutUI();
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await setSignedInUI(session.user);
      } else {
        await stopCursors();
        await stopTodosRealtime();
        await stopPresence();
        setSignedOutUI();
      }
    });
  } catch (e) {
    setBanner(`Erreur init: ${e.message ?? e}`, "error");
    setSignedOutUI();
  }
})();

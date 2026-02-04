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
  list: $("todo-list"),
  empty: $("empty"),
  tpl: $("todo-item"),
};

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
    const li = node.querySelector("li");
    const cb = node.querySelector(".todo-toggle");
    const text = node.querySelector(".todo-text");
    const del = node.querySelector(".todo-del");

    text.textContent = t.title;
    cb.checked = !!t.done;
    if (t.done) {
      text.classList.add("line-through", "text-zinc-400", "dark:text-zinc-500");
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

  const { data, error } = await supabase
    .from("todos")
    .select("id, title, done, inserted_at")
    .order("inserted_at", { ascending: false });

  if (error) throw error;
  renderTodos(data ?? []);
}

async function setSignedInUI(user) {
  ui.auth.classList.add("hidden");
  ui.app.classList.remove("hidden");
  ui.btnLogout.classList.remove("hidden");
  ui.whoami.textContent = `Connecté: ${user.email}`;
  await refresh();
}

function setSignedOutUI() {
  ui.app.classList.add("hidden");
  ui.btnLogout.classList.add("hidden");
  ui.auth.classList.remove("hidden");
}

ui.btnLogout.addEventListener("click", async () => {
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

    const { error } = await supabase.from("todos").insert({ title });
    if (error) throw error;

    ui.todoText.value = "";
    await refresh();
  } catch (e2) {
    setBanner(`Erreur ajout: ${e2.message ?? e2}`, "error");
  }
});

ui.btnClearDone.addEventListener("click", async () => {
  try {
    const { error } = await supabase.from("todos").delete().eq("done", true);
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
        setSignedOutUI();
      }
    });
  } catch (e) {
    setBanner(`Erreur init: ${e.message ?? e}`, "error");
    setSignedOutUI();
  }
})();

/* VocabQuest accounts and subscriptions.
   Login is handled by Supabase, payment by Stripe Checkout (through the /api functions).
   Loaded before the main app script; the main script calls VQ_BOOT() when it is ready. */
(function () {
  "use strict";
  const C = window.VQ_CONFIG || {};
  const ENABLED = !!(C.supabaseUrl && C.supabaseAnonKey && !/YOUR_/.test(C.supabaseUrl + C.supabaseAnonKey));
  const API = (C.apiBase || "/api").replace(/\/$/, "");
  const PRICES = C.prices || { monthly: { amount: 0.99, label: "£0.99", per: "month" }, annual: { amount: 10, label: "£10", per: "year" } };
  const ACTIVE = ["active", "trialing"];

  let sb = null, session = null, sub = null;
  let phase = "loading";          // loading | offline | auth | paywall | confirming | app
  let authMode = "login";         // login | signup | forgot | reset | check-email
  let msg = "", msgKind = "info", busy = false;
  let plan = "annual", gateFor = null, gateQ = null, gateErr = "";
  let returning = false, recoveryPending = false, loadToken = 0, syncTimer = null;
  let appRender = null, appSave = null;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    json(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const e = (s) => (typeof esc === "function" ? esc(s) : String(s));
  const isActive = () => !!(sub && ACTIVE.includes(sub.status));
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); } catch (_) { return ""; } };

  /* ---------- styles ---------- */
  const css = `
  .acc-hero{display:flex;flex-direction:column;gap:6px;padding-top:6px}
  .acc-hero h1{font-size:clamp(1.6rem,5vw,2.1rem)}
  .acc-hero p{margin:0;max-width:52ch}
  .acc-card{display:flex;flex-direction:column;gap:14px;max-width:460px}
  .acc-card h2{font-size:1.35rem}
  .acc-tabs{display:flex;gap:4px;background:var(--sunk);padding:4px;border-radius:12px}
  .acc-tabs button{flex:1;border:0;background:transparent;padding:8px;border-radius:9px;font-weight:800;color:var(--muted)}
  .acc-tabs button[aria-pressed="true"]{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
  .acc-form{display:flex;flex-direction:column;gap:12px}
  .acc-form label{display:flex;flex-direction:column;gap:6px;font-weight:700}
  .acc-form input{padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);font:inherit;color:var(--ink)}
  .acc-msg{border-radius:12px;padding:10px 14px;font-weight:600;font-size:.92rem;margin:0}
  .acc-msg.info{background:var(--accent-soft);color:var(--accent)}
  .acc-msg.error{background:var(--bad-soft);color:var(--bad)}
  .acc-msg.ok{background:var(--good-soft);color:var(--good)}
  .linkbtn{border:0;background:none;padding:0;color:var(--accent);font-weight:800;text-decoration:underline;cursor:pointer;font:inherit}
  .acc-plans{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:560px}
  .acc-plan{position:relative;text-align:left;border:2px solid var(--line);background:var(--surface);border-radius:16px;padding:18px 16px;display:flex;flex-direction:column;gap:4px;min-width:0}
  .acc-plan[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  .acc-plan .pname{font-weight:800;text-transform:uppercase;letter-spacing:1px;font-size:.78rem;color:var(--muted)}
  .acc-plan .pprice{font-family:var(--display);font-size:2rem;font-weight:600;line-height:1.1}
  .acc-plan .pprice small{font-family:var(--body);font-size:.9rem;color:var(--muted);font-weight:700}
  .acc-plan .pnote{font-size:.86rem;color:var(--muted);font-weight:600}
  .acc-plan .save{position:absolute;top:-11px;right:12px;background:var(--gold);color:#3a2900;font-weight:800;font-size:.75rem;padding:3px 10px;border-radius:999px}
  .acc-list{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-weight:700}
  .acc-list li::before{content:"✓";color:var(--good);margin-right:8px}
  .acc-gate{background:var(--gold-soft);color:var(--gold-ink);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;max-width:460px}
  .acc-gate input{max-width:120px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);font:inherit;color:var(--ink)}
  .acc-account dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0}
  .acc-account dt{color:var(--muted);font-weight:700}
  .acc-account dd{margin:0;font-weight:800;min-width:0;overflow-wrap:anywhere}
  @media (max-width:560px){.acc-plans{grid-template-columns:1fr}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---------- boot ---------- */
  window.VQ_ACCOUNT = { enabled: ENABLED };
  window.VQ_BOOT = function () {
    if (!ENABLED) {
      // Setup not finished: run without login, and say so in the Parents tab.
      const plainRender = render;
      render = function () {
        plainRender();
        if (view !== "parent") return;
        const note = document.createElement("section");
        note.className = "card acc-card";
        note.innerHTML = `<h2 style="font-size:1.2rem">Login and payments are switched off</h2>
          <p style="margin:0">The login page and plans appear once your Supabase settings are added to <code>config.js</code> and the site is deployed with its payment functions. See the README for the steps.</p>`;
        document.getElementById("main").prepend(note);
      };
      save(); render(); return;
    }
    appRender = render; appSave = save;
    // Wrap the app's render and save.
    render = function () {
      const tabs = document.getElementById("tabs"), chips = document.getElementById("chips");
      if (phase !== "app") {
        tabs.hidden = true; chips.hidden = true;
        document.getElementById("main").innerHTML = gateView();
        return;
      }
      tabs.hidden = false; chips.hidden = false;
      appRender();
      if (view === "parent") injectAccount();
    };
    save = function () { appSave(); ls.set("vq-saved-at", String(Date.now())); queueSync(); };

    const q = new URLSearchParams(location.search);
    if (q.get("checkout") === "success") returning = true;
    if (q.get("checkout") === "cancel") { msg = "Payment cancelled. You can choose a plan whenever you're ready."; msgKind = "info"; }
    if (q.has("checkout")) history.replaceState(null, "", location.pathname + location.hash);
    recoveryPending = /type=recovery/.test(location.hash);

    render();
    if (typeof supabase === "undefined" || !supabase.createClient) { phase = "offline"; render(); return; }
    sb = supabase.createClient(C.supabaseUrl, C.supabaseAnonKey);
    sb.auth.onAuthStateChange((ev, s) => {
      if (ev === "PASSWORD_RECOVERY") { session = s; recoveryPending = true; phase = "auth"; authMode = "reset"; render(); return; }
      if (ev === "TOKEN_REFRESHED") { session = s; return; }
      const prev = session && session.user && session.user.id, now = s && s.user && s.user.id;
      session = s;
      if (ev === "INITIAL_SESSION" || prev !== now) setTimeout(afterSession, 0);
    });
  };

  async function afterSession() {
    const my = ++loadToken;
    if (recoveryPending) { phase = "auth"; authMode = "reset"; render(); return; }
    if (!session) {
      phase = "auth";
      if (!["check-email", "forgot", "signup"].includes(authMode)) authMode = "login";
      render(); return;
    }
    phase = "loading"; render();
    switchUser(session.user.id);
    await Promise.all([loadSub(), loadProgress()]);
    if (my !== loadToken) return;
    if (returning && !isActive()) {
      phase = "confirming"; render();
      for (let i = 0; i < 15 && !isActive() && !(sub && sub.status === "region_blocked"); i++) { await sleep(2000); await loadSub(); }
      if (my !== loadToken) return;
      if (!isActive() && !(sub && sub.status === "region_blocked")) { msg = "We haven't had confirmation from Stripe yet. If you've paid, wait a minute and refresh this page."; msgKind = "info"; }
    }
    if (isActive()) setMsg("");
    returning = false;
    phase = isActive() ? "app" : "paywall";
    render();
  }

  function switchUser(uid) {
    const last = ls.get("vq-user");
    if (last && last !== uid) { state = blank(); rebuildWords(); ensureQuest(); appSave(); ls.del("vq-saved-at"); }
    ls.set("vq-user", uid);
  }

  async function loadSub() {
    try {
      const { data, error } = await sb.from("subscriptions")
        .select("status,plan,current_period_end,cancel_at_period_end")
        .eq("user_id", session.user.id).maybeSingle();
      if (error) throw error;
      sub = data;
      ls.set("vq-sub", JSON.stringify({ uid: session.user.id, sub }));
    } catch (err) {
      const c = ls.json("vq-sub");   // offline: use the last known status
      if (c && c.uid === session.user.id) sub = c.sub;
    }
  }

  async function loadProgress() {
    try {
      const { data, error } = await sb.from("progress").select("data,updated_at").eq("user_id", session.user.id).maybeSingle();
      if (error) throw error;
      const localT = Number(ls.get("vq-saved-at")) || 0;
      if (data && data.data && typeof data.data === "object") {
        const remoteT = Date.parse(data.updated_at) || 0;
        if (remoteT >= localT) {
          state = Object.assign(blank(), data.data);
          state.extra = state.extra || []; state.level = state.level || "mixed";
          rebuildWords(); ensureQuest(); appSave();
          ls.set("vq-saved-at", String(remoteT));
        } else queueSync(0);
      } else if (localT) queueSync(0);
    } catch (err) { /* offline: keep local progress */ }
  }

  function queueSync(delay) {
    if (!sb || !session) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        const t = Number(ls.get("vq-saved-at")) || Date.now();
        await sb.from("progress").upsert({ user_id: session.user.id, data: state, updated_at: new Date(t).toISOString() });
      } catch (err) { /* will retry on next save */ }
    }, delay === undefined ? 2000 : delay);
  }

  async function api(path, body) {
    const r = await fetch(API + "/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify(body || {})
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
    return j;
  }

  /* ---------- views ---------- */
  function msgHTML() { return msg ? `<p class="acc-msg ${msgKind}" role="status">${e(msg)}</p>` : ""; }
  function hero(title, sub_) { return `<div class="acc-hero"><h1>${title}</h1><p class="muted">${sub_}</p></div>`; }
  function dis() { return busy ? "disabled" : ""; }

  function gateView() {
    if (phase === "loading") return `<section class="card acc-card"><p class="muted" style="margin:0">Loading your account…</p></section>`;
    if (phase === "offline") return hero("You're offline", "VocabQuest needs an internet connection the first time you log in. Connect and refresh the page.");
    if (phase === "confirming") return `${hero("Confirming your payment…", "This usually takes a few seconds. Please keep this page open.")}`;
    if (phase === "auth") return authView();
    return paywallView();
  }

  function authView() {
    const top = hero("Welcome to VocabQuest", "Ten minutes of word adventures every day. Grown-ups: log in or create an account to get started.");
    if (authMode === "check-email") {
      return `${top}<section class="card acc-card"><h2>Check your email</h2>${msgHTML()}<button class="btn ghost" data-acc="mode" data-m="login">Back to log in</button></section>`;
    }
    if (authMode === "forgot") {
      return `${top}<section class="card acc-card"><h2>Reset your password</h2>
        <form class="acc-form" id="accForgot"><label for="accEmail">Email<input id="accEmail" type="email" autocomplete="email" required></label>
        ${msgHTML()}<button class="btn primary" type="submit" ${dis()}>${busy ? "Sending…" : "Send reset link"}</button></form>
        <button class="linkbtn" data-acc="mode" data-m="login">Back to log in</button></section>`;
    }
    if (authMode === "reset") {
      return `${top}<section class="card acc-card"><h2>Choose a new password</h2>
        <form class="acc-form" id="accReset"><label for="accNewPw">New password<input id="accNewPw" type="password" autocomplete="new-password" minlength="8" required></label>
        ${msgHTML()}<button class="btn primary" type="submit" ${dis()}>${busy ? "Saving…" : "Save password"}</button></form></section>`;
    }
    const signup = authMode === "signup";
    return `${top}<section class="card acc-card">
      <div class="acc-tabs" role="group" aria-label="Account"><button data-acc="mode" data-m="login" aria-pressed="${!signup}">Log in</button><button data-acc="mode" data-m="signup" aria-pressed="${signup}">Create account</button></div>
      <form class="acc-form" id="accAuth">
        <label for="accEmail">Email<input id="accEmail" type="email" autocomplete="email" required></label>
        <label for="accPw">Password<input id="accPw" type="password" autocomplete="${signup ? "new-password" : "current-password"}" ${signup ? 'minlength="8"' : ""} required></label>
        ${signup ? `<span class="muted small">At least 8 characters. Accounts are for parents and carers.</span>` : ""}
        ${msgHTML()}
        <button class="btn primary big" type="submit" ${dis()}>${busy ? "Please wait…" : signup ? "Create account" : "Log in"}</button>
      </form>
      ${signup ? "" : `<button class="linkbtn" style="align-self:flex-start" data-acc="mode" data-m="forgot">Forgot your password?</button>`}
    </section>`;
  }

  function planCard(key, title, note, badge) {
    const p = PRICES[key];
    return `<button class="acc-plan" data-acc="plan" data-p="${key}" aria-pressed="${plan === key}">
      ${badge ? `<span class="save">${badge}</span>` : ""}
      <span class="pname">${title}</span>
      <span class="pprice">${e(p.label)} <small>/ ${e(p.per)}</small></span>
      <span class="pnote">${note}</span></button>`;
  }

  function gateHTML(action) {
    if (!gateQ) { const a = 6 + Math.floor(Math.random() * 7), b = 3 + Math.floor(Math.random() * 7); gateQ = { a, b }; }
    return `<form class="acc-gate" id="accGateForm"><b>Grown-ups only</b>
      <label for="accGate" style="display:flex;flex-direction:column;gap:6px;font-weight:700">What is ${gateQ.a} × ${gateQ.b}?<input id="accGate" inputmode="numeric" autocomplete="off" required></label>
      ${gateErr ? `<span class="small" style="font-weight:700">${e(gateErr)}</span>` : ""}
      <div class="row"><button class="btn primary" type="submit" ${dis()}>${busy ? "Opening Stripe…" : action}</button><button class="btn ghost" type="button" data-acc="gate-cancel">Cancel</button></div></form>`;
  }

  function paywallView() {
    const blocked = sub && sub.status === "region_blocked";
    const lapsed = !blocked && sub && sub.status && !ACTIVE.includes(sub.status) && sub.status !== "incomplete";
    const m = PRICES.monthly.amount, y = PRICES.annual.amount, saving = Math.max(0, m * 12 - y);
    return `${hero(lapsed ? "Your plan has ended" : "Choose your plan", lapsed ? "Pick a plan to carry on where you left off. Your progress is saved." : "Unlock every quest and keep your progress safe across devices.")}
      ${blocked ? `<p class="acc-msg error" role="status">VocabQuest is only available in the UK at the moment, so that payment was cancelled and fully refunded. If you live in the UK, please try again with your UK billing address and a UK card.</p>` : msgHTML()}
      <div class="acc-plans">
        ${planCard("monthly", "Monthly", "Billed every month. Cancel any time.")}
        ${planCard("annual", "Annual", `Billed once a year. Works out at £${(y / 12).toFixed(2)} a month.`, saving > 0.005 ? `Save £${saving.toFixed(2)}` : "")}
      </div>
      <ul class="acc-list"><li>20 new words every day, from 2,300+</li><li>Quizzes, revision and badges</li><li>Weekly summary for parents</li><li>Progress saved to your account</li></ul>
      ${gateFor === "pay" ? gateHTML("Continue to payment") : `<button class="btn primary big" style="align-self:flex-start" data-acc="pay">Continue to payment</button>`}
      <p class="muted small" style="margin:0;max-width:56ch"><b>Available to families in the UK.</b> You'll need a UK billing address and a UK card. Payments are handled securely by Stripe. VocabQuest never sees your card details. You can cancel any time from the Parents tab.</p>
      <p class="muted small" style="margin:0">Logged in as ${e(session.user.email || "")} · <button class="linkbtn" data-acc="logout">Log out</button></p>`;
  }

  function injectAccount() {
    const main = document.getElementById("main");
    const name = sub && sub.plan === "annual" ? `Annual · ${PRICES.annual.label} a year` : sub && sub.plan === "monthly" ? `Monthly · ${PRICES.monthly.label} a month` : "Active";
    const when = sub && sub.current_period_end ? `${sub.cancel_at_period_end ? "Ends on" : "Renews on"} ${fmtDate(sub.current_period_end)}` : "";
    const card = document.createElement("section");
    card.className = "card acc-account";
    card.style.cssText = "display:flex;flex-direction:column;gap:14px";
    card.innerHTML = `<h2 style="font-size:1.2rem">Account</h2>
      <dl><dt>Email</dt><dd>${e(session.user.email || "")}</dd><dt>Plan</dt><dd>${e(name)}</dd>${when ? `<dt>${e(when.split(" on ")[0])}</dt><dd>${e(when.split(" on ")[1])}</dd>` : ""}</dl>
      ${msgHTML()}
      ${gateFor === "portal" ? gateHTML("Manage subscription") : `<div class="row"><button class="btn ghost" data-acc="portal">Manage or cancel subscription</button><button class="btn ghost" data-acc="logout">Log out</button></div>`}`;
    main.appendChild(card);
  }

  /* ---------- actions ---------- */
  function setMsg(t, k) { msg = t; msgKind = k || "info"; }
  function friendly(err) {
    const m = (err && err.message) || "";
    if (/invalid login credentials/i.test(m)) return "That email or password isn't right.";
    if (/email not confirmed/i.test(m)) return "Please confirm your email first. Check your inbox for the link.";
    if (/already registered|already been registered/i.test(m)) return "There's already an account with that email. Try logging in.";
    if (/password should be/i.test(m)) return "Please choose a password with at least 8 characters.";
    if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a minute and try again.";
    if (/fetch|network/i.test(m)) return "Can't connect. Check your internet connection.";
    return m || "Something went wrong. Please try again.";
  }

  async function startCheckout() {
    busy = true; render();
    try { const { url } = await api("checkout", { plan }); location.assign(url); }
    catch (err) { busy = false; gateFor = null; setMsg(friendly(err), "error"); render(); }
  }
  async function openPortal() {
    busy = true; render();
    try { const { url } = await api("portal"); location.assign(url); }
    catch (err) { busy = false; gateFor = null; setMsg(friendly(err), "error"); render(); }
  }
  async function logout() {
    try { await sb.auth.signOut(); } catch (_) {}
    [KEY, "vq-user", "vq-sub", "vq-saved-at"].forEach(ls.del);
    state = blank(); rebuildWords(); ensureQuest();
    sub = null; session = null; gateFor = null; setMsg("", "info"); authMode = "login"; phase = "auth"; view = "home"; render();
  }

  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-acc]"); if (!t || !ENABLED) return;
    const a = t.dataset.acc;
    if (a === "mode") { authMode = t.dataset.m; setMsg(""); render(); }
    else if (a === "plan") { plan = t.dataset.p; render(); }
    else if (a === "pay") { gateFor = "pay"; gateQ = null; gateErr = ""; setMsg(""); render(); const i = document.getElementById("accGate"); if (i) i.focus(); }
    else if (a === "portal") { gateFor = "portal"; gateQ = null; gateErr = ""; setMsg(""); render(); const i = document.getElementById("accGate"); if (i) i.focus(); }
    else if (a === "gate-cancel") { gateFor = null; render(); }
    else if (a === "logout") { logout(); }
  });

  document.addEventListener("submit", async (ev) => {
    const f = ev.target; if (!ENABLED || !f.id || f.id.indexOf("acc") !== 0) return;
    ev.preventDefault(); if (busy) return;
    if (f.id === "accGateForm") {
      const v = Number(document.getElementById("accGate").value.trim());
      if (v !== gateQ.a * gateQ.b) { gateErr = "That's not quite right. Please ask a grown-up."; gateQ = null; render(); return; }
      const what = gateFor; gateErr = "";
      if (what === "pay") startCheckout(); else if (what === "portal") openPortal();
      return;
    }
    const email = (document.getElementById("accEmail") || {}).value;
    busy = true; setMsg(""); render();
    try {
      if (f.id === "accAuth") {
        const password = ev.target.querySelector("#accPw").value;
        if (authMode === "signup") {
          const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
          if (error) throw error;
          if (!data.session) { authMode = "check-email"; setMsg(`We've sent a link to ${email}. Open it to confirm your account, then come back and log in.`, "info"); }
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
      } else if (f.id === "accForgot") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (error) throw error;
        authMode = "check-email"; setMsg(`If there's an account for ${email}, we've sent a link to reset the password.`, "info");
      } else if (f.id === "accReset") {
        const { error } = await sb.auth.updateUser({ password: document.getElementById("accNewPw").value });
        if (error) throw error;
        recoveryPending = false; history.replaceState(null, "", location.pathname);
        setMsg("Password updated.", "ok"); busy = false; afterSession(); return;
      }
    } catch (err) { setMsg(friendly(err), "error"); }
    busy = false; render();
  });
})();

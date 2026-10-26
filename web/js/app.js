/* عزم ماركت — مركز التحكم وشاشة الكاشير */
(function () {
  const A = window.AZM;
  const { sb, $, $$, esc, money, num, STATUS, ROLES, ACTIVE, toast } = A;
  const app = $("#app");

  const S = {
    me: null, branches: [], staff: [], orders: new Map(), route: "live",
    filter: { branch: "", q: "" }, muted: false, seen: new Set(), channel: null,
    maps: {}, lastLoad: 0, radius: 5,
  };
  const isAdmin = () => S.me?.role === "admin";
  const branchName = (id) => S.branches.find((b) => b.id === id)?.name || "بدون فرع";
  const staffName = (id) => S.staff.find((p) => p.id === id)?.full_name || "—";
  const drivers = (branchId) => S.staff.filter((p) => p.role === "driver" && p.is_active && (!branchId || p.branch_id === branchId));
  const activeCountFor = (driverId) => [...S.orders.values()].filter((o) => o.driver_id === driverId && ["assigned", "out_for_delivery"].includes(o.status)).length;

  // =================================================================== boot
  async function boot() {
    A.unlockAudio();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return renderLogin();
    try {
      S.me = await A.myProfile();
    } catch (e) { toast(A.errMsg(e), "error"); return renderLogin(); }
    if (!S.me) { await sb.auth.signOut(); return renderLogin("الحساب غير مفعّل"); }
    if (!S.me.is_active) { await sb.auth.signOut(); return renderLogin("الحساب موقوف"); }
    if (S.me.role === "driver") { location.href = "driver.html"; return; }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    renderShell();
    await Promise.all([loadBranches(), loadStaff(), loadRadius()]);
    await loadOrders();
    subscribe();
    route();
    window.addEventListener("hashchange", route);
    setInterval(() => { if (S.route === "live") renderLive(true); }, 30000);
    setInterval(() => loadOrders().then(() => S.route === "live" && renderLive(true)), 90000);
  }

  // =================================================================== login
  async function renderLogin(msg) {
    app.innerHTML = `<div class="login-page"><form class="login-card" id="login-form">
      <div class="logo"><div class="logo-mark">ع</div><div>عزم ماركت<div class="small muted" style="font-weight:600">نظام توزيع الطلبات</div></div></div>
      <div style="height:22px"></div>
      ${msg ? `<p class="chip chip-warn">${esc(msg)}</p>` : ""}
      <div id="boot-area"></div>
      <label class="field"><span>اسم المستخدم</span><input name="u" autocomplete="username" required dir="ltr"></label>
      <label class="field"><span>كلمة المرور</span><input name="p" type="password" autocomplete="current-password" required dir="ltr"></label>
      <button class="btn btn-primary btn-block btn-lg" type="submit">دخول</button>
      <p class="small muted" style="text-align:center;margin-top:16px">المندوب؟ <a href="driver.html">افتح تطبيق المندوب</a></p>
    </form></div>`;
    $("#login-form").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, btn = $("button[type=submit]", f);
      btn.disabled = true;
      try { await A.login(f.u.value, f.p.value); location.reload(); }
      catch (err) { toast(A.errMsg(err), "error"); btn.disabled = false; }
    };
    // أول تشغيل: إنشاء حساب المدير
    try {
      const r = await A.callFn("admin", { action: "bootstrap_status" });
      if (r.needs_bootstrap) renderBootstrap();
    } catch (_) {}
  }

  function renderBootstrap() {
    app.innerHTML = `<div class="login-page"><form class="login-card" id="boot-form">
      <div class="logo"><div class="logo-mark">ع</div>عزم ماركت</div>
      <h3 style="margin-top:18px">مرحباً 👋 إنشاء حساب المدير</h3>
      <p class="muted small">هذه الخطوة تظهر مرة واحدة فقط عند أول تشغيل للنظام.</p>
      <label class="field"><span>الاسم</span><input name="n" required></label>
      <label class="field"><span>اسم المستخدم (إنجليزي)</span><input name="u" required dir="ltr" pattern="[a-zA-Z0-9._-]{3,32}"></label>
      <label class="field"><span>كلمة المرور</span><input name="p" type="password" minlength="6" required dir="ltr"></label>
      <button class="btn btn-primary btn-block btn-lg">إنشاء الحساب والدخول</button>
    </form></div>`;
    $("#boot-form").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await A.callFn("admin", { action: "bootstrap", full_name: f.n.value, username: f.u.value, password: f.p.value });
        await A.login(f.u.value, f.p.value);
        location.reload();
      } catch (err) { toast(A.errMsg(err), "error"); }
    };
  }

  // =================================================================== shell
  const NAV = [
    { id: "live", icon: "📋", label: "الطلبات الحالية" },
    { id: "map", icon: "🗺️", label: "الخريطة المباشرة" },
    { id: "orders", icon: "🗂️", label: "سجل الطلبات" },
    { id: "reports", icon: "📊", label: "التقارير" },
    { id: "staff", icon: "👥", label: "الموظفين والمناديب" },
    { id: "routing", icon: "🎯", label: "نطاق التوصيل", admin: true },
    { id: "branches", icon: "🏪", label: "الفروع", admin: true },
    { id: "settings", icon: "⚙️", label: "الربط مع زد والإعدادات", admin: true },
  ];

  function renderShell() {
    app.innerHTML = `<div class="shell">
      <aside class="side" id="side">
        <div class="logo"><div class="logo-mark">ع</div><div>عزم ماركت<div class="small" style="opacity:.7;font-weight:600">${isAdmin() ? "مركز التحكم" : esc(S.me.branch?.name || "")}</div></div></div>
        <nav class="nav">${NAV.filter((n) => !n.admin || isAdmin()).map((n) =>
          `<a href="#${n.id}" data-r="${n.id}"><span>${n.icon}</span>${n.label}${n.id === "live" ? `<span class="count hidden" id="nav-count"></span>` : ""}</a>`).join("")}</nav>
        <div class="side-foot">
          <div><b>${esc(S.me.full_name)}</b> · ${ROLES[S.me.role]}</div>
          <div class="row" style="margin-top:8px">
            <button class="btn btn-sm" id="mute-btn">🔔 الصوت مفعل</button>
            <button class="btn btn-sm" id="logout-btn">خروج</button>
          </div>
          <button class="btn btn-sm btn-block hidden" id="install-btn" style="margin-top:8px;background:#14b8a6;color:#04201d;border:0">💻 تثبيت كتطبيق على الجهاز</button>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <button class="icon-btn menu-btn" id="menu-btn" aria-label="القائمة">☰</button>
          <h2 id="page-title"></h2>
          <div class="spacer"></div>
          <div id="top-actions" class="row"></div>
        </div>
        <div class="content" id="view"></div>
      </main>
    </div>`;
    $("#logout-btn").onclick = A.logout;
    setupInstall();
    $("#menu-btn").onclick = () => $("#side").classList.toggle("open");
    $("#mute-btn").onclick = (e) => {
      S.muted = !S.muted;
      e.target.textContent = S.muted ? "🔕 الصوت مكتوم" : "🔔 الصوت مفعل";
      if (S.muted) A.stopAlarm(); else A.playSound("order");
    };
    $$(".nav a").forEach((a) => a.addEventListener("click", () => $("#side").classList.remove("open")));
  }

  // تثبيت لوحة التحكم كتطبيق (ويندوز / ماك / أندرويد)
  let installEvt = window.__azmInstallEvt || null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("#install-btn")?.classList.remove("hidden"); });
  window.addEventListener("appinstalled", () => { $("#install-btn")?.classList.add("hidden"); toast("تم تثبيت التطبيق ✅ تلقاه في قائمة ابدأ وسطح المكتب", "ok", 6000); });
  function setupInstall() {
    const btn = $("#install-btn"); if (!btn) return;
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return;
    btn.classList.remove("hidden");
    btn.onclick = async () => {
      if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice; if (r.outcome === "accepted") btn.classList.add("hidden"); installEvt = null; return; }
      A.modal({ title: "💻 تثبيت لوحة التحكم كتطبيق", body: `
        <p class="lead">خلّ لوحة التحكم تفتح كتطبيق مستقل على الويندوز بأيقونة على سطح المكتب:</p>
        <ol style="line-height:2">
          <li>افتح هذا الموقع في متصفح <b>Google Chrome</b> أو <b>Microsoft Edge</b>.</li>
          <li>اضغط أيقونة التثبيت <b>⊕</b> في آخر شريط العنوان (يمين الرابط)<br>أو من القائمة <b>⋮</b> ← <b>حفظ ومشاركة</b> ← <b>تثبيت الصفحة كتطبيق</b>.</li>
          <li>اضغط <b>تثبيت</b> — بيطلع لك التطبيق في قائمة ابدأ وسطح المكتب، وتقدر تثبّته في شريط المهام.</li>
        </ol>
        <p class="small muted">💡 لكل فرع: ثبّت التطبيق على جهاز الكاشير وسجّل دخول بحساب الفرع.</p>` });
    };
  }

  function setTitle(t, actionsHtml = "") {
    $("#page-title").textContent = t;
    $("#top-actions").innerHTML = actionsHtml;
    document.title = `${t} — عزم ماركت`;
  }

  function route() {
    const r = (location.hash || "#live").slice(1).split("?")[0];
    const item = NAV.find((n) => n.id === r && (!n.admin || isAdmin())) || NAV[0];
    S.route = item.id;
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.r === item.id));
    Object.values(S.maps).forEach((m) => { try { m.remove(); } catch (_) {} });
    S.maps = {};
    ({ live: renderLive, map: renderMap, orders: renderOrders, reports: renderReports, staff: renderStaff, routing: renderRouting, branches: renderBranches, settings: renderSettings })[item.id]();
  }

  // =================================================================== data
  async function loadBranches() {
    const { data, error } = await sb.from("branches").select("*").order("id");
    if (error) return toast(A.errMsg(error), "error");
    S.branches = data;
  }
  async function loadRadius() {
    try { S.radius = Number(await A.rpc("get_route_radius")) || 5; } catch (_) {}
  }
  const branchRadius = (b) => (b?.max_radius_km != null ? Number(b.max_radius_km) : S.radius);
  async function loadStaff() {
    const { data, error } = await sb.from("profiles").select("*").order("role").order("full_name");
    if (error) return toast(A.errMsg(error), "error");
    S.staff = data;
  }
  async function loadOrders() {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { data, error } = await sb.from("orders").select("*")
      .or(`status.in.(${ACTIVE.join(",")}),updated_at.gte.${since.toISOString()}`)
      .order("order_created_at", { ascending: false }).limit(600);
    if (error) return toast(A.errMsg(error), "error");
    const first = S.lastLoad === 0;
    S.orders = new Map(data.map((o) => [o.id, o]));
    if (first) data.forEach((o) => S.seen.add(o.id));
    else {
      // طلبات جديدة وصلت أثناء انقطاع الاتصال اللحظي
      const fresh = data.filter((o) => o.status === "new" && !S.seen.has(o.id));
      fresh.forEach((o) => S.seen.add(o.id));
      if (fresh.length) {
        if (!S.muted) A.playSound("order");
        toast(`🛒 ${fresh.length} طلب جديد`, "ok", 6000);
        A.notify("🛒 طلبات جديدة", `${fresh.length} طلب جديد بانتظار التجهيز`);
      }
    }
    S.lastLoad = Date.now();
    updateNavCount();
  }

  function subscribe() {
    S.channel = sb.channel("azm-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => onOrderChange(p))
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (p) => {
        if (p.new?.id) {
          const i = S.staff.findIndex((x) => x.id === p.new.id);
          if (i >= 0) S.staff[i] = { ...S.staff[i], ...p.new }; else S.staff.push(p.new);
          if (S.route === "map") updateMapDrivers();
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") loadOrders().then(() => S.route === "live" && renderLive(true));
      });
  }

  function onOrderChange(p) {
    if (p.eventType === "DELETE") { S.orders.delete(p.old.id); }
    else {
      const o = p.new;
      const isNew = !S.orders.has(o.id) && !S.seen.has(o.id);
      S.orders.set(o.id, o);
      if (isNew && o.status === "new") {
        S.seen.add(o.id);
        if (!S.muted) A.playSound("order");
        A.notify("🛒 طلب جديد #" + (o.invoice_number || o.id), `${o.customer_name || ""} — ${branchName(o.branch_id)} — ${money(o.total)}`);
        toast(`طلب جديد #${o.invoice_number || o.id} — ${branchName(o.branch_id)}`, "ok", 6000);
        S.flash = o.id;
      }
      if (S.openOrder === o.id) openOrder(o.id, true);
    }
    updateNavCount();
    checkAlarm();
    if (S.route === "live") renderLive(true);
    if (S.route === "map") updateMapOrders();
  }

  function visibleOrders() {
    return [...S.orders.values()].filter((o) => !S.filter.branch || String(o.branch_id ?? "none") === S.filter.branch);
  }
  function updateNavCount() {
    const n = visibleOrders().filter((o) => o.status === "new").length;
    const el = $("#nav-count");
    if (el) { el.textContent = n; el.classList.toggle("hidden", !n); }
  }
  // الصوت يطلع فقط عند وصول طلب جديد (مو مستمر)
  function checkAlarm() {}

  // =================================================================== actions
  async function setStatus(id, status, note) {
    try {
      const o = await A.rpc("set_order_status", { p_order_id: id, p_status: status, p_note: note ?? null });
      S.orders.set(o.id, o);
      toast(`تم: ${STATUS[status].label}`, "ok");
      if (S.route === "live") renderLive(true);
      checkAlarm();
      return o;
    } catch (e) { toast(A.errMsg(e), "error"); }
  }

  async function dispatchOrder(id, driverId) {
    try {
      const o = await A.rpc("dispatch_order", { p_order_id: id, p_driver_id: driverId || null });
      S.orders.set(o.id, o);
      toast(`🛵 تم إرسال الطلب إلى ${staffName(o.driver_id)}`, "ok");
      if (S.route === "live") renderLive(true);
      return o;
    } catch (e) { toast(A.errMsg(e), "error"); }
  }

  function dispatchDialog(o) {
    const list = drivers(isAdmin() ? null : o.branch_id).sort((a, b) =>
      (a.branch_id === o.branch_id ? 0 : 1) - (b.branch_id === o.branch_id ? 0 : 1) || activeCountFor(a.id) - activeCountFor(b.id));
    if (!list.length) return toast("لا يوجد مناديب مسجلين — أضف مندوب من صفحة الموظفين", "error");
    const body = `<p class="muted small">اختر المندوب أو اترك النظام يختار المندوب الفاضي تلقائياً.</p>
      <label class="row" style="padding:10px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;cursor:pointer">
        <input type="radio" name="drv" value="" checked style="width:auto;min-height:auto"> <b>⚡ تلقائي — المندوب الفاضي في الفرع</b></label>
      ${list.map((d) => {
        const n = activeCountFor(d.id);
        const dist = A.haversine(d.last_lat, d.last_lon, o.lat, o.lon);
        return `<label class="row" style="padding:10px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;cursor:pointer">
        <input type="radio" name="drv" value="${d.id}" style="width:auto;min-height:auto">
        <span class="dot ${d.is_online ? "on" : ""}"></span><b>${esc(d.full_name)}</b>
        <span class="chip">${esc(branchName(d.branch_id))}</span>
        <span class="chip ${n ? "chip-cod" : "chip-paid"}">${n ? `معه ${n} طلب` : "فاضي"}</span>
        ${dist !== null ? `<span class="chip">📍 ${dist.toFixed(1)} كم من العميل</span>` : ""}
        ${d.last_battery != null ? `<span class="chip">🔋 ${d.last_battery}%</span>` : ""}
      </label>`; }).join("")}`;
    A.modal({
      title: `إرسال الطلب #${o.invoice_number || o.id} للمندوب`, body,
      actions: [
        { label: "إلغاء", cls: "btn-ghost" },
        { label: "🛵 إرسال", cls: "btn-primary", onClick: async (w) => { await dispatchOrder(o.id, $("input[name=drv]:checked", w)?.value); } },
      ],
    });
  }

  async function rerouteDialog(o) {
    const body = `<label class="field"><span>الفرع الجديد</span><select id="rr-b">${S.branches.filter((b) => b.is_active).map((b) => {
      const d = A.haversine(o.lat, o.lon, b.lat, b.lon);
      return `<option value="${b.id}" ${b.id === o.branch_id ? "selected" : ""}>${esc(b.name)}${d !== null ? ` — ${d.toFixed(1)} كم` : ""}</option>`; }).join("")}</select></label>
      <label class="field"><span>السبب (اختياري)</span><input id="rr-n" placeholder="مثال: المنتج غير متوفر في الفرع"></label>`;
    A.modal({
      title: "تحويل الطلب لفرع آخر", body,
      actions: [
        { label: "إلغاء", cls: "btn-ghost" },
        { label: "تحويل", cls: "btn-primary", onClick: async (w) => {
            const r = await A.rpc("reroute_order", { p_order_id: o.id, p_branch_id: Number($("#rr-b", w).value), p_note: $("#rr-n", w).value || null });
            S.orders.set(r.id, r); toast("تم تحويل الطلب", "ok");
            if (S.route === "live") renderLive(true);
            if (S.openOrder === o.id) openOrder(o.id, true);
          } },
      ],
    });
  }

  async function cancelDialog(o) {
    const reason = await A.promptBox("إلغاء الطلب", "سبب الإلغاء", { required: true, okLabel: "إلغاء الطلب" });
    if (reason) await setStatus(o.id, "cancelled", reason);
  }

  function nextActions(o) {
    const a = [];
    switch (o.status) {
      case "new": a.push({ k: "preparing", label: "🧺 بدء التجهيز", cls: "btn-warn" }); break;
      case "preparing": a.push({ k: "ready", label: "📦 جاهز", cls: "btn-info" }); break;
      case "ready": a.push({ k: "dispatch", label: "🛵 إرسال للمندوب", cls: "btn-primary" }); break;
    }
    return a;
  }
  async function runAction(o, k) {
    if (k === "dispatch") return dispatchDialog(o);
    if (k === "cancel") return cancelDialog(o);
    if (k === "reroute") return rerouteDialog(o);
    if (k === "unassign") { if (await A.confirmBox("سحب الطلب من المندوب", "سيرجع الطلب لحالة جاهز ويمكنك إرساله لمندوب آخر.")) return setStatus(o.id, "ready", "سحب من المندوب"); return; }
    if (k === "print") return printSlip(o);
    if (k === "delivered") { if (await A.confirmBox("تأكيد التسليم", "تأكيد أن الطلب تم تسليمه للعميل؟")) return setStatus(o.id, "delivered", "تم التأكيد من الإدارة"); return; }
    return setStatus(o.id, k);
  }

  // =================================================================== live board
  function renderLive(soft) {
    if (!soft || !$("#board")) {
      setTitle(isAdmin() ? "الطلبات الحالية — كل الفروع" : `الطلبات — ${S.me.branch?.name || ""}`,
        `<button class="btn btn-primary" id="new-order-btn">➕ طلب يدوي</button>`);
      $("#view").innerHTML = `
        <div class="stats" id="live-stats"></div>
        <div class="filters">
          ${isAdmin() ? `<select id="f-branch"><option value="">كل الفروع</option>${S.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}<option value="none">⚠️ بدون فرع</option></select>` : ""}
          <input id="f-q" placeholder="🔎 بحث بالاسم أو الجوال أو رقم الطلب" style="min-width:240px">
          <span class="spacer"></span>
          <span class="small muted" id="live-updated"></span>
        </div>
        <div id="unrouted"></div>
        <div class="board" id="board"></div>
        <h3 style="margin-top:22px">✅ المكتملة اليوم</h3>
        <div class="card table-wrap" id="done-today"></div>`;
      if ($("#f-branch")) { $("#f-branch").value = S.filter.branch; $("#f-branch").onchange = (e) => { S.filter.branch = e.target.value; renderLive(true); updateNavCount(); }; }
      $("#f-q").value = S.filter.q;
      $("#f-q").oninput = (e) => { S.filter.q = e.target.value.trim(); renderLive(true); };
      $("#new-order-btn").onclick = () => manualOrderDialog();
    }
    const q = S.filter.q.toLowerCase();
    const list = visibleOrders().filter((o) => !q || [o.customer_name, o.customer_phone, o.invoice_number, String(o.id), o.district].some((x) => String(x ?? "").toLowerCase().includes(q)));
    const cols = [
      { k: ["new"], t: "🆕 جديد" },
      { k: ["preparing"], t: "🧺 قيد التجهيز" },
      { k: ["ready"], t: "📦 جاهز للإرسال" },
      { k: ["assigned", "out_for_delivery"], t: "🛵 مع المندوب" },
    ];
    const active = list.filter((o) => ACTIVE.includes(o.status));
    const unrouted = active.filter((o) => !o.branch_id);
    $("#unrouted").innerHTML = unrouted.length && isAdmin() ? `<div class="card" style="border:2px solid var(--danger);margin-bottom:14px">
      <div class="card-head"><h3>⚠️ طلبات تحتاج توجيه منك (${unrouted.length})</h3><span class="spacer"></span>
        <a class="small" href="#routing">النطاق التلقائي: ${num(S.radius, 1)} كم ✏️</a></div>
      ${unrouted.map((o) => unroutedHtml(o)).join("")}</div>` : "";
    $("#board").innerHTML = cols.map((c) => {
      const items = active.filter((o) => c.k.includes(o.status) && o.branch_id)
        .sort((a, b) => new Date(a.order_created_at) - new Date(b.order_created_at));
      return `<div class="col"><div class="col-head">${c.t}<span class="n">${items.length}</span></div>
        ${items.map((o) => cardHtml(o)).join("") || `<div class="empty">لا يوجد</div>`}</div>`;
    }).join("");

    const today = list.filter((o) => ["delivered", "cancelled"].includes(o.status)).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    $("#done-today").innerHTML = today.length ? `<table><thead><tr><th>الطلب</th><th>العميل</th><th>الفرع</th><th>المندوب</th><th>الحالة</th><th>الإجمالي</th><th>مدة التوصيل</th></tr></thead><tbody>
      ${today.map((o) => `<tr class="click" data-open="${o.id}"><td><b>#${esc(o.invoice_number || o.id)}</b></td><td>${esc(o.customer_name)}</td><td>${esc(branchName(o.branch_id))}</td>
      <td>${esc(staffName(o.driver_id))}</td><td>${A.statusBadge(o.status)}</td><td>${money(o.total)}</td>
      <td>${o.delivered_at ? Math.round((new Date(o.delivered_at) - new Date(o.received_at)) / 60000) + " د" : "—"}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">لا يوجد طلبات مكتملة اليوم بعد</div>`;

    const by = (s) => active.filter((o) => s.includes(o.status)).length;
    const deliveredToday = today.filter((o) => o.status === "delivered");
    const onlineDrivers = drivers(isAdmin() ? null : S.me.branch_id).filter((d) => d.is_online).length;
    $("#live-stats").innerHTML = `
      <div class="stat"><div class="k">طلبات جديدة</div><div class="v" style="color:${by(["new"]) ? "var(--danger)" : "inherit"}">${by(["new"])}</div><div class="s">بانتظار التجهيز</div></div>
      <div class="stat"><div class="k">قيد التجهيز / جاهز</div><div class="v">${by(["preparing", "ready"])}</div></div>
      <div class="stat"><div class="k">مع المناديب</div><div class="v">${by(["assigned", "out_for_delivery"])}</div></div>
      <div class="stat"><div class="k">تم تسليمها اليوم</div><div class="v">${deliveredToday.length}</div><div class="s">${money(deliveredToday.reduce((a, o) => a + Number(o.total || 0), 0))}</div></div>
      <div class="stat"><div class="k">مناديب متصلين</div><div class="v">${onlineDrivers}</div><div class="s">من ${drivers(isAdmin() ? null : S.me.branch_id).length}</div></div>`;
    $("#live-updated").textContent = "آخر تحديث " + A.fmtTime(new Date());
    bindCards($("#view"));
    S.flash = null;
  }

  function unroutedHtml(o) {
    const opts = (o.routing && o.routing.length ? o.routing : S.branches.filter((b) => b.is_active).map((b) => ({ id: b.id, name: b.name, km: A.haversine(o.lat, o.lon, b.lat, b.lon) })))
      .slice().sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
    const why = o.routing_method === "out_of_range" ? `📏 خارج النطاق — أقرب فرع ${num(o.distance_km, 1)} كم` : "📍 الطلب بدون إحداثيات — راجع العنوان";
    return `<div class="ocard late" data-open="${o.id}" style="cursor:default">
      <div class="top"><span class="num">#${esc(o.invoice_number || o.id)}</span><span class="chip chip-warn">${why}</span>
        <span class="time">${A.ago(o.order_created_at)}</span></div>
      <div class="cust">${esc(o.customer_name || "عميل")} · <span class="mono small">${esc(o.customer_phone || "")}</span></div>
      <div class="addr">📍 ${esc(o.address_text || o.district || o.city || "—")}</div>
      <div class="meta"><span class="chip">${num(o.items_count)} منتج</span>${A.payChip(o)}</div>
      <div class="row" style="margin-top:10px;gap:6px">${opts.slice(0, 5).map((b, i) =>
        `<button class="btn btn-sm ${i === 0 ? "btn-primary" : ""}" data-route="${o.id}" data-b="${b.id}">🏪 ${esc(String(b.name).replace("بقالة ", ""))}${b.km != null ? ` · ${num(b.km, 1)} كم` : ""}</button>`).join("")}
        <button class="btn btn-sm btn-ghost" style="color:var(--danger)" data-act="cancel" data-id="${o.id}">✖ إلغاء</button></div>
    </div>`;
  }

  function cardHtml(o) {
    const mins = A.minutesSince(o.order_created_at);
    const late = (o.status === "new" && mins > 10) || (["preparing", "ready"].includes(o.status) && mins > 30) || (o.status === "out_for_delivery" && A.minutesSince(o.picked_up_at) > 45);
    const acts = nextActions(o);
    return `<div class="ocard ${late ? "late" : ""} ${S.flash === o.id ? "flash" : ""}" data-open="${o.id}">
      <div class="top"><span class="num">#${esc(o.invoice_number || o.id)}</span>${o.source === "manual" ? `<span class="chip">يدوي</span>` : ""}
        <span class="time" title="${A.fmtDateTime(o.order_created_at)}">${A.ago(o.order_created_at)}</span></div>
      <div class="cust">${esc(o.customer_name || "عميل")}</div>
      <div class="addr">📍 ${esc(o.district || o.address_text || "—")}</div>
      <div class="meta">
        ${isAdmin() ? `<span class="chip">🏪 ${esc(branchName(o.branch_id).replace("بقالة ", ""))}</span>` : ""}
        ${o.distance_km != null ? `<span class="chip">${num(o.distance_km, 1)} كم</span>` : ""}
        <span class="chip">${num(o.items_count)} منتج</span>
        ${A.payChip(o)}
        ${o.driver_id ? `<span class="chip">🛵 ${esc(staffName(o.driver_id))}</span>` : ""}
        ${o.status === "out_for_delivery" ? `<span class="chip" style="background:#ccfbf1">في الطريق ${A.ago(o.picked_up_at)}</span>` : ""}
        ${o.status === "assigned" ? `<span class="chip">بانتظار استلام المندوب</span>` : ""}
      </div>
      ${acts.length ? `<div class="acts">${acts.map((a) => `<button class="btn btn-sm ${a.cls}" data-act="${a.k}" data-id="${o.id}">${a.label}</button>`).join("")}</div>` : ""}
    </div>`;
  }

  function bindCards(root) {
    $$("[data-act]", root).forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const o = S.orders.get(Number(b.dataset.id));
      if (o) runAction(o, b.dataset.act);
    });
    $$("[data-open]", root).forEach((c) => c.onclick = () => openOrder(Number(c.dataset.open)));
    $$("[data-route]", root).forEach((b) => b.onclick = async (e) => {
      e.stopPropagation(); b.disabled = true;
      try {
        const r = await A.rpc("reroute_order", { p_order_id: Number(b.dataset.route), p_branch_id: Number(b.dataset.b), p_note: "توجيه يدوي من الإدارة" });
        S.orders.set(r.id, r); toast(`تم توجيه الطلب إلى ${branchName(r.branch_id)}`, "ok"); renderLive(true);
      } catch (er) { toast(A.errMsg(er), "error"); b.disabled = false; }
    });
  }

  // =================================================================== order drawer
  async function openOrder(id, refresh) {
    let o = S.orders.get(id);
    if (!o || refresh) {
      const { data } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
      if (data) { o = data; if (S.orders.has(id) || ACTIVE.includes(o.status)) S.orders.set(id, o); }
    }
    if (!o) return toast("الطلب غير متاح", "error");
    S.openOrder = id;
    let wrap = $("#drawer");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "drawer-wrap"; wrap.id = "drawer";
      wrap.onclick = (e) => { if (e.target === wrap) closeDrawer(); };
      document.body.appendChild(wrap);
    }
    const { data: events } = await sb.from("order_events").select("*").eq("order_id", id).order("at");
    const br = S.branches.find((b) => b.id === o.branch_id);
    const drv = S.staff.find((p) => p.id === o.driver_id);
    const canManage = isAdmin() || o.branch_id === S.me.branch_id;
    const acts = canManage ? nextActions(o) : [];
    const msg = `السلام عليكم ${o.customer_name || ""}، معك ${A.C.STORE_NAME} بخصوص طلبك رقم ${o.invoice_number || o.id}`;
    wrap.innerHTML = `<div class="drawer">
      <div class="drawer-head">
        <button class="icon-btn" id="dclose">✕</button>
        <h3 style="margin:0">طلب #${esc(o.invoice_number || o.id)}</h3>${A.statusBadge(o.status)}
        <span class="spacer"></span>
        <button class="btn btn-sm" data-act="print" data-id="${o.id}">🖨️ طباعة</button>
      </div>
      <div class="drawer-body">
        ${acts.length || canManage ? `<div class="card"><div class="row">
          ${acts.map((a) => `<button class="btn ${a.cls}" data-act="${a.k}" data-id="${o.id}">${a.label}</button>`).join("")}
          ${canManage && ["new", "preparing", "ready", "assigned"].includes(o.status) ? `<button class="btn" data-act="reroute" data-id="${o.id}">🔀 تحويل لفرع</button>` : ""}
          ${canManage && o.status === "assigned" ? `<button class="btn" data-act="unassign" data-id="${o.id}">↩️ سحب من المندوب</button>` : ""}
          ${canManage && o.status === "assigned" ? `<button class="btn" data-act="dispatch" data-id="${o.id}">🔁 مندوب آخر</button>` : ""}
          ${isAdmin() && o.status === "out_for_delivery" ? `<button class="btn btn-ok" data-act="delivered" data-id="${o.id}">✅ تأكيد التسليم</button>` : ""}
          ${canManage && ACTIVE.includes(o.status) ? `<button class="btn btn-ghost" style="color:var(--danger)" data-act="cancel" data-id="${o.id}">✖ إلغاء</button>` : ""}
        </div></div>` : ""}

        <div class="card">
          <div class="card-head"><h3>👤 العميل</h3></div>
          <dl class="kv">
            <dt>الاسم</dt><dd>${esc(o.customer_name || "—")}</dd>
            <dt>الجوال</dt><dd><span class="mono">${esc(o.customer_phone || "—")}</span></dd>
            <dt>العنوان</dt><dd>${esc(o.address_text || "—")}</dd>
            ${o.short_address ? `<dt>العنوان المختصر</dt><dd class="mono">${esc(o.short_address)}</dd>` : ""}
            <dt>وقت الطلب</dt><dd>${A.fmtDateTime(o.order_created_at)} <span class="muted small">(${A.ago(o.order_created_at)})</span></dd>
            <dt>الدفع</dt><dd>${A.payChip(o)} <span class="muted small">${esc(o.payment_method || "")}</span>
              ${o.is_cod && canManage && o.status !== "cancelled" ? `<div class="pay-row"><span class="small muted">كيف دفع العميل عند الاستلام؟</span>${A.payToggle(o)}</div>` : ""}</dd>
            ${o.shipping_method ? `<dt>طريقة الشحن</dt><dd>${esc(o.shipping_method)}</dd>` : ""}
            ${o.customer_note ? `<dt>ملاحظة العميل</dt><dd style="color:var(--warn)">${esc(o.customer_note)}</dd>` : ""}
          </dl>
          <div class="row" style="margin-top:12px">
            <a class="btn btn-sm" href="${A.telLink(o.customer_phone)}">📞 اتصال</a>
            <a class="btn btn-sm" target="_blank" href="${A.waLink(o.customer_phone, msg)}">💬 واتساب</a>
            ${o.lat ? `<a class="btn btn-sm" target="_blank" href="${A.mapsLink(o.lat, o.lon)}">🗺️ قوقل ماب</a>
            <button class="btn btn-sm" id="copy-loc">📋 نسخ الموقع</button>` : `<span class="chip chip-warn">لا توجد إحداثيات للعميل</span>`}
          </div>
          ${o.lat ? `<div class="mini-map" id="omap"></div>` : ""}
        </div>

        <div class="card">
          <div class="card-head"><h3>🏪 التوجيه والتوصيل</h3></div>
          <dl class="kv">
            <dt>الفرع</dt><dd>${esc(br?.name || "غير محدد")} ${o.distance_km != null ? `<span class="chip">${num(o.distance_km, 2)} كم</span>` : ""}
              <span class="chip">${({ nearest: "تلقائي — الأقرب", manual: "يدوي", city_fallback: "حسب المدينة", none: "بدون إحداثيات", out_of_range: "خارج النطاق" })[o.routing_method] || ""}</span></dd>
            ${o.routing?.length ? `<dt>المسافات</dt><dd class="small">${o.routing.map((r) => `${esc(r.name.replace("بقالة ", ""))}: ${r.km} كم`).join(" · ")}</dd>` : ""}
            <dt>المندوب</dt><dd>${drv ? `${esc(drv.full_name)} <a class="small" href="${A.telLink(drv.phone)}">${esc(drv.phone || "")}</a>` : "—"}</dd>
            <dt>استلام النظام</dt><dd>${A.fmtDateTime(o.received_at)}</dd>
            ${o.ready_at ? `<dt>جاهز</dt><dd>${A.fmtDateTime(o.ready_at)} <span class="muted small">(${Math.round((new Date(o.ready_at) - new Date(o.received_at)) / 60000)} د تجهيز)</span></dd>` : ""}
            ${o.picked_up_at ? `<dt>خرج للتوصيل</dt><dd>${A.fmtDateTime(o.picked_up_at)}</dd>` : ""}
            ${o.delivered_at ? `<dt>تم التسليم</dt><dd>${A.fmtDateTime(o.delivered_at)} <span class="muted small">(إجمالي ${Math.round((new Date(o.delivered_at) - new Date(o.received_at)) / 60000)} د)</span></dd>` : ""}
            ${o.cancel_reason ? `<dt>سبب الإلغاء</dt><dd style="color:var(--danger)">${esc(o.cancel_reason)}</dd>` : ""}
            ${o.zid_order_id ? `<dt>حالة زد</dt><dd>${esc(o.zid_status || "—")} <span class="muted small">(#${o.zid_order_id})</span></dd>` : ""}
          </dl>
        </div>

        <div class="card">
          <div class="card-head"><h3>🛒 المنتجات (${num(o.items_count)})</h3><span class="spacer"></span><b>${money(o.total)}</b></div>
          ${A.itemsHtml(o.items)}
          ${o.shipping_fee ? `<div class="row small" style="margin-top:8px"><span>رسوم التوصيل</span><span class="spacer"></span>${money(o.shipping_fee)}</div>` : ""}
        </div>

        <div class="card">
          <div class="card-head"><h3>🕓 سجل الطلب</h3><span class="spacer"></span><button class="btn btn-sm" id="add-note">➕ ملاحظة</button></div>
          <ul class="timeline">${(events || []).map((e) => `<li><b>${esc(e.type === "status" ? `${STATUS[e.from_status]?.label || ""} ← ${STATUS[e.to_status]?.label || ""}` : e.note || e.type)}</b>
            ${e.type === "status" && e.note ? esc(e.note) : ""}<span class="muted small">${A.fmtDateTime(e.at)} · ${esc(e.actor_name || "النظام")}</span></li>`).join("")}</ul>
        </div>
      </div></div>`;
    $("#dclose").onclick = closeDrawer;
    bindCards(wrap);
    A.bindPayToggle(wrap, (r) => { if (r?.id) S.orders.set(r.id, r); openOrder(o.id, true); });
    $("#add-note").onclick = async () => {
      const n = await A.promptBox("إضافة ملاحظة", "الملاحظة", { required: true });
      if (n) { try { await A.rpc("add_order_note", { p_order_id: o.id, p_note: n }); openOrder(o.id, true); } catch (e) { toast(A.errMsg(e), "error"); } }
    };
    $("#copy-loc")?.addEventListener("click", () => { navigator.clipboard?.writeText(A.mapsLink(o.lat, o.lon)); toast("تم نسخ رابط الموقع", "ok"); });
    if (o.lat) {
      const m = L.map("omap", { zoomControl: true, attributionControl: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(m);
      const pts = [[o.lat, o.lon]];
      L.marker([o.lat, o.lon], { icon: pin("#dc2626", "👤", 34) }).addTo(m).bindPopup(esc(o.customer_name));
      if (br) { L.marker([br.lat, br.lon], { icon: pin("#0f766e", "🏪", 34) }).addTo(m).bindPopup(esc(br.name)); pts.push([br.lat, br.lon]); }
      if (drv?.last_lat) { L.marker([drv.last_lat, drv.last_lon], { icon: pin("#2563eb", "🛵", 34) }).addTo(m).bindPopup(esc(drv.full_name)); pts.push([drv.last_lat, drv.last_lon]); }
      if (pts.length > 1) m.fitBounds(pts, { padding: [30, 30] }); else m.setView(pts[0], 15);
      setTimeout(() => m.invalidateSize(), 200);
    }
  }
  function closeDrawer() { $("#drawer")?.remove(); S.openOrder = null; }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  function pin(color, label, size = 30) {
    return L.divIcon({ className: "", html: `<div class="map-pin" style="background:${color};width:${size}px;height:${size}px">${label}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }

  // =================================================================== print
  function printSlip(o) {
    const br = S.branches.find((b) => b.id === o.branch_id);
    $("#print-area").innerHTML = `<div style="font-family:Tahoma;direction:rtl;padding:6px">
      <h2 style="text-align:center;margin:0">${esc(A.C.STORE_NAME)}</h2>
      <div style="text-align:center">${esc(br?.name || "")}</div><hr>
      <div><b>طلب #${esc(o.invoice_number || o.id)}</b> — ${A.fmtDateTime(o.order_created_at)}</div>
      <div>العميل: ${esc(o.customer_name || "")}</div><div>الجوال: ${esc(o.customer_phone || "")}</div>
      <div>العنوان: ${esc(o.address_text || "")}</div><hr>
      <table style="width:100%;font-size:12px">${(o.items || []).map((i) => `<tr><td>${esc(i.name)}</td><td>×${num(i.quantity)}</td><td>${i.total != null ? num(i.total, 2) : ""}</td></tr>`).join("")}</table><hr>
      <div><b>الإجمالي: ${money(o.total)}</b></div>
      <div>${o.is_cod ? `<b>المطلوب تحصيله: ${money(o.cod_amount || o.total)}</b> — ${o.cod_method === "card" ? "💳 شبكة / بطاقة" : o.cod_method === "cash" ? "💵 نقداً" : "عند الاستلام"}` : "✅ مدفوع مسبقاً"}</div>
      ${o.customer_note ? `<div>ملاحظة: ${esc(o.customer_note)}</div>` : ""}
    </div>`;
    window.print();
  }

  // =================================================================== manual order
  function manualOrderDialog() {
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="grid-2">
        <label class="field"><span>اسم العميل *</span><input id="m-name" required></label>
        <label class="field"><span>الجوال *</span><input id="m-phone" dir="ltr" placeholder="05xxxxxxxx" required></label>
      </div>
      <label class="field"><span>رابط الموقع من قوقل ماب / واتساب أو الإحداثيات</span><input id="m-loc" dir="ltr" placeholder="https://maps.google.com/... أو 26.4, 50.1"></label>
      <div class="small muted" style="margin:-6px 0 6px">أو اضغط على الخريطة لتحديد موقع العميل</div>
      <div class="pick-map" id="m-map"></div>
      <div class="row small" id="m-route" style="margin:8px 0"></div>
      <div class="grid-2">
        <label class="field"><span>الحي</span><input id="m-district"></label>
        <label class="field"><span>المدينة</span><select id="m-city"><option>الدمام</option><option>الجبيل</option><option>الخبر</option></select></label>
      </div>
      <label class="field"><span>العنوان / وصف</span><input id="m-addr"></label>
      <label class="field"><span>المنتجات (كل منتج في سطر — مثال: 2 خبز)</span><textarea id="m-items" rows="4"></textarea></label>
      <div class="grid-3">
        <label class="field"><span>الإجمالي (ر.س)</span><input id="m-total" type="number" step="0.01" min="0"></label>
        <label class="field"><span>الدفع</span><select id="m-cod"><option value="1">💵 عند الاستلام — نقداً</option><option value="card">💳 عند الاستلام — شبكة</option><option value="0">✅ مدفوع مسبقاً</option></select></label>
        <label class="field"><span>الفرع</span><select id="m-branch"><option value="">تلقائي (الأقرب)</option>${S.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select></label>
      </div>
      <label class="field"><span>ملاحظة</span><input id="m-note"></label>`;
    if (!isAdmin()) { $("#m-branch", body).value = S.me.branch_id; $("#m-branch", body).disabled = true; }
    let pos = null, marker = null, map;
    const setPos = (lat, lon) => {
      pos = { lat, lon };
      if (marker) marker.setLatLng([lat, lon]); else marker = L.marker([lat, lon], { icon: pin("#dc2626", "👤", 32) }).addTo(map);
      map.setView([lat, lon], Math.max(map.getZoom(), 14));
      const near = S.branches.filter((b) => b.is_active).map((b) => ({ b, d: A.haversine(lat, lon, b.lat, b.lon) })).sort((a, c) => a.d - c.d);
      const inR = near.find((x) => x.d <= branchRadius(x.b));
      $("#m-route", body).innerHTML = !near.length ? "" : inR ? `🏪 سيتوجه تلقائياً إلى: <b>${esc(inR.b.name)}</b> (${inR.d.toFixed(1)} كم)`
        : `<span class="chip chip-warn">📏 خارج النطاق — أقرب فرع ${esc(near[0].b.name)} (${near[0].d.toFixed(1)} كم). اختر الفرع يدوياً</span>`;
      if (near[0]) $("#m-city", body).value = near[0].b.city;
    };
    const dlg = A.modal({
      title: "➕ طلب يدوي (هاتف / واتساب)", body, wide: true,
      actions: [
        { label: "إلغاء", cls: "btn-ghost" },
        { label: "حفظ الطلب", cls: "btn-primary", onClick: async () => {
            const name = $("#m-name", body).value.trim(), phone = $("#m-phone", body).value.trim();
            if (!name || !phone) { toast("الاسم والجوال مطلوبين", "error"); return false; }
            const items = $("#m-items", body).value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
              const m = l.match(/^(\d+)\s*[x×*-]?\s*(.+)$/) || l.match(/^(.+?)\s*[x×*]\s*(\d+)$/);
              if (m && /^\d+$/.test(m[1])) return { name: m[2], quantity: Number(m[1]) };
              if (m) return { name: m[1], quantity: Number(m[2]) };
              return { name: l, quantity: 1 };
            });
            const o = await A.rpc("create_manual_order", { p: {
              customer_name: name, customer_phone: phone, lat: pos?.lat ?? "", lon: pos?.lon ?? "",
              district: $("#m-district", body).value, city: $("#m-city", body).value, address_text: $("#m-addr", body).value,
              items, total: $("#m-total", body).value || 0, is_cod: $("#m-cod", body).value !== "0",
              branch_id: $("#m-branch", body).value, customer_note: $("#m-note", body).value } });
            let oo = o;
            if (o.is_cod) oo = await A.rpc("set_cod_method", { p_order_id: o.id, p_method: $("#m-cod", body).value === "card" ? "card" : "cash" }).catch(() => o);
            S.orders.set(oo.id, oo); S.seen.add(oo.id);
            toast(`تم إنشاء الطلب ووجّه إلى ${branchName(o.branch_id)}`, "ok");
            if (S.route === "live") renderLive(true);
          } },
      ],
    });
    map = L.map($("#m-map", body), { attributionControl: false }).setView([26.7, 49.9], 8);
    S.maps.manual = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    S.branches.forEach((b) => L.marker([b.lat, b.lon], { icon: pin("#0f766e", "🏪", 26) }).addTo(map).bindTooltip(b.name));
    map.on("click", (e) => setPos(e.latlng.lat, e.latlng.lng));
    $("#m-loc", body).addEventListener("input", (e) => { const c = A.parseCoords(e.target.value); if (c) setPos(c.lat, c.lon); });
    setTimeout(() => map.invalidateSize(), 250);
    return dlg;
  }

  // =================================================================== live map
  function renderMap() {
    setTitle("الخريطة المباشرة", `<span class="small muted">🏪 الفروع · 🛵 المناديب · 📦 الطلبات النشطة</span>`);
    $("#view").innerHTML = `<div class="big-map" id="bigmap"></div>`;
    const m = L.map("bigmap", { attributionControl: false });
    S.maps.big = m;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(m);
    const bs = S.branches.filter((b) => isAdmin() || b.id === S.me.branch_id);
    bs.forEach((b) => L.marker([b.lat, b.lon], { icon: pin("#0f766e", "🏪", 36), zIndexOffset: 500 }).addTo(m).bindPopup(`<b>${esc(b.name)}</b>`));
    if (bs.length) m.fitBounds(bs.map((b) => [b.lat, b.lon]), { padding: [40, 40] }); else m.setView([26.7, 49.9], 9);
    S.mapLayers = { drivers: L.layerGroup().addTo(m), orders: L.layerGroup().addTo(m), trail: L.layerGroup().addTo(m) };
    updateMapDrivers(); updateMapOrders();
    setTimeout(() => m.invalidateSize(), 200);
  }
  function updateMapDrivers() {
    if (!S.maps.big || !S.mapLayers) return;
    S.mapLayers.drivers.clearLayers();
    drivers(isAdmin() ? null : S.me.branch_id).filter((d) => d.last_lat).forEach((d) => {
      const stale = A.minutesSince(d.last_location_at) > 10;
      const color = d.is_online && !stale ? "#2563eb" : "#94a3b8";
      const mk = L.marker([d.last_lat, d.last_lon], { icon: pin(color, "🛵", 38), zIndexOffset: 1000 }).addTo(S.mapLayers.drivers);
      mk.bindPopup(`<b>${esc(d.full_name)}</b><br>${esc(branchName(d.branch_id))}<br>
        ${d.is_online ? "🟢 متصل" : "⚪ غير متصل"} · آخر موقع ${A.ago(d.last_location_at)}<br>
        ${d.last_battery != null ? `🔋 ${d.last_battery}% · ` : ""}${d.last_speed ? `🚀 ${Math.round(d.last_speed * 3.6)} كم/س · ` : ""}طلبات نشطة: ${activeCountFor(d.id)}<br>
        <a href="${A.telLink(d.phone)}">📞 اتصال</a> · <a href="#" data-trail="${d.id}">🧭 مسار اليوم</a>`);
      mk.on("popupopen", (e) => {
        e.popup.getElement().querySelector("[data-trail]")?.addEventListener("click", (ev) => { ev.preventDefault(); showTrail(d.id); });
      });
    });
  }
  async function showTrail(driverId) {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { data } = await sb.from("driver_locations").select("lat,lon,at").eq("driver_id", driverId).gte("at", since.toISOString()).order("at").limit(5000);
    S.mapLayers.trail.clearLayers();
    if (!data?.length) return toast("لا يوجد مسار مسجل اليوم");
    const line = L.polyline(data.map((p) => [p.lat, p.lon]), { color: "#2563eb", weight: 4, opacity: .75 }).addTo(S.mapLayers.trail);
    S.maps.big.fitBounds(line.getBounds(), { padding: [30, 30] });
  }
  function updateMapOrders() {
    if (!S.maps.big || !S.mapLayers) return;
    S.mapLayers.orders.clearLayers();
    visibleOrders().filter((o) => ACTIVE.includes(o.status) && o.lat).forEach((o) => {
      const st = STATUS[o.status];
      L.marker([o.lat, o.lon], { icon: pin(st.color, st.icon, 30) }).addTo(S.mapLayers.orders)
        .bindPopup(`<b>#${esc(o.invoice_number || o.id)}</b> — ${esc(o.customer_name || "")}<br>${st.label} · ${esc(branchName(o.branch_id))}<br>${money(o.total)}<br><a href="#" data-o="${o.id}">فتح الطلب</a>`)
        .on("popupopen", (e) => e.popup.getElement().querySelector("[data-o]")?.addEventListener("click", (ev) => { ev.preventDefault(); openOrder(o.id); }));
    });
  }

  // =================================================================== history
  async function renderOrders() {
    setTitle("سجل الطلبات", `<button class="btn" id="export-btn">⬇️ تصدير Excel</button>`);
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    $("#view").innerHTML = `<div class="card">
      <div class="filters">
        <label class="row small">من <input type="date" id="h-from" value="${weekAgo}"></label>
        <label class="row small">إلى <input type="date" id="h-to" value="${today}"></label>
        ${isAdmin() ? `<select id="h-branch"><option value="">كل الفروع</option>${S.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select>` : ""}
        <select id="h-status"><option value="">كل الحالات</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select>
        <select id="h-driver"><option value="">كل المناديب</option>${drivers().map((d) => `<option value="${d.id}">${esc(d.full_name)}</option>`).join("")}</select>
        <input id="h-q" placeholder="🔎 اسم / جوال / رقم" style="min-width:180px">
        <button class="btn btn-primary" id="h-go">عرض</button>
      </div>
      <div id="h-sum" class="small muted" style="margin-bottom:8px"></div>
      <div class="table-wrap" id="h-table"></div>
      <div class="row" style="justify-content:center;margin-top:12px"><button class="btn hidden" id="h-more">تحميل المزيد</button></div>
    </div>`;
    let page = 0, rows = [];
    const query = (from, to) => {
      let q = sb.from("orders").select("*", { count: "exact" })
        .gte("order_created_at", new Date($("#h-from").value + "T00:00:00+03:00").toISOString())
        .lt("order_created_at", new Date(new Date($("#h-to").value + "T00:00:00+03:00").getTime() + 86400000).toISOString())
        .order("order_created_at", { ascending: false }).range(from, to);
      const b = $("#h-branch")?.value, s = $("#h-status").value, d = $("#h-driver").value, t = $("#h-q").value.trim();
      if (b) q = q.eq("branch_id", b);
      if (s) q = q.eq("status", s);
      if (d) q = q.eq("driver_id", d);
      if (t) q = q.or(`customer_name.ilike.%${t}%,customer_phone.ilike.%${t}%,invoice_number.ilike.%${t}%`);
      return q;
    };
    const load = async (reset) => {
      if (reset) { page = 0; rows = []; }
      const { data, error, count } = await query(page * 50, page * 50 + 49);
      if (error) return toast(A.errMsg(error), "error");
      rows = rows.concat(data); page++;
      $("#h-sum").textContent = `${num(count)} طلب`;
      $("#h-more").classList.toggle("hidden", rows.length >= count);
      $("#h-table").innerHTML = rows.length ? `<table><thead><tr><th>الطلب</th><th>الوقت</th><th>العميل</th><th>الجوال</th><th>الفرع</th><th>المندوب</th><th>الحالة</th><th>الإجمالي</th><th>الدفع</th></tr></thead><tbody>
        ${rows.map((o) => `<tr class="click" data-open="${o.id}"><td><b>#${esc(o.invoice_number || o.id)}</b></td><td class="small">${A.fmtDateTime(o.order_created_at)}</td>
        <td>${esc(o.customer_name)}</td><td class="mono small">${esc(o.customer_phone || "")}</td><td class="small">${esc(branchName(o.branch_id))}</td>
        <td class="small">${esc(staffName(o.driver_id))}</td><td>${A.statusBadge(o.status)}</td><td>${money(o.total)}</td>
        <td>${A.payChip(o, false)}</td></tr>`).join("")}</tbody></table>`
        : `<div class="empty">لا توجد طلبات بهذه الفلاتر</div>`;
      bindCards($("#h-table"));
    };
    $("#h-go").onclick = () => load(true);
    $("#h-more").onclick = () => load(false);
    $("#h-q").onkeydown = (e) => { if (e.key === "Enter") load(true); };
    $("#export-btn").onclick = async () => {
      const all = [];
      for (let i = 0; i < 20; i++) {
        const { data, error } = await query(i * 1000, i * 1000 + 999);
        if (error) return toast(A.errMsg(error), "error");
        all.push(...data); if (data.length < 1000) break;
      }
      exportXlsx(all);
    };
    load(true);
  }

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  async function exportXlsx(rows) {
    if (!window.XLSX) await loadScript("vendor/xlsx.full.min.js");
    const data = rows.map((o) => ({
      "رقم الطلب": o.invoice_number || o.id, "المصدر": o.source === "zid" ? "زد" : "يدوي",
      "وقت الطلب": A.fmtDateTime(o.order_created_at), "العميل": o.customer_name, "الجوال": o.customer_phone,
      "المدينة": o.city, "الحي": o.district, "العنوان": o.address_text, "خط العرض": o.lat, "خط الطول": o.lon,
      "الفرع": branchName(o.branch_id), "المسافة كم": o.distance_km, "المندوب": staffName(o.driver_id),
      "الحالة": STATUS[o.status]?.label, "عدد المنتجات": o.items_count,
      "المنتجات": (o.items || []).map((i) => `${i.name} × ${i.quantity}`).join(" | "),
      "الإجمالي": Number(o.total), "طريقة الدفع": o.payment_method, "عند الاستلام": o.is_cod ? "نعم" : "لا", "طريقة التحصيل": A.payInfo(o).label,
      "وقت التجهيز (د)": o.ready_at ? Math.round((new Date(o.ready_at) - new Date(o.received_at)) / 60000) : "",
      "وقت التوصيل (د)": o.delivered_at && o.picked_up_at ? Math.round((new Date(o.delivered_at) - new Date(o.picked_up_at)) / 60000) : "",
      "وقت التسليم": o.delivered_at ? A.fmtDateTime(o.delivered_at) : "", "سبب الإلغاء": o.cancel_reason || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = Object.keys(data[0] || {}).map((k) => ({ wch: Math.max(10, k.length + 4) }));
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, ws, "الطلبات");
    XLSX.writeFile(wb, `azm-orders-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // =================================================================== reports
  async function renderReports() {
    setTitle("التقارير والإحصائيات");
    $("#view").innerHTML = `<div class="filters">
      <select id="r-range"><option value="today">اليوم</option><option value="yesterday">أمس</option><option value="7" selected>آخر 7 أيام</option><option value="30">آخر 30 يوم</option><option value="month">هذا الشهر</option><option value="90">آخر 90 يوم</option></select>
      ${isAdmin() ? `<select id="r-branch"><option value="">كل الفروع</option>${S.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select>` : ""}
    </div><div id="r-body"><div class="empty">جاري التحميل…</div></div>`;
    const load = async () => {
      const r = $("#r-range").value;
      const start = new Date(); start.setHours(0, 0, 0, 0);
      let from = new Date(start), to = new Date(start.getTime() + 86400000);
      if (r === "yesterday") { from = new Date(start - 86400000); to = start; }
      else if (r === "month") from = new Date(start.getFullYear(), start.getMonth(), 1);
      else if (/^\d+$/.test(r)) from = new Date(start - (Number(r) - 1) * 86400000);
      try {
        const d = await A.rpc("dashboard_stats", { p_from: from.toISOString(), p_to: to.toISOString(), p_branch: $("#r-branch")?.value ? Number($("#r-branch").value) : null });
        renderReportBody(d);
      } catch (e) { toast(A.errMsg(e), "error"); }
    };
    $("#r-range").onchange = load; $("#r-branch") && ($("#r-branch").onchange = load);
    load();
  }
  function renderReportBody(d) {
    const maxB = Math.max(1, ...d.by_branch.map((b) => b.total));
    const maxH = Math.max(1, ...d.by_hour.map((h) => h.n));
    const maxD = Math.max(1, ...d.by_day.map((x) => x.n));
    const hours = Array.from({ length: 24 }, (_, h) => d.by_hour.find((x) => x.h === h)?.n || 0);
    $("#r-body").innerHTML = `
      <div class="stats">
        <div class="stat"><div class="k">إجمالي الطلبات</div><div class="v">${num(d.total)}</div></div>
        <div class="stat"><div class="k">تم التسليم</div><div class="v" style="color:var(--ok)">${num(d.delivered)}</div><div class="s">${d.total ? Math.round(d.delivered / d.total * 100) : 0}%</div></div>
        <div class="stat"><div class="k">ملغية</div><div class="v" style="color:var(--danger)">${num(d.cancelled)}</div></div>
        <div class="stat"><div class="k">المبيعات المسلّمة</div><div class="v" style="font-size:21px">${money(d.revenue)}</div></div>
        <div class="stat"><div class="k">💵 تحصيل نقدي</div><div class="v" style="font-size:21px">${money(d.cod_collected)}</div></div>
        <div class="stat"><div class="k">💳 شبكة عند الاستلام</div><div class="v" style="font-size:21px;color:#1d4ed8">${money(d.cod_card || 0)}</div><div class="s">مدفوع مسبقاً: ${money(d.prepaid || 0)}</div></div>
        <div class="stat"><div class="k">متوسط التجهيز</div><div class="v">${d.avg_prep_min ?? "—"}<small> د</small></div></div>
        <div class="stat"><div class="k">متوسط التوصيل</div><div class="v">${d.avg_delivery_min ?? "—"}<small> د</small></div></div>
        <div class="stat"><div class="k">متوسط المدة الكاملة</div><div class="v">${d.avg_total_min ?? "—"}<small> د</small></div><div class="s">متوسط المسافة ${d.avg_distance_km ?? "—"} كم</div></div>
      </div>
      <div class="grid-2" style="gap:14px">
        <div class="card"><div class="card-head"><h3>🏪 الطلبات حسب الفرع</h3></div><div class="bars">
          ${d.by_branch.map((b) => `<div class="bar"><span>${esc(b.name.replace("بقالة ", ""))}</span><div class="track"><div class="fill" style="width:${b.total / maxB * 100}%"></div></div><b>${b.total}</b></div>`).join("")}</div>
          <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>الفرع</th><th>مسلّم</th><th>ملغي</th><th>المبيعات</th><th>متوسط المدة</th></tr></thead><tbody>
          ${d.by_branch.map((b) => `<tr><td>${esc(b.name)}</td><td>${b.delivered}</td><td>${b.cancelled}</td><td>${money(b.revenue)}</td><td>${b.avg_total_min ?? "—"} د</td></tr>`).join("")}</tbody></table></div></div>
        <div class="card"><div class="card-head"><h3>🛵 أداء المناديب</h3></div><div class="table-wrap"><table><thead><tr><th>المندوب</th><th>الفرع</th><th>طلبات مسلّمة</th><th>💵 نقدي محصّل</th><th>💳 شبكة</th><th>متوسط التوصيل</th></tr></thead><tbody>
          ${d.by_driver.sort((a, b) => b.delivered - a.delivered).map((x) => `<tr><td>${esc(x.name)}</td><td class="small">${esc(branchName(x.branch_id))}</td><td><b>${x.delivered}</b></td><td>${money(x.cod)}</td><td>${money(x.card || 0)}</td><td>${x.avg_delivery_min ?? "—"} د</td></tr>`).join("") || `<tr><td colspan="6" class="empty">لا يوجد</td></tr>`}</tbody></table></div></div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-head"><h3>⏰ الطلبات حسب الساعة</h3></div>
        <div class="vbars" style="margin-bottom:22px">${hours.map((n, h) => `<div class="vb" style="height:${n / maxH * 100}%" data-v="${n}"><span>${h}</span></div>`).join("")}</div></div>
      <div class="grid-2" style="gap:14px;margin-top:14px">
        <div class="card"><div class="card-head"><h3>📅 الطلبات اليومية</h3></div><div class="bars">
          ${d.by_day.map((x) => `<div class="bar"><span>${new Date(x.d).toLocaleDateString("ar-SA", { weekday: "short", day: "numeric", month: "short" })}</span><div class="track"><div class="fill" style="width:${x.n / maxD * 100}%"></div></div><b>${x.n}</b></div>`).join("") || `<div class="empty">لا يوجد</div>`}</div></div>
        <div class="card"><div class="card-head"><h3>🏆 الأكثر طلباً</h3></div><ol style="margin:0;padding-inline-start:20px">
          ${d.top_products.map((p) => `<li style="margin-bottom:6px">${esc(p.name)} <span class="chip">${num(p.qty)}</span></li>`).join("") || `<div class="empty">لا يوجد</div>`}</ol></div>
      </div>`;
  }

  // =================================================================== staff
  async function renderStaff() {
    await loadStaff();
    setTitle("الموظفين والمناديب", isAdmin() ? `<button class="btn btn-primary" id="add-user">➕ إضافة موظف / مندوب</button>` : "");
    const rows = S.staff.filter((p) => isAdmin() || p.branch_id === S.me.branch_id);
    const groups = [["driver", "🛵 المناديب"], ["cashier", "🧾 الكاشير"], ["admin", "👑 المدراء"]];
    $("#view").innerHTML = groups.map(([r, t]) => {
      const list = rows.filter((p) => p.role === r);
      if (!list.length && r !== "driver") return "";
      return `<div class="card"><div class="card-head"><h3>${t} (${list.length})</h3></div><div class="table-wrap"><table><thead><tr>
        <th>الاسم</th><th>اسم المستخدم</th><th>الجوال</th><th>الفرع</th>${r === "driver" ? "<th>الحالة</th><th>آخر ظهور</th><th>البطارية</th><th>نشطة</th>" : ""}<th>الحساب</th>${isAdmin() ? "<th></th>" : ""}</tr></thead><tbody>
        ${list.map((p) => `<tr>
          <td><b>${esc(p.full_name)}</b>${p.vehicle ? `<div class="small muted">${esc(p.vehicle)}</div>` : ""}</td><td class="mono">${esc(p.username)}</td>
          <td><a href="${A.telLink(p.phone)}" class="mono">${esc(p.phone || "—")}</a></td><td class="small">${esc(p.branch_id ? branchName(p.branch_id) : "كل الفروع")}</td>
          ${r === "driver" ? `<td><span class="dot ${p.is_online ? "on" : ""}"></span> ${p.is_online ? "متصل" : "غير متصل"}</td><td class="small">${A.ago(p.last_seen_at) || "—"}</td>
          <td>${p.last_battery != null ? p.last_battery + "%" : "—"}</td><td>${activeCountFor(p.id)}</td>` : ""}
          <td>${p.is_active ? `<span class="chip chip-paid">فعّال</span>` : `<span class="chip chip-warn">موقوف</span>`}</td>
          ${isAdmin() ? `<td class="row" style="flex-wrap:nowrap">
            <button class="btn btn-sm" data-edit="${p.id}">تعديل</button>
            <button class="btn btn-sm" data-pass="${p.id}">🔑</button>
            ${p.id !== S.me.id ? `<button class="btn btn-sm" data-toggle="${p.id}">${p.is_active ? "إيقاف" : "تفعيل"}</button>
            <button class="btn btn-sm" style="color:var(--danger)" data-del="${p.id}">حذف</button>` : ""}</td>` : ""}
        </tr>`).join("") || `<tr><td colspan="10" class="empty">لا يوجد — أضف ${r === "driver" ? "مندوب" : "مستخدم"}</td></tr>`}</tbody></table></div></div>`;
    }).join("") + `<div class="card"><h3>📱 تطبيق المندوب</h3>
      <p class="muted small">أرسل للمندوب أحد الرابطين، وسجّل له حساب من هنا (اسم مستخدم + كلمة مرور).</p>
      <div class="row"><a class="btn" href="driver.html" target="_blank">🌐 نسخة الويب (PWA)</a>
      <a class="btn btn-primary" href="${esc(A.C.APK_URL || "#")}" target="_blank">⬇️ تحميل تطبيق أندرويد APK</a>
      <button class="btn" id="copy-driver-link">📋 نسخ رابط التطبيق</button></div></div>`;
    $("#copy-driver-link").onclick = () => { navigator.clipboard?.writeText(new URL("driver.html", location.href).href); toast("تم النسخ", "ok"); };
    if (!isAdmin()) return;
    $("#add-user").onclick = () => userDialog();
    $$("[data-edit]").forEach((b) => b.onclick = () => userDialog(S.staff.find((p) => p.id === b.dataset.edit)));
    $$("[data-pass]").forEach((b) => b.onclick = async () => {
      const p = S.staff.find((x) => x.id === b.dataset.pass);
      A.modal({ title: `تغيير كلمة مرور ${p.full_name}`, body: `<label class="field"><span>كلمة المرور الجديدة</span><input id="np" type="text" dir="ltr" minlength="6"></label>`,
        actions: [{ label: "إلغاء", cls: "btn-ghost" }, { label: "حفظ", cls: "btn-primary", onClick: async (w) => {
          await A.callFn("admin", { action: "set_password", user_id: p.id, password: $("#np", w).value }); toast("تم تغيير كلمة المرور", "ok"); } }] });
    });
    $$("[data-toggle]").forEach((b) => b.onclick = async () => {
      const p = S.staff.find((x) => x.id === b.dataset.toggle);
      try { await A.callFn("admin", { action: "set_active", user_id: p.id, active: !p.is_active }); toast("تم", "ok"); renderStaff(); } catch (e) { toast(A.errMsg(e), "error"); }
    });
    $$("[data-del]").forEach((b) => b.onclick = async () => {
      const p = S.staff.find((x) => x.id === b.dataset.del);
      if (!(await A.confirmBox("حذف المستخدم", `حذف ${p.full_name}؟ (إذا عنده طلبات سابقة سيتم إيقافه فقط للحفاظ على السجل)`, "حذف", "btn-danger"))) return;
      try { const r = await A.callFn("admin", { action: "delete_user", user_id: p.id }); toast(r.deactivated ? "تم إيقاف الحساب" : "تم الحذف", "ok"); renderStaff(); } catch (e) { toast(A.errMsg(e), "error"); }
    });
  }

  function userDialog(p) {
    const edit = !!p;
    const body = `<div class="grid-2">
      <label class="field"><span>الاسم الكامل *</span><input id="u-name" value="${esc(p?.full_name || "")}"></label>
      <label class="field"><span>الدور *</span><select id="u-role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${p?.role === k || (!p && k === "driver") ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="field"><span>اسم المستخدم (إنجليزي) *</span><input id="u-user" dir="ltr" value="${esc(p?.username || "")}" ${edit ? "disabled" : ""} placeholder="ahmed1"></label>
      ${edit ? "" : `<label class="field"><span>كلمة المرور *</span><input id="u-pass" dir="ltr" minlength="6"></label>`}
      <label class="field"><span>الجوال</span><input id="u-phone" dir="ltr" value="${esc(p?.phone || "")}" placeholder="05xxxxxxxx"></label>
      <label class="field"><span>الفرع</span><select id="u-branch"><option value="">— (للمدير: كل الفروع)</option>${S.branches.map((b) => `<option value="${b.id}" ${p?.branch_id === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
      <label class="field"><span>المركبة / ملاحظة</span><input id="u-veh" value="${esc(p?.vehicle || "")}" placeholder="مثال: دباب — لوحة 1234"></label>
    </div>`;
    A.modal({
      title: edit ? `تعديل ${p.full_name}` : "إضافة موظف / مندوب", body,
      actions: [{ label: "إلغاء", cls: "btn-ghost" }, { label: "حفظ", cls: "btn-primary", onClick: async (w) => {
        const v = (id) => $(id, w)?.value?.trim();
        if (edit) {
          await A.rpc("admin_update_profile", { p_id: p.id, p: { full_name: v("#u-name"), role: v("#u-role"), phone: v("#u-phone"), branch_id: v("#u-branch"), vehicle: v("#u-veh") } });
        } else {
          await A.callFn("admin", { action: "create_user", full_name: v("#u-name"), role: v("#u-role"), username: v("#u-user"), password: $("#u-pass", w).value, phone: v("#u-phone"), branch_id: v("#u-branch"), vehicle: v("#u-veh") });
        }
        toast("تم الحفظ", "ok"); renderStaff();
      } }],
    });
  }

  // =================================================================== branches
  async function renderBranches() {
    await loadBranches();
    setTitle("الفروع", `<button class="btn btn-primary" id="add-branch">➕ فرع جديد</button>`);
    $("#view").innerHTML = `<div class="card table-wrap"><table><thead><tr><th>#</th><th>الفرع</th><th>المدينة</th><th>الإحداثيات</th><th>الجوال</th><th>نطاق التوصيل</th><th>الحالة</th><th>مناديب</th><th></th></tr></thead><tbody>
      ${S.branches.map((b) => `<tr><td>${b.id}</td><td><b>${esc(b.name)}</b></td><td>${esc(b.city)}</td>
        <td class="mono small"><a target="_blank" href="${A.mapsLink(b.lat, b.lon)}">${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}</a></td>
        <td class="mono">${esc(b.phone || "—")}</td><td>${num(branchRadius(b), 1)} كم ${b.max_radius_km != null ? `<span class="chip">خاص</span>` : `<span class="chip">عام</span>`}</td><td>${b.is_active ? `<span class="chip chip-paid">يستقبل طلبات</span>` : `<span class="chip chip-warn">متوقف</span>`}</td>
        <td>${drivers(b.id).length}</td><td><button class="btn btn-sm" data-b="${b.id}">تعديل</button></td></tr>`).join("")}</tbody></table></div>
      <div class="card"><div class="card-head"><h3>🗺️ مواقع الفروع ومناطق التغطية</h3><span class="small muted">الدائرة = نطاق التوجيه التلقائي — أي طلب خارج كل الدوائر يحتاج توجيه منك</span></div><div class="big-map" style="height:460px" id="bmap"></div></div>`;
    const m = L.map("bmap", { attributionControl: false });
    S.maps.b = m;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(m);
    const colors = ["#0f766e", "#2563eb", "#7c3aed", "#d97706", "#dc2626", "#0891b2"];
    S.branches.forEach((b, i) => {
      L.circle([b.lat, b.lon], { radius: branchRadius(b) * 1000, color: colors[i % 6], fillOpacity: .08, weight: 1 }).addTo(m);
      L.marker([b.lat, b.lon], { icon: pin(colors[i % 6], "🏪", 34) }).addTo(m).bindTooltip(b.name, { permanent: true, direction: "top", offset: [0, -16] });
    });
    m.fitBounds(S.branches.map((b) => [b.lat, b.lon]), { padding: [40, 40] });
    $("#add-branch").onclick = () => branchDialog();
    $$("[data-b]").forEach((x) => x.onclick = () => branchDialog(S.branches.find((b) => b.id === Number(x.dataset.b))));
  }
  function branchDialog(b) {
    const body = `<label class="field"><span>اسم الفرع</span><input id="b-name" value="${esc(b?.name || "")}"></label>
      <div class="grid-2"><label class="field"><span>المدينة</span><input id="b-city" value="${esc(b?.city || "")}"></label>
      <label class="field"><span>الجوال</span><input id="b-phone" dir="ltr" value="${esc(b?.phone || "")}"></label></div>
      <label class="field"><span>الموقع (رابط قوقل ماب أو lat, lon)</span><input id="b-loc" dir="ltr" value="${b ? `${b.lat}, ${b.lon}` : ""}"></label>
      <label class="field"><span>نطاق توصيل خاص لهذا الفرع (كم) — اتركه فاضي ليستخدم النطاق العام (${num(S.radius, 1)} كم)</span><input id="b-radius" type="number" step="0.5" min="0.5" max="100" value="${b?.max_radius_km ?? ""}" placeholder="${S.radius}"></label>
      <label class="row"><input type="checkbox" id="b-active" ${!b || b.is_active ? "checked" : ""} style="width:auto;min-height:auto"> يستقبل طلبات (عند الإيقاف تتحول الطلبات للفرع الأقرب التالي)</label>`;
    A.modal({ title: b ? "تعديل الفرع" : "فرع جديد", body, actions: [{ label: "إلغاء", cls: "btn-ghost" }, { label: "حفظ", cls: "btn-primary", onClick: async (w) => {
      const c = A.parseCoords($("#b-loc", w).value);
      if (!c) { toast("الإحداثيات غير صحيحة", "error"); return false; }
      const row = { name: $("#b-name", w).value.trim(), city: $("#b-city", w).value.trim(), phone: $("#b-phone", w).value.trim() || null, lat: c.lat, lon: c.lon, is_active: $("#b-active", w).checked,
        max_radius_km: $("#b-radius", w).value.trim() === "" ? null : Number($("#b-radius", w).value) };
      const { error } = b ? await sb.from("branches").update(row).eq("id", b.id) : await sb.from("branches").insert(row);
      if (error) throw error;
      toast("تم الحفظ", "ok"); renderBranches();
    } }] });
  }

  // =================================================================== routing radius
  async function renderRouting() {
    await Promise.all([loadBranches(), loadRadius()]);
    setTitle("نطاق التوصيل التلقائي");
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: hist } = await sb.from("orders").select("lat,lon").not("lat", "is", null).gte("order_created_at", since).limit(5000);
    const pts = hist || [];
    let radius = S.radius;
    $("#view").innerHTML = `
      <div class="card">
        <div class="card-head"><h3>🎯 الطلبات داخل هذا النطاق تروح تلقائياً لأقرب فرع — والأبعد منه يوصلك أنت لتوجّهه</h3></div>
        <div class="row" style="gap:16px;align-items:center">
          <input type="range" id="rr" min="1" max="30" step="0.5" value="${radius}" style="flex:1;min-width:200px;accent-color:var(--brand)">
          <div class="row" style="gap:6px"><input type="number" id="rn" min="0.5" max="100" step="0.5" value="${radius}" style="width:90px;text-align:center;font-size:20px;font-weight:800"><b>كم</b></div>
        </div>
        <div class="row" style="gap:6px;margin-top:10px">${[2, 3, 5, 7, 10, 15].map((k) => `<button class="btn btn-sm" data-k="${k}">${k} كم</button>`).join("")}</div>
        <div id="rprev" class="stats" style="margin:14px 0 0"></div>
        <div class="row" style="margin-top:12px">
          <button class="btn btn-primary btn-lg" id="rsave">💾 حفظ النطاق</button>
          <button class="btn" id="rapply">🔄 وجّه الطلبات المعلّقة حسب النطاق الجديد</button>
        </div>
        <p class="small muted" style="margin-top:10px">💡 تقدر تحدد نطاق مختلف لفرع معيّن من صفحة <a href="#branches">الفروع</a> (مثلاً فرع الجبيل 8 كم وباقي الفروع 5 كم).</p>
      </div>
      <div class="card"><div class="card-head"><h3>🗺️ التغطية الحالية</h3><span class="small muted">النقاط = طلبات آخر 30 يوم (🟢 داخل النطاق · 🔴 خارجه)</span></div>
        <div class="big-map" style="height:480px" id="rmap"></div></div>`;
    const m = L.map("rmap", { attributionControl: false });
    S.maps.r = m;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(m);
    const circles = [], dots = L.layerGroup().addTo(m);
    S.branches.filter((b) => b.is_active).forEach((b) => {
      circles.push({ b, c: L.circle([b.lat, b.lon], { radius: 1, color: "#0f766e", fillOpacity: .1, weight: 2 }).addTo(m) });
      L.marker([b.lat, b.lon], { icon: pin("#0f766e", "🏪", 30) }).addTo(m).bindTooltip(b.name);
    });
    m.fitBounds(S.branches.map((b) => [b.lat, b.lon]), { padding: [60, 60] });
    const inRange = (p, r) => S.branches.some((b) => b.is_active && A.haversine(p.lat, p.lon, b.lat, b.lon) <= (b.max_radius_km != null ? Number(b.max_radius_km) : r));
    const update = (r, fromInput) => {
      radius = Math.max(0.5, Math.min(100, Number(r) || 5));
      if (fromInput !== "range") $("#rr").value = Math.min(30, radius);
      if (fromInput !== "num") $("#rn").value = radius;
      circles.forEach(({ b, c }) => c.setRadius((b.max_radius_km != null ? Number(b.max_radius_km) : radius) * 1000));
      dots.clearLayers();
      let inside = 0;
      pts.forEach((p) => { const ok = inRange(p, radius); if (ok) inside++;
        L.circleMarker([p.lat, p.lon], { radius: 4, color: ok ? "#16a34a" : "#dc2626", fillOpacity: .8, weight: 1 }).addTo(dots); });
      const pct = pts.length ? Math.round(inside / pts.length * 100) : 0;
      $("#rprev").innerHTML = `
        <div class="stat"><div class="k">النطاق</div><div class="v">${num(radius, 1)} كم</div><div class="s">${radius === S.radius ? "المحفوظ حالياً" : "غير محفوظ"}</div></div>
        <div class="stat"><div class="k">تلقائي (آخر 30 يوم)</div><div class="v" style="color:var(--ok)">${pct}%</div><div class="s">${inside} من ${pts.length} طلب</div></div>
        <div class="stat"><div class="k">يحتاج توجيه منك</div><div class="v" style="color:var(--danger)">${pts.length - inside}</div><div class="s">طلب خارج النطاق</div></div>`;
    };
    $("#rr").oninput = (e) => update(e.target.value, "range");
    $("#rn").oninput = (e) => update(e.target.value, "num");
    $$("[data-k]").forEach((b) => b.onclick = () => update(b.dataset.k));
    $("#rsave").onclick = async () => {
      try { await A.rpc("admin_set_setting", { p_key: "auto_route_radius_km", p_value: radius }); S.radius = radius; update(radius); toast(`تم حفظ النطاق: ${num(radius, 1)} كم`, "ok"); }
      catch (e) { toast(A.errMsg(e), "error"); }
    };
    $("#rapply").onclick = async () => {
      try { const n = await A.rpc("route_pending_orders"); toast(n ? `تم توجيه ${n} طلب تلقائياً` : "ما فيه طلبات معلّقة داخل النطاق", "ok"); loadOrders(); }
      catch (e) { toast(A.errMsg(e), "error"); }
    };
    update(radius);
    setTimeout(() => m.invalidateSize(), 200);
  }

  // =================================================================== settings / zid
  async function renderSettings() {
    setTitle("الربط مع زد والإعدادات");
    let st = {};
    try { st = await A.rpc("admin_get_settings"); } catch (e) { toast(A.errMsg(e), "error"); }
    const fn = `${A.C.SUPABASE_URL}/functions/v1/zid`;
    const webUrl = location.href.split("#")[0].replace(/index\.html$/, "");
    if (st.web_url !== webUrl) A.rpc("admin_set_setting", { p_key: "web_url", p_value: webUrl }).catch(() => {});
    $("#view").innerHTML = `
      <div class="card">
        <div class="card-head"><h3>🔗 حالة الربط مع زد</h3><span class="spacer"></span>
          ${st.zid_connected ? `<span class="badge" style="background:#dcfce7;color:#166534">✅ مربوط${st.zid_store?.title ? " — " + esc(st.zid_store.title) : ""}</span>` : `<span class="badge" style="background:#fee2e2;color:#991b1b">غير مربوط</span>`}</div>
        <div id="zid-status" class="small muted">${st.zid_connected ? `تم الربط ${A.fmtDateTime(st.zid_connected_at)} · آخر مزامنة ناجحة: ${st.zid_last_sync ? A.ago(st.zid_last_sync) : "—"} · تحديثات بانتظار الإرسال لزد: ${st.zid_outbox_pending ?? 0}` : "اتبع الخطوات بالأسفل لربط متجرك."}</div>
        <div class="row" style="margin-top:12px">
          <a class="btn btn-primary" href="${fn}?action=install" target="_blank">${st.zid_connected ? "🔄 إعادة الربط" : "🔗 ربط متجري في زد"}</a>
          <button class="btn" id="z-test" ${st.zid_connected ? "" : "disabled"}>🩺 فحص الاتصال</button>
          <button class="btn" id="z-sync" ${st.zid_connected ? "" : "disabled"}>⬇️ مزامنة الطلبات الآن</button>
          <button class="btn" id="z-hooks" ${st.zid_connected ? "" : "disabled"}>📡 تسجيل Webhooks</button>
          <button class="btn" id="z-import" ${st.zid_connected ? "" : "disabled"}>➕ استيراد طلب برقمه</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>🔑 بيانات تطبيق زد (من بوابة الشركاء partner.zid.sa)</h3></div>
        <div class="grid-2">
          <label class="field"><span>Client ID</span><input id="z-cid" dir="ltr" value="${esc(st.zid_client_id ?? "")}"></label>
          <label class="field"><span>Client Secret ${st.zid_client_secret_set ? "✅ (محفوظ — اتركه فاضي إذا ما تبي تغيّره)" : ""}</span><input id="z-sec" dir="ltr" type="password" autocomplete="off" placeholder="${st.zid_client_secret_set ? "••••••••" : ""}"></label>
          <label class="field"><span>App ID (اختياري)</span><input id="z-app" dir="ltr" value="${esc(st.zid_app_id ?? "")}"></label>
          <label class="field"><span>معرّف مخزون زد الافتراضي (لحالة "جاهز")</span><input id="z-loc" dir="ltr" value="${esc(st.zid_default_location_id ?? "")}"></label>
        </div>
        <button class="btn btn-primary" id="z-save">حفظ</button>
        <details style="margin-top:14px"><summary><b>الروابط المطلوبة في إعدادات التطبيق داخل بوابة شركاء زد</b></summary>
          <dl class="kv" style="margin-top:10px;grid-template-columns:160px 1fr">
            <dt>Application URL</dt><dd class="mono small">${esc(webUrl)}</dd>
            <dt>Redirection URL</dt><dd class="mono small">${esc(fn)}?action=install</dd>
            <dt>Callback URL</dt><dd class="mono small">${esc(fn)}?action=callback</dd>
            <dt>الصلاحيات (Scopes)</dt><dd class="small">الطلبات (قراءة وكتابة) · العملاء (قراءة) · Webhooks (قراءة وكتابة) · بيانات المتجر (قراءة)</dd>
          </dl></details>
      </div>

      <div class="card">
        <div class="card-head"><h3>🔄 تحديث حالة الطلب في زد تلقائياً</h3><span class="spacer"></span>
          ${st.zapier_status_hook_set ? `<span class="badge" style="background:#dcfce7;color:#166534">✅ مفعّل</span>` : `<span class="badge" style="background:#fef3c7;color:#92400e">⏳ يحتاج رابط Zapier</span>`}</div>
        <p class="small muted" style="margin-top:0">كل ما يتغيّر الطلب عندنا يتحدّث في زد مباشرة:
          <span class="chip">قيد التجهيز → جاري التجهيز</span> <span class="chip">جاهز → جاهز</span> <span class="chip">خرج مع المندوب → جاري التوصيل</span> <span class="chip">تم التسليم → تم التوصيل</span> <span class="chip">ملغي → ملغي</span></p>
        <div class="row" style="align-items:flex-end">
          <label class="field" style="flex:1;min-width:260px;margin:0"><span>رابط Webhook من Zapier ${st.zapier_status_hook_set ? "✅ (محفوظ — اتركه فاضي إذا ما تبي تغيّره)" : ""}</span>
            <input id="zh-url" dir="ltr" type="password" autocomplete="off" placeholder="${st.zapier_status_hook_set ? "••••••••" : "https://hooks.zapier.com/hooks/catch/..."}"></label>
          <button class="btn btn-primary" id="zh-save">حفظ</button>
          ${st.zapier_status_hook_set ? `<button class="btn btn-ghost" style="color:var(--danger)" id="zh-clear">إيقاف</button>` : ""}
        </div>
        <div class="row small" style="margin-top:10px;gap:6px">
          <span class="chip">أُرسل اليوم: <b>${num(st.zid_outbox_sent_today ?? 0)}</b></span>
          <span class="chip">بالانتظار: <b>${num(st.zid_outbox_pending ?? 0)}</b></span>
          <span class="chip ${st.zid_outbox_failed ? "chip-warn" : ""}">فشل بعد 5 محاولات: <b>${num(st.zid_outbox_failed ?? 0)}</b></span>
          <span class="spacer"></span><button class="btn btn-sm" id="zh-log">📜 آخر التحديثات المرسلة</button>
        </div>
        <div class="table-wrap hidden" id="zh-table" style="margin-top:10px"></div>
      </div>

      <div class="card">
        <div class="card-head"><h3>⚙️ خيارات المزامنة</h3></div>
        <label class="row" style="margin-bottom:10px"><input type="checkbox" id="o-push" style="width:auto;min-height:auto" ${st.zid_push_status !== false ? "checked" : ""}> تحديث حالة الطلب في زد تلقائياً (قيد التجهيز ← جاهز ← جاري التوصيل ← تم التوصيل)</label>
        <div class="field"><span>استيراد الطلبات التي حالتها في زد:</span><div class="row">
          ${["new", "preparing", "ready", "indelivery"].map((s) => `<label class="row small"><input type="checkbox" class="o-imp" value="${s}" style="width:auto;min-height:auto" ${(st.zid_import_statuses || ["new", "preparing", "ready"]).includes(s) ? "checked" : ""}> ${({ new: "جديد", preparing: "قيد التجهيز", ready: "جاهز", indelivery: "جاري التوصيل" })[s]}</label>`).join("")}</div></div>
        <label class="field"><span>استيراد طرق الشحن التالية فقط (اتركه فاضي = الكل، افصل بفاصلة)</span><input id="o-ship" value="${esc((st.zid_shipping_filter || []).join("، "))}" placeholder="مثال: مندوب المتجر"></label>
        <button class="btn btn-primary" id="o-save">حفظ الخيارات</button>
      </div>

      <div class="card"><div class="card-head"><h3>📜 سجل الربط مع زد</h3><span class="spacer"></span><button class="btn btn-sm" id="log-refresh">تحديث</button></div><div class="table-wrap" id="zlog"></div></div>`;

    const save = (k, v) => A.rpc("admin_set_setting", { p_key: k, p_value: v });
    $("#z-save").onclick = async () => {
      try {
        await save("zid_client_id", $("#z-cid").value.trim());
        if ($("#z-sec").value.trim()) await save("zid_client_secret", $("#z-sec").value.trim());
        await save("zid_app_id", $("#z-app").value.trim() ? Number($("#z-app").value.trim()) : null);
        await save("zid_default_location_id", $("#z-loc").value.trim() || null);
        toast("تم الحفظ", "ok"); renderSettings();
      } catch (e) { toast(A.errMsg(e), "error"); }
    };
    $("#o-save").onclick = async () => {
      try {
        await save("zid_push_status", $("#o-push").checked);
        await save("zid_import_statuses", $$(".o-imp:checked").map((x) => x.value));
        const ship = $("#o-ship").value.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
        await save("zid_shipping_filter", ship.length ? ship : null);
        toast("تم الحفظ", "ok");
      } catch (e) { toast(A.errMsg(e), "error"); }
    };
    $("#zh-save").onclick = async () => {
      const v = $("#zh-url").value.trim();
      if (!v) return toast(st.zapier_status_hook_set ? "الرابط محفوظ مسبقاً" : "الصق رابط Zapier أولاً", st.zapier_status_hook_set ? "ok" : "error");
      if (!/^https:\/\/hooks\.zapier\.com\//.test(v)) return toast("الرابط لازم يبدأ بـ https://hooks.zapier.com/", "error");
      try { await save("zapier_status_hook", v); toast("✅ تم التفعيل — الحالات بتتحدث في زد تلقائياً", "ok"); renderSettings(); } catch (e) { toast(A.errMsg(e), "error"); }
    };
    $("#zh-clear")?.addEventListener("click", async () => {
      if (!(await A.confirmBox("إيقاف التحديث التلقائي", "توقف إرسال الحالات لزد؟", "إيقاف", "btn-danger"))) return;
      try { await save("zapier_status_hook", ""); toast("تم الإيقاف", "ok"); renderSettings(); } catch (e) { toast(A.errMsg(e), "error"); }
    });
    $("#zh-log").onclick = async () => {
      const t = $("#zh-table"); t.classList.toggle("hidden"); if (t.classList.contains("hidden")) return;
      try {
        const rows = await A.rpc("admin_zid_outbox", { p_limit: 40 });
        const lbl = { preparing: "جاري التجهيز", ready: "جاهز", indelivery: "جاري التوصيل", delivered: "تم التوصيل", cancelled: "ملغي" };
        t.innerHTML = rows?.length ? `<table><thead><tr><th>الوقت</th><th>طلب زد</th><th>الحالة المرسلة</th><th>النتيجة</th><th>محاولات</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td class="small">${A.fmtDateTime(r.created_at)}</td><td class="mono">#${esc(r.zid_order_id)}</td><td>${esc(lbl[r.zid_status] || r.zid_status)}</td>
          <td class="small">${r.done ? (/أحدث/.test(r.last_error || "") ? "⏭️ تجاوزه تحديث أحدث" : "✅ وصل") : r.attempts >= 5 ? `❌ فشل ${esc(r.last_error || "")}` : "⏳ جاري الإرسال"}</td><td>${r.attempts}</td></tr>`).join("")}</tbody></table>`
          : `<div class="empty">لا يوجد تحديثات بعد</div>`;
      } catch (e) { toast(A.errMsg(e), "error"); }
    };
    const fnCall = async (action, extra = "") => {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(`${fn}?action=${action}${extra}`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, apikey: A.C.SUPABASE_ANON_KEY } });
      const j = await r.json(); if (!r.ok || j.ok === false || j.error) throw new Error(j.error || "خطأ"); return j;
    };
    $("#z-test").onclick = async () => { try { const j = await fnCall("status"); toast(j.ok ? `✅ الاتصال سليم — إجمالي طلبات المتجر: ${j.total_orders ?? "?"}` : `⚠️ ${j.error}`, j.ok ? "ok" : "error", 6000); } catch (e) { toast(A.errMsg(e), "error"); } };
    $("#z-sync").onclick = async (e) => { e.target.disabled = true; try { const j = await fnCall("sync", "&pages=3"); toast(`تمت المزامنة: ${j.added} جديد، ${j.updated} محدّث`, "ok"); loadOrders(); loadLog(); } catch (er) { toast(A.errMsg(er), "error"); } e.target.disabled = false; };
    $("#z-hooks").onclick = async () => { try { const j = await fnCall("webhooks"); A.modal({ title: "تسجيل Webhooks", body: `<ul>${j.results.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` }); loadLog(); } catch (e) { toast(A.errMsg(e), "error"); } };
    $("#z-import").onclick = async () => {
      const id = await A.promptBox("استيراد طلب من زد", "رقم الطلب في زد", { required: true, okLabel: "استيراد" });
      if (id) { try { await fnCall("import", "&id=" + encodeURIComponent(id.trim())); toast("تم الاستيراد", "ok"); loadOrders(); } catch (e) { toast(A.errMsg(e), "error"); } }
    };
    const loadLog = async () => {
      const { data } = await sb.from("zid_log").select("*").order("at", { ascending: false }).limit(60);
      $("#zlog").innerHTML = data?.length ? `<table><thead><tr><th>الوقت</th><th>النوع</th><th></th><th>التفاصيل</th></tr></thead><tbody>
        ${data.map((l) => `<tr><td class="small">${A.fmtDateTime(l.at)}</td><td>${esc(l.kind)}</td><td>${l.ok ? "✅" : "❌"}</td><td class="small">${esc(l.message || "")}</td></tr>`).join("")}</tbody></table>` : `<div class="empty">لا يوجد سجل بعد</div>`;
    };
    $("#log-refresh").onclick = loadLog;
    loadLog();
  }

  boot().catch((e) => { console.error(e); toast(A.errMsg(e), "error"); });
})();

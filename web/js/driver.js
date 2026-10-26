/* عزم ماركت — تطبيق المندوب (ويب PWA + أندرويد APK) */
(function () {
  const A = window.AZM;
  const { sb, $, $$, esc, money, num, toast } = A;
  const app = $("#app");

  // ---------------------------------------------------------------- native bridge (Capacitor)
  const Cap = window.Capacitor;
  const NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const plug = (n) => { try { return NATIVE ? (Cap.Plugins?.[n] || Cap.registerPlugin(n)) : null; } catch (_) { return null; } };
  const BG = plug("BackgroundGeolocation");
  const LN = plug("LocalNotifications");
  const CapApp = plug("App");

  const S = { me: null, orders: [], done: [], tab: "active", online: false, watchId: null, lastPing: 0, lastPos: null,
    seen: new Set(), alerting: false, channel: null, gpsError: null, wakeLock: null };

  // ================================================================= boot
  async function boot() {
    A.unlockAudio();
    if (!NATIVE && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return renderLogin();
    try { S.me = await A.myProfile(); } catch (e) { toast(A.errMsg(e), "error"); return renderLogin(); }
    if (!S.me || !S.me.is_active) { await sb.auth.signOut(); return renderLogin("الحساب غير مفعّل"); }
    if (S.me.role !== "driver") {
      if (NATIVE) { await sb.auth.signOut(); return renderLogin("هذا التطبيق خاص بالمناديب — استخدم لوحة التحكم من المتصفح"); }
      location.href = "index.html"; return;
    }
    await setupNative();
    renderShell();
    await loadOrders(true);
    subscribe();
    if (localStorage.getItem("azm-online") !== "0") await goOnline(true);
    else render();
    setInterval(() => loadOrders(), 45000);
    setInterval(() => render(), 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadOrders(); requestWakeLock(); } });
  }

  async function setupNative() {
    if (!NATIVE) return;
    try {
      await LN?.requestPermissions();
      await LN?.createChannel({ id: "orders_v2", name: "الطلبات الجديدة", description: "تنبيه بصوت مميز عند وصول طلب جديد", importance: 5, visibility: 1, vibration: true, lights: true, lightColor: "#14b8a6", sound: "azm_driver.wav" });
      try { await LN?.deleteChannel({ id: "orders" }); } catch (_) {}
      LN?.addListener("localNotificationActionPerformed", () => { loadOrders(); });
    } catch (e) { console.warn(e); }
    try {
      CapApp?.addListener("resume", () => loadOrders());
      CapApp?.addListener("backButton", () => { const m = $(".modal-wrap"); if (m) m.remove(); else CapApp.minimizeApp(); });
    } catch (_) {}
  }

  // ================================================================= login
  function renderLogin(msg) {
    app.innerHTML = `<div class="login-page"><form class="login-card" id="lf">
      <div class="logo"><div class="logo-mark">ع</div><div>عزم ماركت<div class="small muted" style="font-weight:600">تطبيق المندوب 🛵</div></div></div>
      <div style="height:20px"></div>${msg ? `<p class="chip chip-warn">${esc(msg)}</p>` : ""}
      <label class="field"><span>اسم المستخدم</span><input name="u" autocomplete="username" required dir="ltr" autocapitalize="none"></label>
      <label class="field"><span>كلمة المرور</span><input name="p" type="password" autocomplete="current-password" required dir="ltr"></label>
      <button class="btn btn-primary btn-block btn-lg">دخول</button>
    </form></div>`;
    $("#lf").onsubmit = async (e) => {
      e.preventDefault();
      const b = $("button", e.target); b.disabled = true;
      try { await A.login(e.target.u.value, e.target.p.value); location.reload(); }
      catch (err) { toast(A.errMsg(err), "error"); b.disabled = false; }
    };
  }

  // ================================================================= shell
  function renderShell() {
    app.innerHTML = `
      <div class="d-head">
        <div class="row"><div class="logo-mark" style="background:#14b8a6;width:40px;height:40px">ع</div>
          <div class="grow"><h1>${esc(S.me.full_name)}</h1><div class="sub">🏪 ${esc(S.me.branch?.name || "")}</div></div>
          <button class="icon-btn" style="color:#fff" id="menu">⋮</button></div>
        <div class="duty"><span id="duty-ic">⚪</span><b id="duty-t">غير متصل</b>
          <label class="switch"><input type="checkbox" id="duty"><span></span></label></div>
      </div>
      <div id="gps-warn"></div>
      <div class="d-tabs"><button data-t="active" class="active">الطلبات الحالية <span id="cnt"></span></button><button data-t="done">مكتملة اليوم</button></div>
      <div class="d-list" id="list"></div>
      <div class="foot-note">عزم ماركت · ${NATIVE ? "تطبيق أندرويد" : "نسخة الويب"}</div>`;
    $("#duty").onchange = (e) => (e.target.checked ? goOnline() : goOffline());
    $$(".d-tabs button").forEach((b) => b.onclick = () => { S.tab = b.dataset.t; $$(".d-tabs button").forEach((x) => x.classList.toggle("active", x === b)); render(); });
    $("#menu").onclick = () => A.modal({
      title: "القائمة", body: `<div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn" id="m-refresh">🔄 تحديث الطلبات</button>
        <button class="btn" id="m-test">🔔 تجربة صوت التنبيه</button>
        ${NATIVE ? `<button class="btn" id="m-battery">🔋 إعدادات البطارية (مهم لعدم إيقاف التطبيق)</button>` : ""}
        <button class="btn" id="m-out" style="color:var(--danger)">🚪 تسجيل خروج</button></div>
        <p class="small muted" style="margin-top:14px">💡 لضمان وصول التنبيهات: خلّ وضع "متصل" شغال، وفعّل الإشعارات، واستثنِ التطبيق من توفير البطارية.</p>`,
    }) && setTimeout(() => {
      $("#m-refresh").onclick = () => { loadOrders(); $(".modal-wrap")?.remove(); };
      $("#m-test").onclick = () => { A.playSound("driver"); nativeNotify("🔔 تجربة", "التنبيهات تعمل بشكل سليم"); };
      $("#m-out").onclick = async () => { await goOffline(); A.logout(); };
      $("#m-battery") && ($("#m-battery").onclick = () => BG?.openSettings?.());
    }, 0);
  }

  function setDutyUI() {
    $("#duty").checked = S.online;
    $("#duty-ic").textContent = S.online ? "🟢" : "⚪";
    $("#duty-t").textContent = S.online ? "متصل — تستقبل الطلبات وموقعك مشارك" : "غير متصل";
    $("#gps-warn").innerHTML = S.online && S.gpsError ? `<div class="gps-warn">📍 ${esc(S.gpsError)}</div>` : "";
  }

  // ================================================================= location tracking
  async function goOnline(silent) {
    S.online = true; localStorage.setItem("azm-online", "1");
    try { await A.rpc("driver_set_online", { p_online: true }); } catch (e) { if (!silent) toast(A.errMsg(e), "error"); }
    startTracking();
    requestWakeLock();
    if (!NATIVE && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
    setDutyUI(); render();
  }
  async function goOffline() {
    if (S.orders.some((o) => o.status === "out_for_delivery") && !(await A.confirmBox("تأكيد", "عندك طلب في الطريق. متأكد تبي تقفل التتبع؟", "نعم", "btn-danger"))) { $("#duty").checked = true; return; }
    S.online = false; localStorage.setItem("azm-online", "0");
    stopTracking();
    try { await A.rpc("driver_set_online", { p_online: false }); } catch (_) {}
    setDutyUI();
  }

  async function startTracking() {
    stopTracking();
    S.gpsError = null;
    if (NATIVE && BG) {
      try {
        S.watchId = await BG.addWatcher({
          backgroundTitle: "عزم ماركت — أنت متصل",
          backgroundMessage: "يتم مشاركة موقعك مع الفرع أثناء العمل",
          requestPermissions: true, stale: false, distanceFilter: 15,
        }, (loc, err) => {
          if (err) {
            if (err.code === "NOT_AUTHORIZED") {
              S.gpsError = "صلاحية الموقع مرفوضة — اضغط هنا لفتح الإعدادات";
              setDutyUI(); $("#gps-warn").onclick = () => BG.openSettings();
            }
            return;
          }
          onPosition({ lat: loc.latitude, lon: loc.longitude, accuracy: loc.accuracy, speed: loc.speed, heading: loc.bearing });
        });
      } catch (e) { S.gpsError = "تعذر تشغيل تتبع الموقع"; setDutyUI(); }
      // نبضة كل دقيقة حتى لو المندوب واقف (للحفاظ على حالة الاتصال واستلام الطلبات)
      S.heartbeat = setInterval(() => { if (S.lastPos) sendPing(S.lastPos, true); loadOrders(); }, 60000);
      return;
    }
    if (!("geolocation" in navigator)) { S.gpsError = "الجهاز لا يدعم تحديد الموقع"; setDutyUI(); return; }
    S.watchId = navigator.geolocation.watchPosition(
      (p) => { S.gpsError = null; setDutyUI(); onPosition({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading }); },
      (e) => { S.gpsError = e.code === 1 ? "اسمح للتطبيق بالوصول للموقع من إعدادات المتصفح" : "جاري تحديد الموقع…"; setDutyUI(); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
    S.heartbeat = setInterval(() => { if (S.lastPos) sendPing(S.lastPos, true); }, 60000);
  }
  function stopTracking() {
    if (S.watchId !== null && S.watchId !== undefined) {
      if (NATIVE && BG) BG.removeWatcher({ id: S.watchId }).catch(() => {});
      else navigator.geolocation.clearWatch(S.watchId);
    }
    S.watchId = null;
    clearInterval(S.heartbeat);
  }
  function onPosition(pos) {
    S.lastPos = pos;
    if (S.gpsError) { S.gpsError = null; setDutyUI(); }
    sendPing(pos);
  }
  async function batteryLevel() {
    try { if (navigator.getBattery) { const b = await navigator.getBattery(); return Math.round(b.level * 100); } } catch (_) {}
    return null;
  }
  async function sendPing(pos, force) {
    const now = Date.now();
    if (!force && now - S.lastPing < 15000) return;
    S.lastPing = now;
    try {
      await A.rpc("driver_ping", { p_lat: pos.lat, p_lon: pos.lon, p_accuracy: pos.accuracy ?? null, p_speed: pos.speed ?? null, p_heading: pos.heading ?? null, p_battery: await batteryLevel() });
    } catch (e) { console.warn("ping", e); }
  }
  async function requestWakeLock() {
    try { if (S.online && "wakeLock" in navigator && !S.wakeLock) { S.wakeLock = await navigator.wakeLock.request("screen"); S.wakeLock.addEventListener("release", () => (S.wakeLock = null)); } } catch (_) {}
  }

  // ================================================================= data
  async function loadOrders(first) {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [a, d] = await Promise.all([
      sb.from("orders").select("*").eq("driver_id", S.me.id).in("status", ["assigned", "out_for_delivery"]).order("assigned_at"),
      sb.from("orders").select("*").eq("driver_id", S.me.id).eq("status", "delivered").gte("delivered_at", since.toISOString()).order("delivered_at", { ascending: false }),
    ]);
    if (a.error) { toast(A.errMsg(a.error), "error"); return; }
    const before = new Set(S.orders.map((o) => o.id));
    S.orders = a.data; S.done = d.data || [];
    if (first) S.orders.forEach((o) => S.seen.add(o.id));
    else S.orders.filter((o) => !before.has(o.id) && !S.seen.has(o.id) && o.status === "assigned").forEach(newOrderAlert);
    render();
  }

  function subscribe() {
    S.channel = sb.channel("driver-" + S.me.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `driver_id=eq.${S.me.id}` }, (p) => {
        const o = p.new;
        if (!o?.id) return loadOrders();
        const exists = S.orders.find((x) => x.id === o.id);
        if (o.status === "assigned" && !exists && !S.seen.has(o.id)) newOrderAlert(o);
        loadOrders();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, (p) => {
        // طلب انسحب مني (تحول لمندوب آخر أو رجع للفرع)
        if (p.old?.driver_id === S.me.id && p.new?.driver_id !== S.me.id) loadOrders();
      })
      .subscribe((st) => { if (st === "SUBSCRIBED") loadOrders(); });
  }

  // ================================================================= alerts
  async function nativeNotify(title, body) {
    if (NATIVE && LN) {
      try { await LN.schedule({ notifications: [{ id: Math.floor(Math.random() * 2e9), title, body, channelId: "orders_v2", sound: "azm_driver.wav", autoCancel: true }] }); return; } catch (e) { console.warn(e); }
    }
    A.notify(title, body);
  }
  function newOrderAlert(o) {
    S.seen.add(o.id);
    try { navigator.vibrate?.([600, 200, 600, 200, 600]); } catch (_) {}
    nativeNotify("🛵 طلب جديد لك!", `#${o.invoice_number || o.id} — ${o.customer_name || ""} — ${o.district || ""}`);
    A.startAlarm("driver");
    if ($(".alert-overlay")) return;
    const ov = document.createElement("div");
    ov.className = "alert-overlay";
    ov.innerHTML = `<div class="ic">🛵</div><h2>طلب جديد!</h2>
      <div style="font-size:18px">#${esc(o.invoice_number || o.id)} — ${esc(o.customer_name || "")}</div>
      <div style="opacity:.85">${esc(o.district || o.address_text || "")}</div>
      <button>عرض الطلب</button>`;
    $("button", ov).onclick = () => { A.stopAlarm(); ov.remove(); S.tab = "active"; render(); };
    document.body.appendChild(ov);
  }

  // ================================================================= render
  function render() {
    if (!$("#list")) return;
    $("#cnt").textContent = S.orders.length ? `(${S.orders.length})` : "";
    setDutyUI();
    if (S.tab === "done") return renderDone();
    if (!S.orders.length) {
      $("#list").innerHTML = `<div class="d-empty"><div class="ic">${S.online ? "😌" : "😴"}</div>
        <h3>${S.online ? "لا يوجد طلبات حالياً" : "أنت غير متصل"}</h3>
        <p>${S.online ? "أول ما يرسل لك الفرع طلب بيوصلك تنبيه مع صوت." : "فعّل زر الاتصال فوق عشان تستقبل الطلبات."}</p></div>`;
      return;
    }
    $("#list").innerHTML = S.orders.map(cardHtml).join("");
    bind();
  }

  function cardHtml(o) {
    const dist = S.lastPos ? A.haversine(S.lastPos.lat, S.lastPos.lon, o.lat, o.lon) : null;
    const msgWay = `السلام عليكم ${o.customer_name || ""} 👋\nمعك مندوب ${A.C.STORE_NAME}، طلبك رقم ${o.invoice_number || o.id} في الطريق لك 🛵${o.is_cod ? `\nالمبلغ المطلوب: ${money(o.cod_amount || o.total)}` : ""}`;
    const msgArr = `السلام عليكم، وصلت عند موقعك بطلبك من ${A.C.STORE_NAME} 🛵`;
    const out = o.status === "out_for_delivery";
    return `<div class="d-card ${!out && A.minutesSince(o.assigned_at) < 2 ? "new-flash" : ""}">
      <div class="hdr"><span class="num">#${esc(o.invoice_number || o.id)}</span>${A.statusBadge(o.status)}<span class="spacer"></span><span class="small muted">${A.ago(o.order_created_at)}</span></div>
      <div class="cust">${esc(o.customer_name || "عميل")}</div>
      <div class="addr">📍 ${esc(o.address_text || o.district || "—")}${o.short_address ? ` · <span class="mono">${esc(o.short_address)}</span>` : ""}</div>
      <div class="row small">${dist !== null ? `<span class="chip">📏 ${dist.toFixed(1)} كم منك</span>` : ""}<span class="chip">🛒 ${num(o.items_count)} منتج</span>
        ${o.customer_phone ? `<span class="chip mono">${esc(o.customer_phone)}</span>` : ""}</div>
      ${o.customer_note ? `<div class="chip chip-warn" style="margin-top:8px;white-space:normal">📝 ${esc(o.customer_note)}</div>` : ""}
      ${o.is_cod ? `<div class="cod-box ${o.cod_method === "card" ? "is-card" : ""}">
        <div class="cod-amt">${o.cod_method === "card" ? "💳" : "💵"} حصّل من العميل: <b>${money(o.cod_amount || o.total)}</b></div>
        <div class="cod-q">كيف بيدفع العميل؟</div>${A.payToggle(o)}</div>` : `<div class="paid-box">✅ مدفوع مسبقاً — لا تحصّل شيء</div>`}
      <div class="quick">
        <a class="nav-btn" href="${A.navLink(o.lat, o.lon)}" target="_blank" ${o.lat ? "" : `onclick="return false" style="opacity:.4"`}><span class="ic">🧭</span>الملاحة</a>
        <a href="${A.telLink(o.customer_phone)}"><span class="ic">📞</span>اتصال</a>
        <a class="wa-btn" href="${A.waLink(o.customer_phone, out ? msgArr : msgWay)}" target="_blank"><span class="ic">💬</span>واتساب</a>
      </div>
      <details class="items-d"><summary>🛒 عرض المنتجات (${num(o.items_count)}) — ${money(o.total)}</summary>${A.itemsHtml(o.items)}</details>
      ${out ? `<button class="big-action done" data-a="deliver" data-id="${o.id}">✅ تم التسليم للعميل</button>`
            : `<button class="big-action go" data-a="pickup" data-id="${o.id}">📦 استلمت الطلب — بدء التوصيل</button>`}
      <div class="small-actions">
        ${out ? `<a class="btn btn-sm" target="_blank" href="${A.waLink(o.customer_phone, msgWay)}">📨 أرسل "في الطريق"</a>` : ""}
        <button class="btn btn-sm" data-a="return" data-id="${o.id}">↩️ إرجاع للفرع</button>
        <a class="btn btn-sm" href="${A.telLink(S.me.branch?.phone)}">🏪 اتصال بالفرع</a>
      </div>
    </div>`;
  }

  function bind() {
    A.bindPayToggle($("#list"), (r) => {
      const i = S.orders.findIndex((x) => x.id === r?.id);
      if (i >= 0) { S.orders[i] = r; $("#list").innerHTML = S.orders.map(cardHtml).join(""); bind(); }
    });
    $$("[data-a]").forEach((b) => b.onclick = async () => {
      const o = S.orders.find((x) => x.id === Number(b.dataset.id));
      if (!o) return;
      A.stopAlarm();
      if (b.dataset.a === "pickup") {
        b.disabled = true;
        try {
          await A.rpc("set_order_status", { p_order_id: o.id, p_status: "out_for_delivery", p_note: null });
          toast("بالتوفيق 🛵 — تم إبلاغ النظام أنك في الطريق", "ok");
          if (S.lastPos) sendPing(S.lastPos, true);
          if (o.lat && (await A.confirmBox("الملاحة", "تفتح الخريطة للوصول للعميل؟", "افتح الخريطة"))) window.open(A.navLink(o.lat, o.lon), "_blank");
        } catch (e) { toast(A.errMsg(e), "error"); }
        loadOrders();
      } else if (b.dataset.a === "deliver") {
        let method = null;
        if (o.is_cod) { method = await askPayMethod(o); if (!method) return; }
        else if (!(await A.confirmBox("تأكيد التسليم", "تأكيد تسليم الطلب للعميل؟", "✅ نعم، تم التسليم", "btn-ok"))) return;
        b.disabled = true;
        try {
          if (method && method !== o.cod_method) await A.rpc("set_cod_method", { p_order_id: o.id, p_method: method });
          if (S.lastPos) await sendPing(S.lastPos, true);
          await A.rpc("set_order_status", { p_order_id: o.id, p_status: "delivered", p_note: null });
          toast("ممتاز 👏 تم تسليم الطلب", "ok");
        } catch (e) { toast(A.errMsg(e), "error"); }
        loadOrders();
      } else if (b.dataset.a === "return") {
        const why = await A.promptBox("إرجاع الطلب للفرع", "السبب", { required: true, placeholder: "مثال: العميل لا يرد / العنوان غير صحيح", okLabel: "إرجاع" });
        if (!why) return;
        try { await A.rpc("set_order_status", { p_order_id: o.id, p_status: "ready", p_note: "إرجاع من المندوب: " + why }); toast("تم إرجاع الطلب للفرع", "ok"); } catch (e) { toast(A.errMsg(e), "error"); }
        loadOrders();
      }
    });
  }

  // سؤال المندوب عند التسليم: العميل دفع نقداً ولا شبكة؟
  function askPayMethod(o) {
    return new Promise((resolve) => {
      let pick = o.cod_method || null, done = false;
      const body = document.createElement("div");
      body.innerHTML = `<p class="lead" style="margin-top:0">المبلغ: <b>${money(o.cod_amount || o.total)}</b> — كيف دفع العميل؟</p>
        <div class="pay-pick">
          <button type="button" data-m="cash"><span class="ic">💵</span>نقداً<small>استلمت المبلغ كاش</small></button>
          <button type="button" data-m="card"><span class="ic">💳</span>شبكة / بطاقة<small>دفع بجهاز الشبكة</small></button>
        </div>`;
      const sync = () => body.querySelectorAll("[data-m]").forEach((x) => x.classList.toggle("on", x.dataset.m === pick));
      body.querySelectorAll("[data-m]").forEach((x) => x.onclick = () => { pick = x.dataset.m; sync(); });
      sync();
      A.modal({ title: "✅ تأكيد التسليم", body, actions: [
        { label: "إلغاء", cls: "btn-ghost", onClick: () => { done = true; resolve(null); } },
        { label: "✅ تم التسليم", cls: "btn-ok", onClick: () => {
            if (!pick) { toast("اختر طريقة الدفع: نقداً أو شبكة", "error"); return false; }
            done = true; resolve(pick); } },
      ], onClose: () => { if (!done) resolve(null); } });
    });
  }

  function renderDone() {
    const sum = (f) => S.done.filter(f).reduce((a, o) => a + Number(o.cod_amount || o.total || 0), 0);
    const cash = sum((o) => o.is_cod && o.cod_method !== "card"), card = sum((o) => o.is_cod && o.cod_method === "card");
    $("#list").innerHTML = `<div class="d-summary">
        <div class="stat"><div class="k">طلبات مسلّمة اليوم</div><div class="v">${S.done.length}</div></div>
        <div class="stat"><div class="k">💵 نقدي معك للتسليم</div><div class="v" style="color:#92400e">${money(cash)}</div></div>
        <div class="stat"><div class="k">💳 شبكة (ما يحتاج تسلّمه)</div><div class="v" style="color:#1d4ed8">${money(card)}</div></div></div>
      ${S.done.map((o) => `<div class="d-card"><div class="hdr"><span class="num">#${esc(o.invoice_number || o.id)}</span>${A.statusBadge(o.status)}<span class="spacer"></span><span class="small muted">${A.fmtTime(o.delivered_at)}</span></div>
        <div><b>${esc(o.customer_name || "")}</b> — ${esc(o.district || "")}</div>
        <div class="small">${o.is_cod ? (o.cod_method === "card" ? `💳 شبكة ${money(o.cod_amount || o.total)}` : `💵 نقدي ${money(o.cod_amount || o.total)}`) : "✅ مدفوع مسبقاً"} · مدة التوصيل ${o.picked_up_at ? Math.round((new Date(o.delivered_at) - new Date(o.picked_up_at)) / 60000) + " د" : "—"}</div></div>`).join("")
        || `<div class="d-empty"><div class="ic">📭</div><p>لا يوجد طلبات مكتملة اليوم</p></div>`}`;
  }

  boot().catch((e) => { console.error(e); toast(A.errMsg(e), "error"); });
})();

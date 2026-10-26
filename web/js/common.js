/* عزم ماركت — أدوات مشتركة */
(function () {
  const C = window.AZM_CONFIG;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "azm-auth" },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  const STATUS = {
    new:              { label: "جديد",          color: "#2563eb", bg: "#dbeafe", icon: "🆕" },
    preparing:        { label: "قيد التجهيز",   color: "#b45309", bg: "#fef3c7", icon: "🧺" },
    ready:            { label: "جاهز للإرسال",  color: "#7c3aed", bg: "#ede9fe", icon: "📦" },
    assigned:         { label: "عند المندوب",   color: "#0e7490", bg: "#cffafe", icon: "🛵" },
    out_for_delivery: { label: "في الطريق",     color: "#0f766e", bg: "#ccfbf1", icon: "🚚" },
    delivered:        { label: "تم التسليم",    color: "#15803d", bg: "#dcfce7", icon: "✅" },
    cancelled:        { label: "ملغي",          color: "#b91c1c", bg: "#fee2e2", icon: "✖" },
  };
  const ROLES = { admin: "مدير", cashier: "كاشير", driver: "مندوب" };
  const ACTIVE = ["new", "preparing", "ready", "assigned", "out_for_delivery"];

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("ar-SA", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ر.س");
  const num = (n, d = 0) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("ar-SA", { maximumFractionDigits: d }));

  function fmtTime(t) {
    if (!t) return "—";
    return new Date(t).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Riyadh" });
  }
  function fmtDateTime(t) {
    if (!t) return "—";
    return new Date(t).toLocaleString("ar-SA", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Riyadh" });
  }
  function ago(t) {
    if (!t) return "";
    const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
    if (s < 60) return "الآن";
    const m = Math.floor(s / 60);
    if (m < 60) return `قبل ${m} د`;
    const h = Math.floor(m / 60);
    if (h < 24) return `قبل ${h} س ${m % 60 ? (m % 60) + " د" : ""}`;
    return `قبل ${Math.floor(h / 24)} يوم`;
  }
  function minutesSince(t) { return t ? Math.floor((Date.now() - new Date(t).getTime()) / 60000) : 0; }

  function haversine(lat1, lon1, lat2, lon2) {
    if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined)) return null;
    const R = 6371.0088, r = (x) => (x * Math.PI) / 180;
    const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function phoneIntl(p) {
    if (!p) return "";
    let s = String(p).replace(/[^\d+]/g, "");
    if (s.startsWith("+")) s = s.slice(1);
    if (s.startsWith("00")) s = s.slice(2);
    if (/^05\d{8}$/.test(s)) s = "966" + s.slice(1);
    if (/^5\d{8}$/.test(s)) s = "966" + s;
    return s;
  }
  const telLink = (p) => (p ? `tel:+${phoneIntl(p)}` : "#");
  const waLink = (p, msg = "") => (p ? `https://wa.me/${phoneIntl(p)}${msg ? "?text=" + encodeURIComponent(msg) : ""}` : "#");
  const mapsLink = (lat, lon) => (lat ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : "#");
  const navLink = (lat, lon) => (lat ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving` : "#");

  // استخراج الإحداثيات من رابط قوقل ماب أو نص "lat, lon"
  function parseCoords(text) {
    if (!text) return null;
    const s = decodeURIComponent(String(text));
    const pats = [/@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /query=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
      /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /(-?\d{1,2}\.\d{3,})\s*[,،\s]\s*(-?\d{1,3}\.\d{3,})/];
    for (const p of pats) {
      const m = s.match(p);
      if (m) { const lat = parseFloat(m[1]), lon = parseFloat(m[2]); if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon }; }
    }
    return null;
  }

  // ---------------------------------------------------------------- UI helpers
  function toast(msg, type = "info", ms = 3500) {
    let box = $("#toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add("hide"), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  function modal({ title, body, actions = [], wide = false, onClose }) {
    const wrap = document.createElement("div");
    wrap.className = "modal-wrap";
    wrap.innerHTML = `<div class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="إغلاق">✕</button></div>
      <div class="modal-body"></div><div class="modal-foot"></div></div>`;
    const bodyEl = $(".modal-body", wrap);
    if (typeof body === "string") bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const foot = $(".modal-foot", wrap);
    const close = () => { wrap.remove(); onClose && onClose(); };
    actions.forEach((a) => {
      const b = document.createElement("button");
      b.className = `btn ${a.cls || ""}`;
      b.textContent = a.label;
      b.onclick = async () => {
        if (a.onClick) {
          b.disabled = true;
          try { const r = await a.onClick(wrap); if (r !== false) close(); }
          catch (e) { toast(errMsg(e), "error"); }
          finally { b.disabled = false; }
        } else close();
      };
      foot.appendChild(b);
    });
    if (!actions.length) foot.remove();
    wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-close]")) close(); });
    document.body.appendChild(wrap);
    return { el: wrap, close };
  }

  function confirmBox(title, text, okLabel = "تأكيد", cls = "btn-primary") {
    return new Promise((resolve) => {
      let done = false;
      modal({
        title, body: `<p class="lead">${esc(text)}</p>`,
        actions: [
          { label: "إلغاء", cls: "btn-ghost", onClick: () => { done = true; resolve(false); } },
          { label: okLabel, cls, onClick: () => { done = true; resolve(true); } },
        ],
        onClose: () => { if (!done) resolve(false); },
      });
    });
  }

  function promptBox(title, label, { placeholder = "", required = false, okLabel = "حفظ", value = "" } = {}) {
    return new Promise((resolve) => {
      let done = false;
      modal({
        title,
        body: `<label class="field"><span>${esc(label)}</span><textarea rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`,
        actions: [
          { label: "إلغاء", cls: "btn-ghost", onClick: () => { done = true; resolve(null); } },
          { label: okLabel, cls: "btn-primary", onClick: (w) => {
              const v = $("textarea", w).value.trim();
              if (required && !v) { toast("هذا الحقل مطلوب", "error"); return false; }
              done = true; resolve(v); } },
        ],
        onClose: () => { if (!done) resolve(null); },
      });
      setTimeout(() => $(".modal-wrap:last-child textarea")?.focus(), 50);
    });
  }

  function errMsg(e) {
    const m = e?.message || e?.error_description || e?.error || String(e);
    if (/Invalid login credentials/i.test(m)) return "اسم المستخدم أو كلمة المرور غير صحيحة";
    if (/Failed to fetch|NetworkError|network/i.test(m)) return "تعذر الاتصال بالإنترنت";
    if (/JWT expired/i.test(m)) return "انتهت الجلسة، سجل الدخول من جديد";
    return m;
  }

  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw error;
    return data;
  }

  async function callFn(name, body, query = "") {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${C.SUPABASE_URL}/functions/v1/${name}${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: C.SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token || C.SUPABASE_ANON_KEY}` },
      body: JSON.stringify(body || {}),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error || `خطأ ${res.status}`);
    return j;
  }

  // ---------------------------------------------------------------- auth
  const toEmail = (u) => (String(u).includes("@") ? String(u).trim() : `${String(u).trim().toLowerCase()}@${C.EMAIL_DOMAIN}`);
  async function login(username, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(username), password });
    if (error) throw error;
    return data;
  }
  async function myProfile() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data, error } = await sb.from("profiles").select("*, branch:branches(id,name,city,lat,lon,phone)").eq("id", session.user.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function logout() { try { await sb.auth.signOut(); } catch (_) {} location.reload(); }

  // ---------------------------------------------------------------- sound
  let audioCtx = null, alarmTimer = null;
  function beep(times = 3) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      for (let i = 0; i < times; i++) {
        [880, 1175].forEach((f, j) => {
          const o = audioCtx.createOscillator(), g = audioCtx.createGain();
          o.type = "sine"; o.frequency.value = f;
          const t0 = audioCtx.currentTime + i * 0.6 + j * 0.18;
          g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
          o.connect(g).connect(audioCtx.destination); o.start(t0); o.stop(t0 + 0.18);
        });
      }
    } catch (_) {}
  }
  // أصوات التنبيه (ملفات عالية وواضحة): order = لوحة التحكم/الكاشير، driver = جوال المندوب
  const SOUND_FILES = { order: "sounds/order.wav", driver: "sounds/driver.wav" };
  const audios = {};
  function getAudio(name) {
    if (!audios[name]) { const a = new Audio(SOUND_FILES[name] || SOUND_FILES.order); a.preload = "auto"; a.volume = 1; audios[name] = a; }
    return audios[name];
  }
  function playSound(name = "order", { loop = false } = {}) {
    try {
      const a = getAudio(name); a.loop = loop; a.volume = 1; a.currentTime = 0;
      const p = a.play(); if (p && p.catch) p.catch(() => beep(4));
    } catch (_) { beep(4); }
  }
  function stopSound() { Object.values(audios).forEach((a) => { try { a.pause(); a.currentTime = 0; a.loop = false; } catch (_) {} }); }
  function startAlarm(name = "driver") { stopAlarm(); playSound(name, { loop: true }); }
  function stopAlarm() { if (alarmTimer) clearInterval(alarmTimer); alarmTimer = null; stopSound(); }
  function unlockAudio() {
    const f = () => {
      try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (_) {}
      // تهيئة ملفات الصوت بعد أول لمسة (شرط المتصفحات للسماح بالتشغيل التلقائي)
      Object.keys(SOUND_FILES).forEach((n) => { const a = getAudio(n); a.muted = true; const p = a.play(); if (p && p.then) p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; }); else a.muted = false; });
    };
    document.addEventListener("click", f, { once: true }); document.addEventListener("touchstart", f, { once: true });
    Object.keys(SOUND_FILES).forEach(getAudio);
  }

  async function notify(title, body) {
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") {
        const reg = await navigator.serviceWorker?.getRegistration?.();
        if (reg) reg.showNotification(title, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", vibrate: [300, 100, 300], tag: "azm-" + Date.now() });
        else new Notification(title, { body, icon: "icons/icon-192.png" });
      }
    } catch (_) {}
  }

  // رابط المنتج في المتجر (بالمعرّف إن وجد، وإلا بحث بالاسم)
  function productUrl(it) {
    const base = (C.STORE_URL || "").replace(/\/$/, "");
    if (!base) return null;
    if (it.product_id) return `${base}/products/${encodeURIComponent(it.product_id)}`;
    return `${base}/products?search=${encodeURIComponent(it.name || it.sku || "")}`;
  }

  function itemsHtml(items) {
    if (!items?.length) return `<p class="muted">لا توجد منتجات</p>`;
    return `<ul class="items">${items.map((it) => `
      <li>
        ${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="item-ph">🛒</span>`}
        <div class="item-info"><b>${esc(it.name)}</b>
          ${it.options?.length ? `<small>${it.options.map(esc).join(" · ")}</small>` : ""}
          ${it.sku ? `<small class="muted">SKU: ${esc(it.sku)}</small>` : ""}</div>
        <span class="qty">× ${num(it.quantity)}</span>
        <span class="price">${it.total != null ? money(it.total) : ""}</span>
        ${productUrl(it) ? `<a class="item-link" href="${esc(productUrl(it))}" target="_blank" rel="noopener" title="عرض المنتج في المتجر">🔗<span>المتجر</span></a>` : ""}
      </li>`).join("")}</ul>`;
  }

  // ---- طريقة الدفع: مدفوع مسبقاً / عند الاستلام (نقداً أو شبكة)
  function payInfo(o) {
    if (!o?.is_cod) return { kind: "prepaid", icon: "✅", label: "مدفوع مسبقاً", cls: "chip-paid" };
    if (o.cod_method === "card") return { kind: "card", icon: "💳", label: "شبكة عند الاستلام", cls: "chip-card" };
    if (o.cod_method === "cash") return { kind: "cash", icon: "💵", label: "نقداً عند الاستلام", cls: "chip-cod" };
    return { kind: "cod", icon: "💵", label: "عند الاستلام", cls: "chip-cod" };
  }
  function payChip(o, withAmount = true) {
    const p = payInfo(o);
    const amt = withAmount ? " " + money(o.is_cod ? (o.cod_amount || o.total) : o.total) : "";
    return `<span class="chip ${p.cls}" title="${esc(o.payment_method || p.label)}">${p.icon} ${p.label}${amt}</span>`;
  }
  function payToggle(o) {
    if (!o?.is_cod) return "";
    const m = o.cod_method || "";
    return `<div class="pay-seg" role="radiogroup" aria-label="طريقة التحصيل" data-pay-for="${o.id}">
      <button type="button" data-m="cash" class="${m === "cash" ? "on" : ""}" aria-pressed="${m === "cash"}">💵 نقداً</button>
      <button type="button" data-m="card" class="${m === "card" ? "on" : ""}" aria-pressed="${m === "card"}">💳 شبكة / بطاقة</button></div>`;
  }
  // يربط أزرار نقداً/شبكة داخل عنصر — onDone(order) بعد الحفظ
  function bindPayToggle(root, onDone) {
    root.querySelectorAll(".pay-seg[data-pay-for] button[data-m]").forEach((b) => b.onclick = async (ev) => {
      ev.stopPropagation();
      const seg = b.closest(".pay-seg"); const id = Number(seg.dataset.payFor);
      if (b.classList.contains("on")) return;
      seg.querySelectorAll("button").forEach((x) => { x.disabled = true; });
      try {
        const o = await rpc("set_cod_method", { p_order_id: id, p_method: b.dataset.m });
        seg.querySelectorAll("button").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
        toast(b.dataset.m === "card" ? "تم: الدفع بالشبكة 💳" : "تم: الدفع نقداً 💵", "ok");
        onDone && onDone(o);
      } catch (e) { toast(errMsg(e), "error"); }
      finally { seg.querySelectorAll("button").forEach((x) => { x.disabled = false; }); }
    });
  }

  function statusBadge(s) {
    const st = STATUS[s] || { label: s, color: "#555", bg: "#eee" };
    return `<span class="badge" style="color:${st.color};background:${st.bg}">${st.icon || ""} ${st.label}</span>`;
  }

  window.AZM = {
    sb, C, STATUS, ROLES, ACTIVE, $, $$, esc, money, num, fmtTime, fmtDateTime, ago, minutesSince, haversine,
    phoneIntl, telLink, waLink, mapsLink, navLink, productUrl, parseCoords, toast, modal, confirmBox, promptBox, errMsg,
    rpc, callFn, login, myProfile, logout, beep, playSound, stopSound, startAlarm, stopAlarm, unlockAudio, notify, itemsHtml, statusBadge, toEmail, payInfo, payChip, payToggle, bindPayToggle,
  };
})();

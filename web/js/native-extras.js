/* عزم ماركت — مزايا الجوال لتطبيق المندوب:
 *  1) إعفاء التطبيق من توفير البطارية (إضافة AzmPower المدمجة في الـ APK)
 *  2) الإشعارات الفورية (Firebase) عشان يوصل الطلب حتى لو التطبيق مسكّر
 * كل الدوال آمنة: لو الإضافة مو موجودة (نسخة الويب أو APK قديم) ترجع بدون أخطاء.
 */
(function () {
  const Cap = window.Capacitor;
  const NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const plug = (n) => { try { return NATIVE ? (Cap.Plugins?.[n] || Cap.registerPlugin(n)) : null; } catch (_) { return null; } };
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) {} },
  };
  // شركات معروفة بإيقاف التطبيقات بالخلفية حتى بعد الإعفاء
  const AGGRESSIVE = ["xiaomi", "redmi", "poco", "huawei", "honor", "oppo", "realme", "oneplus", "vivo", "iqoo", "letv", "asus", "tecno", "infinix"];

  // ================================================================ البطارية
  const power = {
    plugin: () => plug("AzmPower"),
    async status() {
      const P = power.plugin();
      if (!P) return { supported: false, ignoring: true, manufacturer: "" };
      try { const r = await P.status(); return { supported: true, ignoring: !!r.ignoring, manufacturer: String(r.manufacturer || "").toLowerCase(), sdk: r.sdk }; }
      catch (_) { return { supported: false, ignoring: true, manufacturer: "" }; }
    },
    aggressive(m) { return AGGRESSIVE.some((x) => String(m || "").includes(x)); },
    async request() { const P = power.plugin(); if (!P) return false; try { await P.requestIgnore(); return true; } catch (_) { return false; } },
    async openAutoStart() { const P = power.plugin(); if (!P) return false; try { return !!(await P.openAutoStart()).opened; } catch (_) { return false; } },
    async openAppSettings() { const P = power.plugin(); if (!P) return false; try { return !!(await P.openAppSettings()).opened; } catch (_) { return false; } },
  };

  // ================================================================ الإشعارات الفورية
  const push = {
    plugin: () => (window.AZM_PUSH ? plug("PushNotifications") : null),
    enabled: () => !!(NATIVE && window.AZM_PUSH && push.plugin()),
    token: () => ls.get("azm-push-token"),
    state: "off", // off | denied | pending | on | error
    _inited: false,
    /** handlers: { onMessage(data), onOpen(data), onState(state) } */
    async init(rpc, handlers = {}) {
      const PN = push.plugin();
      const setState = (s) => { push.state = s; try { handlers.onState?.(s); } catch (_) {} };
      if (!NATIVE || !window.AZM_PUSH || !PN) { setState("off"); return "off"; }
      try {
        let perm = await PN.checkPermissions();
        if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PN.requestPermissions();
        if (perm.receive !== "granted") { setState("denied"); return "denied"; }
        if (!push._inited) {
          push._inited = true;
          await PN.addListener("registration", async (t) => {
            const tok = t?.value;
            if (!tok) return;
            try { await rpc("driver_register_push", { p_token: tok, p_platform: "android" }); ls.set("azm-push-token", tok); setState("on"); }
            catch (e) { console.warn("push register", e); setState("error"); }
          });
          await PN.addListener("registrationError", (e) => { console.warn("push error", e); setState("error"); });
          await PN.addListener("pushNotificationReceived", (n) => { try { handlers.onMessage?.(n?.data || {}); } catch (_) {} });
          await PN.addListener("pushNotificationActionPerformed", (a) => { try { handlers.onOpen?.(a?.notification?.data || {}); } catch (_) {} });
        }
        setState("pending");
        await PN.register();
        return "pending";
      } catch (e) { console.warn("push init", e); setState("error"); return "error"; }
    },
    async unregister(rpc) {
      const tok = push.token();
      if (tok) { try { await rpc("driver_unregister_push", { p_token: tok }); } catch (_) {} }
      ls.del("azm-push-token");
    },
  };

  window.AZM_NATIVE = { NATIVE, power, push };
})();

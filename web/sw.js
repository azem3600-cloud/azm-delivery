// Service worker: تخزين الواجهة للعمل السريع + عرض الإشعارات
const CACHE = "azm-v2";
const ASSETS = ["./", "index.html", "driver.html", "css/app.css", "css/driver.css", "js/config.js", "js/common.js", "js/native-flags.js", "js/native-extras.js", "js/app.js", "js/driver.js", "vendor/supabase.js", "icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // الشبكة أولاً ثم الكاش (عشان التحديثات توصل فوراً)
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow("driver.html"))));
});

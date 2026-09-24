/* ============================================================
   Search of Sky — Service Worker
   آفلاین کردن اپ
   ============================================================ */

const CACHE_NAME = "ss-v1.0.1";

const ASSETS = [
    "./",
    "./index.html",
    "./css/style.css",
    "./js/core.js",
    "./js/app.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./fonts/Vazirmatn-Regular.ttf",
];

// نصب: کش کردن همه‌ی asset ها
self.addEventListener("install", (event) => {
    console.log("🔧 Service Worker: Installing...");
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log("📦 Caching assets");
            return cache.addAll(ASSETS).catch((err) => {
                console.warn("خطا در کش:", err);
            });
        })
    );
    self.skipWaiting();
});

// فعال‌سازی: پاک کردن کش‌های قدیمی
self.addEventListener("activate", (event) => {
    console.log("✅ Service Worker: Activated");
    event.waitUntil(
        caches.keys().then((names) => {
            return Promise.all(
                names
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch: از کش بخون، اگه نبود از شبکه
self.addEventListener("fetch", (event) => {
    // فقط GET
    if (event.request.method !== "GET") return;
    
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            
            return fetch(event.request).then((response) => {
                // کش کردن پاسخ‌های معتبر
                if (response && response.status === 200 && response.type === "basic") {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            }).catch(() => {
                // اگه آفلاین بود
                return caches.match("./index.html");
            });
        })
    );
});
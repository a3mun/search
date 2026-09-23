/* ============================================================
   Search of Sky — Service Worker
   آفلاین کامل + کش هوشمند
   ============================================================ */

const CACHE_VERSION = "ss-v3.0.0";
const CACHE_NAME = "search-of-sky-" + CACHE_VERSION;

// ═══════════════════════════════════════════════════════════
//  فایل‌های اصلی (کش آفلاین)
// ═══════════════════════════════════════════════════════════

const CORE_ASSETS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./css/style.css",
    "./js/core.js",
    "./js/app.js",
    "./js/search-worker.js",
    "./fonts/Vazirmatn-Regular.ttf",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
];

// ═══════════════════════════════════════════════════════════
//  Install: کش کردن asset ها
// ═══════════════════════════════════════════════════════════

self.addEventListener("install", (event) => {
    console.log("🔧 Service Worker: نصب...");
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log("📦 کش کردن asset ها");
                return cache.addAll(CORE_ASSETS);
            })
            .then(() => {
                console.log("✅ نصب کامل شد");
                return self.skipWaiting();
            })
            .catch((err) => {
                console.error("❌ خطا در نصب:", err);
            })
    );
});

// ═══════════════════════════════════════════════════════════
//  Activate: پاک کردن کش‌های قدیمی
// ═══════════════════════════════════════════════════════════

self.addEventListener("activate", (event) => {
    console.log("✅ Service Worker: فعال‌سازی...");
    
    event.waitUntil(
        caches.keys()
            .then((names) => {
                return Promise.all(
                    names
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => {
                            console.log("🗑 حذف کش قدیمی:", name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log("✅ فعال‌سازی کامل شد");
                return self.clients.claim();
            })
    );
});

// ═══════════════════════════════════════════════════════════
//  Fetch: استراتژی Hybrid
//  - HTML: Network-first (تازه‌ترین)
//  - Assets: Cache-first (سریع)
// ═══════════════════════════════════════════════════════════

self.addEventListener("fetch", (event) => {
    const req = event.request;
    
    // فقط GET
    if (req.method !== "GET") return;
    
    // URL
    const url = new URL(req.url);
    
    // Skip cross-origin
    if (url.origin !== location.origin) return;
    
    // HTML: Network-first
    if (req.headers.get("accept") && req.headers.get("accept").includes("text/html")) {
        event.respondWith(
            fetch(req)
                .then((response) => {
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(req, clone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Offline → از کش
                    return caches.match(req).then((cached) => {
                        return cached || caches.match("./index.html");
                    });
                })
        );
        return;
    }
    
    // Assets: Cache-first
    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            
            return fetch(req)
                .then((response) => {
                    if (response && response.status === 200 && response.type === "basic") {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(req, clone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // اگه عکس بود و پیدا نشد → آیکون پیش‌فرض
                    if (req.destination === "image") {
                        return caches.match("./icons/icon-192.png");
                    }
                });
        })
    );
});

// ═══════════════════════════════════════════════════════════
//  Message: از UI پیام بگیر
// ═══════════════════════════════════════════════════════════

self.addEventListener("message", (event) => {
    const data = event.data || {};
    
    if (data.action === "skipWaiting") {
        self.skipWaiting();
    }
    
    if (data.action === "clearCache") {
        caches.keys().then((names) => {
            return Promise.all(names.map((n) => caches.delete(n)));
        }).then(() => {
            console.log("🗑 همه‌ی کش‌ها پاک شد");
        });
    }
});
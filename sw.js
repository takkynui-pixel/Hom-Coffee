/* Service worker: เก็บไฟล์หน้าเว็บไว้ให้เปิดแอปเร็ว — ไม่แตะข้อมูล Supabase/รูป (ต้องออนไลน์เสมอ เพื่อไม่ให้ข้อมูลสต็อกเก่า) */
const CACHE = 'oms-v6';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'logo.png', 'favicon.png', 'manifest.webmanifest', 'icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('oms-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;                       // Supabase, CDN, Storage: ไม่แทรกแซง
  if (r.mode === 'navigate') {                                    // หน้าเว็บ: ลองออนไลน์ก่อน ไม่ได้ค่อยใช้ที่เก็บไว้
    e.respondWith(fetch(r).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(                                                  // ไฟล์ของแอป: ใช้ที่เก็บไว้ทันที แล้วอัปเดตเบื้องหลัง
    caches.match(r).then(hit => {
      const net = fetch(r).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

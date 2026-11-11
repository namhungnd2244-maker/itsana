// Service Worker tối giản để kích hoạt PWA
self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  // Chuyển tiếp mọi yêu cầu mạng bình thường
  e.respondWith(fetch(e.request).catch(() => new Response('Offline')));
});

const cacheName = "my-cache-v1";
const files = [
  "./index.html",
  "./app.js",
  "./data1.js",
  "./data2.js",
  "./data3.js",
  "./data4.js",
  "./data5.js"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)));
});
self.addEventListener("fetch", e => {
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});

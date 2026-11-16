/* SICEP+ · Service Worker (app shell) */

const CACHE = 'sicep-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './css/app.css',
  './css/screens.css',
  './css/print.css',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/config.js',
  './js/nuvem.js',
  './js/lib/qrcode.js',
  './js/screens/login.js',
  './js/screens/estado.js',
  './js/screens/home.js',
  './js/screens/avaliacoes.js',
  './js/screens/nova-avaliacao.js',
  './js/screens/avaliacao-detalhe.js',
  './js/screens/cartoes.js',
  './js/screens/leitura.js',
  './js/screens/resultados.js',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Navegação: rede primeiro, cache como reserva (offline).
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copia));
          return resp;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  ev.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
        return resp;
      })
    )
  );
});

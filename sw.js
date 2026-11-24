/* SICEP+ · Service Worker (app shell) */

// Suba o número a cada entrega que mude arquivos do app (força o aparelho a baixar tudo de novo).
<<<<<<< HEAD
const CACHE = 'sicep-v29';
=======
const CACHE = 'sicep-v28';
>>>>>>> 21f7e2f7a5b0104aee0224e5d30103266d4bbf8e

// O OpenCV (~13 MB) fica em cache próprio e com versão própria: subir o CACHE acima
// NÃO apaga o OpenCV, então ninguém baixa 13 MB de novo a cada atualização do app.
// Só mude este nome se trocar o arquivo js/lib/opencv.js.
const CACHE_OPENCV = 'sicep-opencv-v1';
const URL_OPENCV = './js/lib/opencv.js';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './assets/icons/icon-256.png',
  './css/app.css',
  './css/screens.css',
  './css/print.css',
  './js/app.js',
  './js/ui.js',
  './js/store.js',
  './js/offline/db.js',
  './js/offline/fila.js',
  './js/config.js',
  './js/nuvem.js',
  './js/desempenho.js',
  './js/lib/qrcode.js',
  './js/leitor/geometria.js',
  './js/leitor/moldura.js',
  './js/leitor/opencv-loader.js',
  './js/leitor/leitor.js',
  './js/leitor/omr.js',
  './js/leitor/cartao-svg.js',
  './js/leitor/exportar-cartao.js',
  './js/leitor/camera.js',
  './js/leitor/associacao.js',
  './js/leitor/qr-caderno.js',
  './js/screens/login.js',
  './js/screens/estado.js',
  './js/screens/home.js',
  './js/screens/avaliacoes.js',
  './js/screens/nova-avaliacao.js',
  './js/screens/avaliacao-detalhe.js',
  './js/screens/cartoes.js',
  './js/screens/leitura.js',
  './js/screens/resultados.js',
  './js/screens/desempenho.js',
  './js/screens/fila-painel.js',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE && k !== CACHE_OPENCV).map((k) => caches.delete(k))))
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

  // OpenCV: cache próprio, guarda só resposta boa (a 1ª leitura online deixa a leitura offline pronta).
  if (new URL(req.url).pathname.endsWith('/js/lib/opencv.js')) {
    ev.respondWith(
      caches.open(CACHE_OPENCV).then((c) =>
        c.match(URL_OPENCV).then((hit) =>
          hit || fetch(req).then((resp) => {
            if (resp.ok) c.put(URL_OPENCV, resp.clone());
            return resp;
          })
        )
      )
    );
    return;
  }

  // Código do app (JS/CSS/HTML): rede primeiro, cache só quando está sem internet.
  // Antes era cache-primeiro: a correção chegava no servidor e o aparelho continuava
  // rodando o arquivo velho até alguém subir o número do cache. Agora a leitura nova
  // entra na primeira abertura com internet.
  const caminho = new URL(req.url).pathname;
  const ehCodigo = req.destination === 'script' || req.destination === 'style' || req.destination === 'document'
    || /\.(js|css|html)$/i.test(caminho);
  if (ehCodigo) {
    ev.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(() => caches.match(req))
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

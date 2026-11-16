/* ============================================================
   SICEP+ · Carregador do OpenCV.js
   ------------------------------------------------------------
   O arquivo (js/lib/opencv.js, ~13 MB) fica no próprio projeto:
   o app funciona offline e o service worker o guarda em cache
   depois da primeira leitura. Só é baixado quando alguém abre a
   leitura de cartões (use precarregarOpenCV() para adiantar).
   ============================================================ */

let promessa = null;

/** Resolve com { cv }. Use: const { cv } = await carregarOpenCV(); */
export function carregarOpenCV() {
  if (promessa) return promessa;

  // O módulo do OpenCV tem um .then próprio: se fosse resolvido direto (ou devolvido
  // por um .then), a Promise chamaria esse .then para sempre. Por isso viaja numa caixa { cv }.
  promessa = new Promise((resolveCaixa, reject) => {
    const resolve = (cv) => resolveCaixa({ cv });
    const pronto = (cv) => {
      if (cv && typeof cv.then === 'function') {
        cv.then((real) => resolve(real && real.Mat ? real : window.cv), reject);
      } else {
        resolve(cv);
      }
    };

    if (window.cv && window.cv.Mat) { resolve(window.cv); return; }

    const script = document.createElement('script');
    script.src = new URL('../lib/opencv.js', import.meta.url).href;
    script.async = true;
    script.onload = () => {
      const cv = window.cv;
      if (!cv) { reject(new Error('OpenCV não inicializou.')); return; }
      if (cv.Mat) { resolve(cv); return; }
      if (typeof cv.then === 'function') { pronto(cv); return; }
      cv.onRuntimeInitialized = () => resolve(window.cv);
    };
    script.onerror = () => reject(new Error('Não foi possível baixar o OpenCV.'));
    document.head.appendChild(script);
  }).catch((e) => { promessa = null; throw e; });

  return promessa;
}

/** Começa a baixar em segundo plano (ignora erro: a leitura tenta de novo ao abrir a câmera). */
export function precarregarOpenCV() {
  carregarOpenCV().catch(() => {});
}

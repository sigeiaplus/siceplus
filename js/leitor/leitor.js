/* ============================================================
   SICEP+ · Leitor óptico (OpenCV.js)
   ------------------------------------------------------------
   Este módulo não toca no DOM: recebe `cv` e imagens RGBA
   ({ data, width, height }) e devolve dados puros. Assim roda
   no navegador e também em testes no Node.

   Fluxo do cartão:
     1. detectarMarcadores  → acha os 4 quadrados pretos
     2. alinharCartao       → endireita a folha (perspectiva)
     3. lerBolhas           → decide a alternativa de cada questão
   E, antes de tudo, lerQR para identificar o caderno.
   ============================================================ */

import { FOLHA, centrosMarcadores } from './geometria.js';

export const PX_POR_MM = 5;

/** Limiares de preenchimento (0 = papel, 1 = totalmente preta). */
export const LIMIAR = {
  marcada: 0.26,   // a partir daqui conta como marcada
  fraca: 0.13,     // entre fraca e marcada → pede conferência
  dominancia: 0.6, // 2ª maior marca precisa ficar abaixo de 60% da 1ª
};

/* ---------------- utilidades ---------------- */

function coletor(cv) {
  const lixo = [];
  const novo = (...args) => { const m = new cv.Mat(...args); lixo.push(m); return m; };
  const guardar = (m) => { lixo.push(m); return m; };
  const limpar = () => { lixo.forEach((m) => { try { m.delete(); } catch (_) { /* já liberado */ } }); lixo.length = 0; };
  return { novo, guardar, limpar };
}

export function matDeImagem(cv, imagem) {
  return cv.matFromImageData({ data: imagem.data, width: imagem.width, height: imagem.height });
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function areaPoligono(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function convexo(p) {
  let sinal = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (z === 0) continue;
    const s = z > 0 ? 1 : -1;
    if (sinal === 0) sinal = s; else if (s !== sinal) return false;
  }
  return true;
}

const impar = (n) => { const v = Math.max(3, Math.round(n)); return v % 2 ? v : v + 1; };

/* ---------------- 1. Marcadores dos cantos ---------------- */

/**
 * Procura os 4 quadrados pretos cheios. Funciona em quadros pequenos
 * (leitura ao vivo) e em fotos grandes (captura final).
 * Retorna { ok, cantos:[{x,y}×4 em sentido horário, coords da imagem original], achados, ocupacao }.
 */
export function detectarMarcadores(cv, imagem, { maxLado = 1600 } = {}) {
  const { novo, guardar, limpar } = coletor(cv);
  try {
    const rgba = guardar(matDeImagem(cv, imagem));
    const esc = Math.min(1, maxLado / Math.max(rgba.cols, rgba.rows));
    let pequena = rgba;
    if (esc < 1) {
      pequena = novo();
      cv.resize(rgba, pequena, new cv.Size(Math.round(rgba.cols * esc), Math.round(rgba.rows * esc)), 0, 0, cv.INTER_AREA);
    }
    const W = pequena.cols, H = pequena.rows;

    const cinza = novo();
    cv.cvtColor(pequena, cinza, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(cinza, cinza, new cv.Size(3, 3), 0);

    // Tinta = mais escura que a vizinhança E escura de verdade (40% do brilho do papel).
    // Sem a 2ª condição, a mesa escura em volta da folha "gruda" nos quadrados.
    // (40% do brilho do papel: o quadrado fica ~10–60 e a mesa ≥ 90)
    const amostra = [];
    for (let i = 0; i < cinza.data.length; i += 7) amostra.push(cinza.data[i]);
    const papel = percentil(amostra, 0.985) || 255;

    const local = novo();
    cv.adaptiveThreshold(cinza, local, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, impar(Math.min(W, H) * 0.09), 12);
    const escura = novo();
    cv.threshold(cinza, escura, papel * 0.4, 255, cv.THRESH_BINARY_INV);
    const bin = novo();
    cv.bitwise_and(local, escura, bin);

    const contornos = guardar(new cv.MatVector());
    const hier = novo();
    cv.findContours(bin, contornos, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

    const area = W * H;
    const candidatos = [];
    for (let i = 0; i < contornos.size(); i++) {
      const h = hier.intPtr(0, i);        // [próx, ant, filho, pai]
      if (h[3] !== -1 || h[2] !== -1) continue; // só contornos externos e SEM buraco (QR e letras têm buracos)
      const c = contornos.get(i);
      const a = cv.contourArea(c);
      const rel = a / area;
      if (a < 30 || rel < 0.00004 || rel > 0.02) { c.delete(); continue; }
      const rr = cv.minAreaRect(c);
      const lw = rr.size.width, lh = rr.size.height;
      const razao = lw / Math.max(lh, 1e-6);
      const cheio = a / Math.max(lw * lh, 1e-6);
      if (razao < 0.6 || razao > 1.67 || cheio < 0.76) { c.delete(); continue; }
      const m = cv.moments(c);
      c.delete();
      if (!m.m00) continue;
      candidatos.push({ x: m.m10 / m.m00, y: m.m01 / m.m00, lado: Math.sqrt(a) });
    }

    if (candidatos.length < 4) return { ok: false, cantos: null, achados: candidatos.length };

    // Entre todos os quadrados, escolhe a quádrupla que forma o maior quadrilátero
    // plausível (os marcadores ficam nos cantos da folha; bolinhas e letras ficam dentro).
    const pool = candidatos.sort((p, q) => q.lado - p.lado).slice(0, 16);
    let melhorQuad = null;
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++)
      for (let k = j + 1; k < pool.length; k++) for (let l = k + 1; l < pool.length; l++) {
        const grupo = [pool[i], pool[j], pool[k], pool[l]];
        const lados = grupo.map((c) => c.lado);
        if (Math.max(...lados) / Math.min(...lados) > 1.8) continue;
        const cx = grupo.reduce((t, c) => t + c.x, 0) / 4, cy = grupo.reduce((t, c) => t + c.y, 0) / 4;
        grupo.sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx)); // sentido horário
        if (!convexo(grupo)) continue;
        const ar = areaPoligono(grupo);
        if (ar < 0.05 * area || (melhorQuad && ar <= melhorQuad.ar)) continue;
        const [p0, p1, p2, p3] = grupo;
        const r1 = dist(p0, p1) / dist(p3, p2), r2 = dist(p0, p3) / dist(p1, p2);
        if (r1 < 0.55 || r1 > 1.8 || r2 < 0.55 || r2 > 1.8) continue;
        // O formato precisa lembrar a folha (≈ 1 : 1,5), em pé ou deitada.
        const curto = (dist(p0, p1) + dist(p3, p2)) / 2, longo = (dist(p0, p3) + dist(p1, p2)) / 2;
        const prop = Math.max(curto, longo) / Math.min(curto, longo);
        if (prop < 1.2 || prop > 1.95) continue;
        melhorQuad = { grupo, ar };
      }
    if (!melhorQuad) return { ok: false, cantos: null, achados: candidatos.length };
    const escolhidos = melhorQuad.grupo;

    return {
      ok: true,
      cantos: escolhidos.map((p) => ({ x: p.x / esc, y: p.y / esc })),
      achados: candidatos.length,
      ocupacao: melhorQuad.ar / area, // fração do quadro ocupada pelo cartão (0–1)
    };
  } finally {
    limpar();
  }
}

/* ---------------- 2. Alinhamento (perspectiva) ---------------- */

function ptsMat(cv, pts) {
  return cv.matFromArray(4, 1, cv.CV_32FC2, pts.flatMap((p) => [p.x, p.y]));
}

function mult3(A, B) {
  const R = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) R[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return R;
}

function destinoPx() {
  return centrosMarcadores().map((p) => ({ x: p.x * PX_POR_MM, y: p.y * PX_POR_MM }));
}

/**
 * Densidade de tinta (0–1) numa região da folha endireitada, em mm.
 * Usa limiar adaptativo, então sombra e luz irregular não contam como tinta.
 */
function densidadeTinta(cv, cinza, x0, y0, x1, y1) {
  const S = PX_POR_MM;
  const rect = new cv.Rect(Math.round(x0 * S), Math.round(y0 * S), Math.round((x1 - x0) * S), Math.round((y1 - y0) * S));
  const roi = cinza.roi(rect);
  const bin = new cv.Mat();
  try {
    cv.adaptiveThreshold(roi, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 41, 12);
    return cv.countNonZero(bin) / (rect.width * rect.height);
  } finally {
    roi.delete(); bin.delete();
  }
}

/**
 * Centro de um quadrado preto dentro de uma janela (mm) da folha já endireitada.
 * Só aceita blobs que sejam realmente quadrados de ~7 mm (bolinha preenchida não passa).
 */
function centroLocal(cv, cinza, cx, cy, janelaMm) {
  const S = PX_POR_MM;
  const x0 = Math.max(0, Math.round((cx - janelaMm) * S)), y0 = Math.max(0, Math.round((cy - janelaMm) * S));
  const x1 = Math.min(cinza.cols, Math.round((cx + janelaMm) * S)), y1 = Math.min(cinza.rows, Math.round((cy + janelaMm) * S));
  if (x1 - x0 < 10 || y1 - y0 < 10) return null;
  const roi = cinza.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
  const bin = new cv.Mat(), contornos = new cv.MatVector(), hier = new cv.Mat();
  try {
    // Limiar fixo em relação ao papel da janela (Otsu confundiria a mesa cinza com tinta).
    const amostra = [];
    const dados = roi.data, passo = roi.step ? roi.step[0] : roi.cols;
    for (let y = 0; y < roi.rows; y += 2) for (let x = 0; x < roi.cols; x += 2) amostra.push(dados[y * passo + x]);
    cv.threshold(roi, bin, (percentil(amostra, 0.9) || 255) * 0.42, 255, cv.THRESH_BINARY_INV);
    cv.findContours(bin, contornos, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let melhor = null;
    for (let i = 0; i < contornos.size(); i++) {
      const c = contornos.get(i);
      const a = cv.contourArea(c);
      const rr = cv.minAreaRect(c);
      const m = cv.moments(c);
      c.delete();
      if (!melhor || a > melhor.a) melhor = { a, rr, m };
    }
    if (!melhor || !melhor.m.m00) return null;
    const lado = Math.sqrt(melhor.a) / S;                       // mm
    const cheio = melhor.a / Math.max(melhor.rr.size.width * melhor.rr.size.height, 1e-6);
    const razao = melhor.rr.size.width / Math.max(melhor.rr.size.height, 1e-6);
    if (lado < 5.2 || lado > 9 || cheio < 0.86 || razao < 0.8 || razao > 1.25) return null;
    return { x: (x0 + melhor.m.m10 / melhor.m.m00) / S, y: (y0 + melhor.m.m01 / melhor.m.m00) / S };
  } finally {
    roi.delete(); bin.delete(); contornos.delete(); hier.delete();
  }
}

/**
 * Endireita a folha. Descobre sozinho a rotação (cartão de cabeça para baixo
 * ou deitado) e refina a posição dos 4 marcadores já na imagem corrigida.
 * Retorna { ok, cinza: Mat, rgba: Mat, M: number[9] } — quem chama deve dar .delete() nos Mats.
 * Se os 4 marcadores não baterem com o cartão, retorna { ok: false }.
 */
export function alinharCartao(cv, imagem, cantos) {
  const { novo, guardar, limpar } = coletor(cv);
  const S = PX_POR_MM;
  const largPx = Math.round(FOLHA.largura * S), altPx = Math.round(FOLHA.altura * S);
  const dst = destinoPx();
  const dsize = new cv.Size(largPx, altPx);

  try {
    const rgba = guardar(matDeImagem(cv, imagem));
    const cinzaOrig = novo();
    cv.cvtColor(rgba, cinzaOrig, cv.COLOR_RGBA2GRAY);

    const homografia = (pts) => {
      const a = ptsMat(cv, pts), b = ptsMat(cv, dst);
      const M = cv.getPerspectiveTransform(a, b);
      const arr = Array.from(M.data64F);
      a.delete(); b.delete(); M.delete();
      return arr;
    };
    const aplicar = (origem, arr, interp = cv.INTER_LINEAR) => {
      const Mm = cv.matFromArray(3, 3, cv.CV_64F, arr);
      const out = new cv.Mat();
      cv.warpPerspective(origem, out, Mm, dsize, interp, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
      Mm.delete();
      return out;
    };

    // Testa as 4 rotações possíveis: a certa deixa o QR (densidade alta) no canto superior direito.
    const candidatosK = [0, 1, 2, 3];

    let melhor = null;
    for (const k of candidatosK) {
      const pts = [0, 1, 2, 3].map((i) => cantos[(k + i) % 4]);
      const arr = homografia(pts);
      const w = aplicar(cinzaOrig, arr);
      // O QR (canto superior direito) é a região mais densa da folha. Se, depois de
      // endireitar, a densidade estiver no canto oposto, a folha está de cabeça para baixo.
      const dA = densidadeTinta(cv, w, 142, 14, 172, 44), dB = densidadeTinta(cv, w, 14, 229, 44, 259);
      const pontos = dA - dB;
      if (!melhor || pontos > melhor.pontos) {
        if (melhor) melhor.w.delete();
        melhor = { arr, w, pontos, pts };
      } else {
        w.delete();
      }
    }

    // Refino: mede os 4 marcadores na folha endireitada e corrige a homografia.
    let M = melhor.arr;
    const esperados = centrosMarcadores();
    const medidos = esperados.map((p) => centroLocal(cv, melhor.w, p.x, p.y, 6));
    const confere = medidos.every((m, i) => m && Math.hypot(m.x - esperados[i].x, m.y - esperados[i].y) < 4);
    if (!confere) {
      // Os 4 quadrados não caíram onde o cartão manda: não era a folha (ou veio torta demais).
      melhor.w.delete();
      return { ok: false };
    }
    const a = ptsMat(cv, medidos.map((m) => ({ x: m.x * S, y: m.y * S })));
    const b = ptsMat(cv, dst);
    const M2m = cv.getPerspectiveTransform(a, b);
    M = mult3(Array.from(M2m.data64F), M);
    a.delete(); b.delete(); M2m.delete();
    melhor.w.delete();

    const cinza = aplicar(cinzaOrig, M);
    const rgbaAlinhada = aplicar(rgba, M);
    return { ok: true, cinza, rgba: rgbaAlinhada, M };
  } finally {
    limpar();
  }
}

/* ---------------- 3. Leitura das bolinhas ---------------- */

function percentil(valores, p) {
  const v = [...valores].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
}

/** Remove sombras: divide a imagem pelo "fundo" (papel sem tinta). */
function normalizarIluminacao(cv, cinza) {
  const fundo = new cv.Mat(), norm = new cv.Mat();
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(51, 51));
  try {
    cv.dilate(cinza, fundo, k);
    cv.GaussianBlur(fundo, fundo, new cv.Size(41, 41), 0);
    cv.divide(cinza, fundo, norm, 255, cv.CV_8U);
    return norm;
  } finally {
    fundo.delete(); k.delete();
  }
}

/**
 * Decide a alternativa de cada questão.
 * @returns {{ leituras: {numero:number, detectada:string|null, estado:string, preenchimento:Object}[], papel:number }}
 */
export function lerBolhas(cv, cinzaAlinhada, layout, limiar = LIMIAR) {
  const norm = normalizarIluminacao(cv, cinzaAlinhada);
  try {
    const { data, cols, rows } = norm;
    const S = PX_POR_MM;

    const medias = layout.bolhas.map((b) => {
      const cx = b.x * S, cy = b.y * S;
      const r = (b.d * S) / 2 * 0.62;
      let soma = 0, n = 0;
      const xa = Math.max(0, Math.floor(cx - r)), xb = Math.min(cols - 1, Math.ceil(cx + r));
      const ya = Math.max(0, Math.floor(cy - r)), yb = Math.min(rows - 1, Math.ceil(cy + r));
      for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) { soma += data[y * cols + x]; n++; }
        }
      }
      return n ? soma / n : 255;
    });

    // Referência: bolinha vazia (papel + letra impressa). O percentil 75 resiste a muitas marcas.
    const papel = percentil(medias, 0.75) || 255;

    const porQuestao = new Map();
    layout.bolhas.forEach((b, i) => {
      const f = Math.max(0, Math.min(1, (papel - medias[i]) / papel));
      if (!porQuestao.has(b.numero)) porQuestao.set(b.numero, []);
      porQuestao.get(b.numero).push({ alt: b.alt, f });
    });

    const leituras = layout.numeros.map((q) => {
      if (q.anulada) return { numero: q.numero, detectada: null, estado: 'anulada', preenchimento: {} };
      const alts = (porQuestao.get(q.numero) || []).slice().sort((a, b) => b.f - a.f);
      const preenchimento = Object.fromEntries(alts.map((a) => [a.alt, Number(a.f.toFixed(3))]));
      const [p1, p2] = alts;
      if (!p1 || p1.f < limiar.fraca) return { numero: q.numero, detectada: null, estado: 'branco', preenchimento };
      if (p1.f < limiar.marcada) return { numero: q.numero, detectada: null, estado: 'fraca', preenchimento };
      if (p2 && p2.f >= limiar.marcada && p2.f >= p1.f * limiar.dominancia) {
        return { numero: q.numero, detectada: null, estado: 'multipla', preenchimento };
      }
      return { numero: q.numero, detectada: p1.alt, estado: 'ok', preenchimento };
    });

    return { leituras, papel };
  } finally {
    norm.delete();
  }
}

/* ---------------- Revisão visual ---------------- */

/**
 * Desenha a folha endireitada com um anel em cada bolinha detectada
 * (verde = lida, amarelo = precisa de conferência).
 */
export function desenharRevisao(canvas, rgba, layout, leituras, larguraSaida = 720) {
  const esc = larguraSaida / rgba.cols;
  canvas.width = larguraSaida;
  canvas.height = Math.round(rgba.rows * esc);

  const tmp = document.createElement('canvas');
  tmp.width = rgba.cols; tmp.height = rgba.rows;
  tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows), 0, 0);

  const ctx = canvas.getContext('2d');
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);

  const S = PX_POR_MM * esc;
  const estado = new Map(leituras.map((l) => [l.numero, l]));
  layout.bolhas.forEach((b) => {
    const l = estado.get(b.numero);
    if (!l) return;
    const marcada = l.detectada === b.alt;
    const pend = ['multipla', 'fraca'].includes(l.estado) && (l.preenchimento[b.alt] || 0) >= LIMIAR.fraca;
    if (!marcada && !pend) return;
    ctx.beginPath();
    ctx.arc(b.x * S, b.y * S, (b.d * S) / 2 + 2, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = marcada ? '#1E9E4A' : '#F2B600';
    ctx.stroke();
  });
}

/* ---------------- QR Code do caderno ---------------- */

/**
 * Lê o QR com OpenCV (várias escalas). Retorna o texto ou null.
 * `fallbackCanvas` (opcional) habilita o BarcodeDetector nativo quando existir.
 */
export async function lerQR(cv, imagem, fallbackCanvas = null) {
  const { novo, guardar, limpar } = coletor(cv);
  try {
    if (cv.QRCodeDetector) {
      const rgba = guardar(matDeImagem(cv, imagem));
      const cinza = novo();
      cv.cvtColor(rgba, cinza, cv.COLOR_RGBA2GRAY);

      const detector = new cv.QRCodeDetector();
      try {
        for (const escala of [1, 0.6, 0.35, 1.6]) {
          const alvo = escala === 1 ? cinza : novo();
          if (escala !== 1) {
            cv.resize(cinza, alvo, new cv.Size(Math.round(cinza.cols * escala), Math.round(cinza.rows * escala)), 0, 0, escala < 1 ? cv.INTER_AREA : cv.INTER_CUBIC);
          }
          try {
            const pts = novo();
            const texto = detector.detectAndDecode(alvo, pts);
            if (texto) return String(texto).trim();
          } catch (e) { /* tenta a próxima escala */ }
        }
      } finally {
        try { detector.delete(); } catch (_) { /* ok */ }
      }
    }
  } catch (e) {
    console.warn('[SICEP+] QR via OpenCV:', e);
  } finally {
    limpar();
  }

  if (fallbackCanvas && typeof BarcodeDetector !== 'undefined') {
    try {
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      const achados = await det.detect(fallbackCanvas);
      if (achados[0]?.rawValue) return String(achados[0].rawValue).trim();
    } catch (e) { console.warn('[SICEP+] BarcodeDetector:', e); }
  }
  return null;
}

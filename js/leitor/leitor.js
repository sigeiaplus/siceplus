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

import { FOLHA, MARCADOR, QR, centrosMarcadores, layoutCartao } from './geometria.js';

const LETRAS = ['A', 'B', 'C', 'D', 'E'];

/**
 * Layout (posição em mm de cada número e bolinha) de uma avaliação.
 * É o MESMO cálculo usado na impressão (cartao-svg.js → geometria.js).
 * Lança erro se passar de 50 questões.
 */
export function layoutDeAvaliacao(questoes, numAlternativas = 5) {
  return layoutCartao(questoes, numAlternativas, LETRAS.slice(0, numAlternativas));
}

/** Área (mm) do QR e a área oposta (QR girado 180°), usadas para descobrir a rotação da folha. */
const AREA_QR = { x0: QR.x, y0: QR.y, x1: QR.x + QR.lado, y1: QR.y + QR.lado };
const AREA_OPOSTA = {
  x0: FOLHA.largura - AREA_QR.x1, y0: FOLHA.altura - AREA_QR.y1,
  x1: FOLHA.largura - AREA_QR.x0, y1: FOLHA.altura - AREA_QR.y0,
};
/** Tolerâncias em função do marcador (7 mm): lado aceito de 0,74× a 1,29×. */
const LADO_MIN_MM = MARCADOR.lado * 0.74, LADO_MAX_MM = MARCADOR.lado * 1.29;

export const PX_POR_MM = 5;

/** Limiares de preenchimento (0 = papel, 1 = totalmente preta). */
/**
 * Parâmetros de leitura (Plano B). Todos podem ser ajustados sem mexer no código:
 * passe `params` para lerBolhas / processarCartao (ou use salvarParametros em omr.js).
 *  - marcada / fraca: fração de preenchimento (0–1) para contar como marcada / marca fraca
 *  - dominancia: 2ª marca ≥ esta fração da 1ª e também "marcada" → marcação dupla
 *  - incerteza: 2ª marca ≥ esta fração da 1ª e ≥ `fraca` → leitura incerta (vai para conferência)
 *  - raioAmostra: fração do raio da bolinha medida (0,62 = miolo, evita o contorno impresso)
 *  - percentilPapel: percentil das bolinhas usado como "papel vazio" de referência
 *  - minGrade: fração mínima de bolinhas com contorno achado (verificarGrade)
 *  - maxLado: maior lado (px) da imagem na busca dos marcadores
 *  - conferirBranco: true = questão em branco também pede conferência
 */
export const PARAMS_PADRAO = {
  marcada: 0.32,
  fraca: 0.13,
  dominancia: 0.6,
  incerteza: 0.35,
  raioAmostra: 0.62,
  percentilPapel: 0.75,
  minGrade: 0.8,
  maxLado: 1600,
  conferirBranco: false,
};

/** Compatibilidade: só os limiares de decisão. */
export const LIMIAR = {
  marcada: PARAMS_PADRAO.marcada,
  fraca: PARAMS_PADRAO.fraca,
  dominancia: PARAMS_PADRAO.dominancia,
};

const FAIXAS = {
  marcada: [0.05, 0.95], fraca: [0.01, 0.9], dominancia: [0.1, 1], incerteza: [0.05, 1],
  raioAmostra: [0.3, 0.9], percentilPapel: [0.5, 0.95], minGrade: [0.3, 1], maxLado: [600, 4000],
};

/** Junta os parâmetros recebidos com os padrões, ignorando valores inválidos. */
export function mesclarParams(p = {}) {
  const r = { ...PARAMS_PADRAO };
  for (const k of Object.keys(FAIXAS)) {
    const v = Number(p?.[k]);
    if (p && p[k] !== undefined && p[k] !== null && p[k] !== '' && Number.isFinite(v)) {
      r[k] = Math.min(FAIXAS[k][1], Math.max(FAIXAS[k][0], v));
    }
  }
  if (typeof p?.conferirBranco === 'boolean') r.conferirBranco = p.conferirBranco;
  if (r.fraca >= r.marcada) { r.fraca = PARAMS_PADRAO.fraca; r.marcada = PARAMS_PADRAO.marcada; } // fraca sempre < marcada
  return r;
}

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
    // Atenção: em OpenCV.js o `data` de um recorte (roi) vem truncado; lê-se da imagem inteira.
    const dados = cinza.data, passo = cinza.cols;
    for (let y = 0; y < roi.rows; y += 2) for (let x = 0; x < roi.cols; x += 2) amostra.push(dados[(y0 + y) * passo + (x0 + x)]);
    // Limiar fixo em relação ao papel da janela (42%): a mesa escura fica de fora do quadrado.
    const limiarLocal = (percentil(amostra, 0.9) || 255) * 0.42;
    cv.threshold(roi, bin, limiarLocal, 255, cv.THRESH_BINARY_INV);
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
    if (lado < LADO_MIN_MM || lado > LADO_MAX_MM || cheio < 0.86 || razao < 0.8 || razao > 1.25) return null;
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
      const dA = densidadeTinta(cv, w, AREA_QR.x0, AREA_QR.y0, AREA_QR.x1, AREA_QR.y1);
      const dB = densidadeTinta(cv, w, AREA_OPOSTA.x0, AREA_OPOSTA.y0, AREA_OPOSTA.x1, AREA_OPOSTA.y1);
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
 *
 * Estados: 'ok' (única marca firme), 'branco', 'fraca' (marca clara demais para confiar),
 * 'multipla' (duas marcas firmes), 'incerta' (uma marca firme mas outra bem visível) e 'anulada'.
 * REGRA: só o estado 'ok' preenche `detectada`. Nos estados duvidosos `detectada` fica null
 * (nada é contado como resposta) e `confere` = true; a alternativa mais provável vai em `sugestao`
 * só para ajudar a conferência manual.
 *
 * @param params  parâmetros parciais (ver PARAMS_PADRAO); também aceita o objeto LIMIAR antigo.
 */
export function lerBolhas(cv, cinzaAlinhada, layout, params = {}) {
  const P = mesclarParams(params);
  const norm = normalizarIluminacao(cv, cinzaAlinhada);
  try {
    const { data, cols, rows } = norm;
    const S = PX_POR_MM;

    const medias = layout.bolhas.map((b) => {
      const cx = b.x * S, cy = b.y * S;
      const r = (b.d * S) / 2 * P.raioAmostra;
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

    // Referência: bolinha vazia (papel + letra impressa). O percentil resiste a muitas marcas.
    const papel = percentil(medias, P.percentilPapel) || 255;

    const porQuestao = new Map();
    layout.bolhas.forEach((b, i) => {
      const f = Math.max(0, Math.min(1, (papel - medias[i]) / papel));
      if (!porQuestao.has(b.numero)) porQuestao.set(b.numero, []);
      porQuestao.get(b.numero).push({ alt: b.alt, f });
    });

    const leituras = layout.numeros.map((q) => {
      if (q.anulada) {
        return { numero: q.numero, detectada: null, estado: 'anulada', confere: false, sugestao: null, confianca: 1, preenchimento: {} };
      }
      const alts = (porQuestao.get(q.numero) || []).slice().sort((a, b) => b.f - a.f);
      const preenchimento = Object.fromEntries(alts.map((a) => [a.alt, Number(a.f.toFixed(3))]));
      const [p1, p2] = alts;
      const base = { numero: q.numero, detectada: null, sugestao: null, confere: false, preenchimento };
      const confianca = p1 ? Number((p1.f - (p2 ? p2.f : 0)).toFixed(3)) : 0;

      if (!p1 || p1.f < P.fraca) return { ...base, estado: 'branco', confere: P.conferirBranco, confianca };
      if (p1.f < P.marcada) return { ...base, estado: 'fraca', confere: true, sugestao: p1.alt, confianca };
      if (p2 && p2.f >= P.marcada && p2.f >= p1.f * P.dominancia) {
        return { ...base, estado: 'multipla', confere: true, sugestao: p1.alt, confianca };
      }
      if (p2 && p2.f >= P.fraca && p2.f >= p1.f * P.incerteza) {
        return { ...base, estado: 'incerta', confere: true, sugestao: p1.alt, confianca };
      }
      return { ...base, estado: 'ok', detectada: p1.alt, confianca };
    });

    return { leituras, papel };
  } finally {
    norm.delete();
  }
}

/**
 * Confere se a grade do layout bate com o cartão fotografado: o contorno impresso de cada
 * bolinha precisa aparecer na posição prevista. Pega cartão de outra versão (ex.: impresso
 * antes da geometria v3) ou foto torta demais, em vez de ler lixo em silêncio.
 * @returns {{ ok:boolean, razao:number }} razao = fração de bolinhas com contorno encontrado
 */
export function verificarGrade(cv, cinzaAlinhada, layout, minimo = PARAMS_PADRAO.minGrade) {
  const { data, cols, rows } = cinzaAlinhada;
  const S = PX_POR_MM;
  const px = (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    return xi < 0 || yi < 0 || xi >= cols || yi >= rows ? 255 : data[yi * cols + xi];
  };
  let boas = 0, total = 0;
  const N = 24;
  for (const b of layout.bolhas) {
    const r = (b.d / 2) * S, cx = b.x * S, cy = b.y * S;
    let angulosBons = 0;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let anel = 255;
      for (let d = -1; d <= 1; d++) anel = Math.min(anel, px(cx + (r + d) * ca, cy + (r + d) * sa));
      const fora = px(cx + (r + 0.55 * S) * ca, cy + (r + 0.55 * S) * sa);
      if (fora > 0 && (fora - anel) / fora > 0.06) angulosBons++;
    }
    total++;
    if (angulosBons / N >= 0.5) boas++;   // o contorno aparece em pelo menos metade da volta
  }
  const razao = total ? boas / total : 0;
  return { ok: razao >= minimo, razao: Number(razao.toFixed(3)) };
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
    const pend = ['multipla', 'fraca', 'incerta'].includes(l.estado) && (l.preenchimento[b.alt] || 0) >= LIMIAR.fraca;
    if (!marcada && !pend) return;
    ctx.beginPath();
    ctx.arc(b.x * S, b.y * S, (b.d * S) / 2 + 2, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = marcada ? '#1E9E4A' : '#F2B600';
    ctx.stroke();
  });
}

/**
 * Lê o QR já na folha endireitada (recorte de ~36 mm, ampliado): bem mais robusto que
 * procurar o QR na foto inteira, porque o cartão já está de frente e na escala certa.
 * `rgbaAlinhada` é o Mat devolvido por alinharCartao().rgba. Retorna o texto ou null.
 */
export function lerQRNaFolha(cv, rgbaAlinhada) {
  if (!cv.QRCodeDetector) return null;
  const { novo, guardar, limpar } = coletor(cv);
  try {
    const S = PX_POR_MM, folga = 3;
    const x0 = Math.max(0, Math.round((QR.x - folga) * S)), y0 = Math.max(0, Math.round((QR.y - folga) * S));
    const x1 = Math.min(rgbaAlinhada.cols, Math.round((QR.x + QR.lado + folga) * S));
    const y1 = Math.min(rgbaAlinhada.rows, Math.round((QR.y + QR.lado + folga) * S));
    const roi = guardar(rgbaAlinhada.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0)));
    const cinza = novo();
    cv.cvtColor(roi, cinza, cv.COLOR_RGBA2GRAY);

    const detector = new cv.QRCodeDetector();
    try {
      const tentar = (mat) => {
        try {
          const pts = new cv.Mat();
          const t = detector.detectAndDecode(mat, pts);
          pts.delete();
          return t ? String(t).trim() : null;
        } catch (e) { return null; }
      };
      for (const f of [3, 2, 4]) {
        const grande = novo();
        cv.resize(cinza, grande, new cv.Size(cinza.cols * f, cinza.rows * f), 0, 0, cv.INTER_CUBIC);
        let t = tentar(grande);
        if (t) return t;
        const bin = novo();                                    // binarizado local: ajuda com sombra e desfoque
        cv.adaptiveThreshold(grande, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, impar(grande.cols / 6), 8);
        t = tentar(bin);
        if (t) return t;
        const otsu = novo();
        cv.GaussianBlur(grande, otsu, new cv.Size(3, 3), 0);
        cv.threshold(otsu, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        t = tentar(otsu);
        if (t) return t;
      }
    } finally {
      try { detector.delete(); } catch (_) { /* ok */ }
    }
    return null;
  } catch (e) {
    console.warn('[SICEP+] QR na folha:', e);
    return null;
  } finally {
    limpar();
  }
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

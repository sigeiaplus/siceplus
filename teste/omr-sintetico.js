/* ============================================================
   SICEP+ · teste sintético do leitor OMR (ambiente de desenvolvimento)
   ------------------------------------------------------------
   Nada aqui é usado pelo aplicativo. A página teste/omr-sintetico.html
   monta o cartão com o MESMO código da impressão, converte em uma foto
   sintética (perspectiva, rotação, corte, luz irregular) e roda o
   pipeline real (omr.js + OpenCV.js).

   Testes SINTÉTICOS: validam a coerência entre impressão e leitura e os
   estados de segurança do OMR. NÃO substituem cartão impresso + aparelho.
   ============================================================ */

import { FOLHA, MARCADOR, QR, GEOMETRIA_VERSAO, centrosMarcadores, layoutCartao } from '../js/leitor/geometria.js';
import { montarCartaoSvg } from '../js/leitor/cartao-svg.js';
import { processarCartao } from '../js/leitor/omr.js';
import { montarPayload } from '../js/leitor/qr-caderno.js';
import { carregarOpenCV } from '../js/leitor/opencv-loader.js';

const LETRAS = ['A', 'B', 'C', 'D', 'E'];
const SAIDA = document.getElementById('saida');
const ESTADO = document.getElementById('estado');
const CANVAS_FOTO = document.getElementById('foto');

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const mm = (v) => Math.round(v * 1000) / 1000;

/* ---------------- QR ---------------- */

function qrObjeto(texto) {
  const qr = window.qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  return qr;
}

/* ---------------- Cartão renderizado em pixels ---------------- */

/** Renderiza o SVG do cartão em um canvas a `pxPorMm` pixels por milímetro. */
async function canvasDoCartao(svgTexto, pxPorMm) {
  const w = Math.round(FOLHA.largura * pxPorMm);
  const h = Math.round(FOLHA.altura * pxPorMm);
  const ajustado = svgTexto.replace(
    /width="[\d.]+mm"\s+height="[\d.]+mm"/,
    `width="${w}" height="${h}"`,
  );
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ajustado);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

/** Marca as bolinhas no canvas do cartão (caneta preta/azul, com pequena imperfeição). */
function marcarBolinhas(canvas, layout, marcas, pxPorMm, semente = 7) {
  const ctx = canvas.getContext('2d');
  let s = semente;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (const m of marcas) {
    const b = layout.bolhas.find((x) => x.numero === m.numero && x.alt === m.alt);
    if (!b) throw new Error(`bolinha inexistente: questão ${m.numero} ${m.alt}`);
    const jx = (rnd() - 0.5) * 0.5, jy = (rnd() - 0.5) * 0.5;   // preenchimento humano nunca é perfeito
    const r = (b.d / 2) * (m.fraca ? 0.6 : 1) * (0.92 + rnd() * 0.1);
    ctx.beginPath();
    ctx.ellipse(
      (b.x + jx) * pxPorMm, (b.y + jy) * pxPorMm,
      r * pxPorMm, r * pxPorMm, rnd() * Math.PI, 0, Math.PI * 2,
    );
    ctx.fillStyle = `rgba(${m.fraca ? '40,50,80' : '24,32,58'},${m.fraca ? (m.forca ?? 0.3) : 0.95})`;
    ctx.fill();
  }
}

/* ---------------- Homografia ---------------- */

function resolver(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    if (Math.abs(A[p][i]) < 1e-12) throw new Error('homografia singular');
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      if (!f) continue;
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let t = b[i];
    for (let j = i + 1; j < n; j++) t -= A[i][j] * x[j];
    x[i] = t / A[i][i];
  }
  return x;
}

/** H (3×3) que leva o retângulo do cartão (0..w, 0..h) ao quadrilátero `quad` da foto. */
function homografia(w, h, quad) {
  const src = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = src[i], { x, y } = quad[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  const r = resolver(A, b);
  return [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], 1];
}

function inverter(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

/* ---------------- Foto sintética ---------------- */

const amostrar = (data, w, h, x, y, canais = 4) => {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const out = [0, 0, 0, 255];
  for (let c = 0; c < 3; c++) {
    const p00 = data[(y0 * w + x0) * canais + c];
    const p10 = data[(y0 * w + x1) * canais + c];
    const p01 = data[(y1 * w + x0) * canais + c];
    const p11 = data[(y1 * w + x1) * canais + c];
    out[c] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
  }
  return out;
};

/**
 * Gera a “foto”: quadrilátero do cartão dentro de uma cena, com fundo de mesa,
 * luz irregular, leve desfoque (amostragem bilinear) e ruído.
 */
function fotografar(cartao, { largura, altura, quad, fundo = [96, 100, 108], luz = 0, ruido = 4, semente = 3 }) {
  const cw = cartao.width, ch = cartao.height;
  const origem = cartao.getContext('2d').getImageData(0, 0, cw, ch).data;
  const H = homografia(cw, ch, quad);
  const Hi = inverter(H);
  const out = new ImageData(largura, altura);
  const d = out.data;
  let s = semente;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };

  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const w = Hi[6] * x + Hi[7] * y + Hi[8];
      const u = (Hi[0] * x + Hi[1] * y + Hi[2]) / w;
      const v = (Hi[3] * x + Hi[4] * y + Hi[5]) / w;
      const i = (y * largura + x) * 4;
      let r, g, bl;
      if (u >= 0 && u <= cw - 1 && v >= 0 && v <= ch - 1) {
        const p = amostrar(origem, cw, ch, u, v);
        r = p[0]; g = p[1]; bl = p[2];
        if (luz) {
          // sombra diagonal + queda de luz nas bordas (iluminação irregular)
          const k = 1 + luz * (0.55 * (x / largura - 0.5) - 0.35 * (y / altura - 0.5));
          r *= k; g *= k; bl *= k;
        }
      } else {
        const n = rnd() * 10;
        r = fundo[0] + n; g = fundo[1] + n; bl = fundo[2] + n;
      }
      const nz = ruido ? (rnd() - 0.5) * ruido : 0;
      d[i] = Math.max(0, Math.min(255, r + nz));
      d[i + 1] = Math.max(0, Math.min(255, g + nz));
      d[i + 2] = Math.max(0, Math.min(255, bl + nz));
      d[i + 3] = 255;
    }
  }
  return out;
}

/* ---------------- Cartão de uma versão antiga (v3: 3 colunas) ---------------- */

function svgLegadoV3(questoes, letras, cols) {
  const rows = Math.ceil(questoes.length / cols);
  const reg = { x0: 12, y0: 62, x1: 174, y1: 252 };
  const alt = Math.min(14, (reg.y1 - reg.y0) / rows);
  const largCol = (reg.x1 - reg.x0) / cols;
  const passo = (largCol - 2.5 - (cols >= 4 ? 5.5 : 7) - 0.8) / letras.length;
  const diam = Math.min(6, passo * 0.82, alt * 0.7);
  const L = { largura: FOLHA.largura, altura: FOLHA.altura };
  const c = MARCADOR.recuo + MARCADOR.lado / 2;
  const marc = [
    [MARCADOR.recuo, MARCADOR.recuo], [L.largura - MARCADOR.recuo - MARCADOR.lado, MARCADOR.recuo],
    [MARCADOR.recuo, L.altura - MARCADOR.recuo - MARCADOR.lado],
    [L.largura - MARCADOR.recuo - MARCADOR.lado, L.altura - MARCADOR.recuo - MARCADOR.lado],
  ].map(([x, y]) => `<rect x="${x}" y="${y}" width="${MARCADOR.lado}" height="${MARCADOR.lado}" fill="#101318"/>`).join('');
  const qr = qrObjeto('SICEP-A');
  const n = qr.getModuleCount();
  const m = QR.lado / n;
  let q = '';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
    if (qr.isDark(r, col)) q += `M${(QR.x + col * m).toFixed(2)} ${(QR.y + r * m).toFixed(2)}h${m.toFixed(2)}v${m.toFixed(2)}h-${m.toFixed(2)}z`;
  }
  let bolhas = '';
  questoes.forEach((qst, i) => {
    const col = Math.floor(i / rows), lin = i % rows;
    const yc = reg.y0 + alt * (lin + 0.5);
    const xCol = reg.x0 + col * largCol;
    bolhas += `<text x="${xCol + 7}" y="${yc + 1}" font-size="3" font-weight="700">${String(qst.numero).padStart(2, '0')}</text>`;
    letras.forEach((letra, a) => {
      const bx = xCol + 7 + 0.8 + passo * (a + 0.5);
      bolhas += `<circle cx="${bx.toFixed(2)}" cy="${yc.toFixed(2)}" r="${(diam / 2).toFixed(2)}" fill="none" stroke="#101318" stroke-width="0.25"/>`;
      bolhas += `<text x="${bx.toFixed(2)}" y="${(yc + diam * 0.16).toFixed(2)}" font-size="${(diam * 0.42).toFixed(2)}" text-anchor="middle" fill="#666">${letra}</text>`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.largura} ${L.altura}" width="${L.largura}mm" height="${L.altura}mm">
    <rect width="${L.largura}" height="${L.altura}" fill="#fff"/>${marc}<path d="${q}" fill="#000"/>${bolhas}</svg>`;
}

/* ---------------- Cenários ---------------- */

const CASO = {
  nome: 'Cartão SICEP+ · teste',
  escola: 'Escola Estadual de Teste',
  turma: '1º ano A',
  disciplina: 'Matemática',
  avaliacao: 'Avaliação diagnóstica',
  data: '17/11/2026',
  caderno: 'A',
};

const questoesDe = (n) => Array.from({ length: n }, (_, i) => ({ numero: i + 1, anulada: false }));
const letrasDe = (n) => LETRAS.slice(0, n);

/** Respostas esperadas + tipos de marca por questão. */
function marcasPadrao(n, alts) {
  const marcas = [], esperado = {}, tipo = {};
  for (let q = 1; q <= n; q++) {
    if (q === 4) { tipo[q] = 'branco'; continue; }                 // sem marca
    if (q === 7) { tipo[q] = 'fraca'; marcas.push({ numero: q, alt: 'C', fraca: true }); esperado[q] = null; continue; }
    if (q === 9) {                                                  // marcação dupla
      tipo[q] = 'multipla';
      marcas.push({ numero: q, alt: 'B' }, { numero: q, alt: 'D' });
      esperado[q] = null; continue;
    }
    if (q === 11) {                                                 // marca forte + marca clara
      tipo[q] = 'incerta';
      marcas.push({ numero: q, alt: 'A' }, { numero: q, alt: 'E', fraca: true, forca: 0.62 });
      esperado[q] = null; continue;
    }
    const alt = letrasDe(alts)[(q * 3) % alts];
    tipo[q] = 'ok';
    marcas.push({ numero: q, alt });
    esperado[q] = alt;
  }
  return { marcas, esperado, tipo };
}

/**
 * Quadrilátero da folha na foto. A foto tem `largura`×`altura`; a folha ocupa
 * x0..x1 e y0..y1 com o deslocamento de perspectiva de cada canto.
 */
function enquadrar(largura, altura, proporcaoAltura = 0.86, desvios = [0, 0, 0, 0], deslocamento = [0, 0]) {
  const hFolha = altura * proporcaoAltura;
  const wFolha = hFolha * (FOLHA.largura / FOLHA.altura);
  const cx = largura / 2 + deslocamento[0], cy = altura / 2 + deslocamento[1];
  const x0 = cx - wFolha / 2, x1 = cx + wFolha / 2;
  const y0 = cy - hFolha / 2, y1 = cy + hFolha / 2;
  const [a, b, c, d] = desvios;
  return [
    { x: x0 + a, y: y0 + a * 0.4 },     // superior esquerdo
    { x: x1 - b, y: y0 + b },           // superior direito
    { x: x1 + c, y: y1 - c * 0.5 },     // inferior direito
    { x: x0 - d, y: y1 + d },           // inferior esquerdo
  ];
}

/** Gira o quadrilátero em torno do centro da folha (foto “torta”). */
function girar(quad, graus) {
  const cx = quad.reduce((t, p) => t + p.x, 0) / 4;
  const cy = quad.reduce((t, p) => t + p.y, 0) / 4;
  const r = (graus * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return quad.map((p) => ({ x: cx + (p.x - cx) * c - (p.y - cy) * s, y: cy + (p.x - cx) * s + (p.y - cy) * c }));
}

/* ---------------- Um cenário ---------------- */

async function montarFoto(cenario) {
  const pxPorMm = 8;
  const questoes = questoesDe(cenario.questoes);
  const letras = letrasDe(cenario.alternativas);
  const { marcas } = cenario;
  let canvas;
  let layout;

  if (cenario.cartaoLegado) {
    canvas = await canvasDoCartao(svgLegadoV3(questoes, letras, cenario.cartaoLegado), pxPorMm);
    // posições do cartão antigo (para marcar as bolinhas)
    layout = layoutCartao(questoes, cenario.alternativas, letras);
    layout = {
      ...layout,
      bolhas: layoutCartao(questoes, cenario.alternativas, letras).bolhas.map((b, i) => b),
    };
    // o legado tem outra grade: calcula as posições dele mesmo
    const cols = cenario.cartaoLegado;
    const reg = { x0: 12, y0: 62, x1: 174, y1: 252 };
    const rows = Math.ceil(questoes.length / cols);
    const alt = Math.min(14, (reg.y1 - reg.y0) / rows);
    const largCol = (reg.x1 - reg.x0) / cols;
    const passo = (largCol - 2.5 - (cols >= 4 ? 5.5 : 7) - 0.8) / letras.length;
    const diam = Math.min(6, passo * 0.82, alt * 0.7);
    layout = {
      bolhas: questoes.flatMap((q, i) => {
        const col = Math.floor(i / rows), lin = i % rows;
        const yc = reg.y0 + alt * (lin + 0.5), xCol = reg.x0 + col * largCol;
        return letras.map((alt2, a) => ({
          numero: q.numero, alt: alt2, x: xCol + 7 + 0.8 + passo * (a + 0.5), y: yc, d: diam,
        }));
      }),
    };
  } else {
    const svg = montarCartaoSvg({
      questoes, letras, ...CASO,
      qr: qrObjeto(cenario.qrTexto || 'SICEP-A'),
    });
    canvas = await canvasDoCartao(svg, pxPorMm);
    layout = layoutCartao(questoes, cenario.alternativas, letras);
  }

  marcarBolinhas(canvas, layout, marcas, pxPorMm, 11 + cenario.questoes);
  const foto = fotografar(canvas, cenario.foto);
  CANVAS_FOTO.width = foto.width;
  CANVAS_FOTO.height = foto.height;
  CANVAS_FOTO.getContext('2d').putImageData(foto, 0, 0);
  return foto;
}

async function rodarCenario(cv, cenario) {
  const foto = await montarFoto(cenario);
  const t0 = performance.now();
  const r = await processarCartao(cv, { data: foto.data, width: foto.width, height: foto.height }, {
    questoes: questoesDe(cenario.avaliacaoQuestoes || cenario.questoes),   // o que a AVALIAÇÃO diz ter
    numAlternativas: cenario.avaliacaoAlternativas || cenario.alternativas,
    codigoEsperado: cenario.codigoEsperado || 'SICEP-A',
    params: cenario.params || {},
  });
  const ms = Math.round(performance.now() - t0);

  const lidos = {};
  const estados = {};
  for (const l of r.leituras || []) {
    estados[l.estado] = (estados[l.estado] || 0) + 1;
    if (l.estado === 'ok' && l.detectada) lidos[l.numero] = l.detectada;
  }
  const esperado = {};
  for (const [q, a] of Object.entries(cenario.esperado || {})) if (a) esperado[q] = a;

  const divergencias = [];
  // Cartão bloqueado: nada deve ser lido, então comparar com o gabarito sintético
  // só produziria divergência falsa. O veredito aqui é o motivo do bloqueio.
  if (!r.bloqueado) {
    for (const [q, a] of Object.entries(esperado)) {
      if (lidos[q] !== a) divergencias.push(`Q${q}: esperado ${a}, lido ${lidos[q] || '—'} (${r.leituras?.find((l) => l.numero === Number(q))?.estado})`);
    }
    for (const q of Object.keys(lidos)) {
      if (!esperado[q]) divergencias.push(`Q${q}: leitura automática inesperada (${lidos[q]}) — deveria ir para conferência`);
    }
  }

  return {
    cenario: cenario.nome,
    ok: r.ok,
    bloqueado: r.bloqueado,
    motivo: r.motivo,
    mensagem: r.mensagem,
    etapas: r.etapas,
    aviso: r.aviso,
    estados,
    lidos,
    resumo: r.resumo,
    divergencias,
    ms,
  };
}

/* ---------------- Cenários completos ---------------- */

async function cenarios() {
  const base = (n = 12, alts = 5, extra = {}) => {
    const { marcas, esperado } = marcasPadrao(n, alts);
    return {
      nome: 'válido', questoes: n, alternativas: alts, marcas, esperado,
      foto: { largura: 1600, altura: 2130, quad: enquadrar(1600, 2130) },
      ...extra,
    };
  };

  const F = (q) => ({ largura: 1600, altura: 2130, quad: q });

  return [
    base(12, 5, { nome: 'válido · 12 questões, 5 alternativas' }),
    base(50, 5, {
      nome: 'válido · 50 questões (grade cheia)',
      marcas: (() => { const m = []; for (let q = 1; q <= 50; q++) m.push({ numero: q, alt: LETRAS[(q * 3) % 5] }); return m; })(),
      esperado: (() => { const e = {}; for (let q = 1; q <= 50; q++) e[q] = LETRAS[(q * 3) % 5]; return e; })(),
    }),
    base(10, 4, {
      nome: 'válido · 10 questões, 4 alternativas',
      marcas: Array.from({ length: 10 }, (_, i) => ({ numero: i + 1, alt: LETRAS[i % 4] })),
      esperado: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, LETRAS[i % 4]])),
    }),
    base(12, 5, {
      nome: 'válido · perspectiva leve (foto de lado)',
      foto: F(enquadrar(1600, 2130, 0.84, [46, -38, 22, -30])),
    }),
    base(12, 5, {
      nome: 'válido · girado ~7°',
      foto: F(girar(enquadrar(1600, 2130, 0.8), 7)),
    }),
    base(12, 5, {
      nome: 'válido · iluminação irregular + ruído',
      foto: { largura: 1600, altura: 2130, quad: enquadrar(1600, 2130, 0.82), luz: 0.42, ruido: 9 },
    }),
    base(12, 5, {
      nome: 'válido · foto comprimida (1200×1600)',
      foto: { largura: 1200, altura: 1600, quad: enquadrar(1200, 1600, 0.84), ruido: 6 },
    }),
    base(12, 5, {
      nome: 'cartão cortado (foi impresso/fotografado sem a borda)',
      foto: { largura: 1600, altura: 2130, quad: enquadrar(1600, 2130, 1.12, [0, 0, 0, 0]) },
    }),
    base(12, 5, {
      nome: 'QR de outra avaliação',
      qrTexto: 'SICEP-A',
      codigoEsperado: 'SICEP-B',
    }),
    base(12, 5, {
      nome: 'quantidade de questões incompatível (avaliação tem 15)',
      questoes: 12,
      avaliacaoQuestoes: 15,
    }),
    // QR no formato novo (SICEP1): versão do layout e grade conferidas antes de ler as bolinhas.
    base(12, 5, {
      nome: 'QR versionado · cartão atual (v4)',
      qrTexto: montarPayload({ codigo: 'SICEP-A', caderno: 'B', questoes: 12, alternativas: 5, geometria: 4 }),
    }),
    base(12, 5, {
      nome: 'QR versionado · layout v3 (cartão antigo)',
      qrTexto: montarPayload({ codigo: 'SICEP-A', caderno: 'B', questoes: 12, alternativas: 5, geometria: 3 }),
      esperado: {},
    }),
    base(12, 5, {
      nome: 'QR versionado · 15 questões (avaliação alterada)',
      qrTexto: montarPayload({ codigo: 'SICEP-A', caderno: 'B', questoes: 15, alternativas: 5, geometria: 4 }),
      esperado: {},
    }),
    base(12, 5, {
      nome: 'QR versionado · 4 alternativas (cartão de outro formato)',
      qrTexto: montarPayload({ codigo: 'SICEP-A', caderno: 'B', questoes: 12, alternativas: 4, geometria: 4 }),
      esperado: {},
    }),
    base(12, 5, {
      nome: 'cartão de outra versão (impresso com 3 colunas)',
      cartaoLegado: 3,
      marcas: (() => { const m = []; for (let q = 1; q <= 12; q++) m.push({ numero: q, alt: LETRAS[(q * 2) % 5] }); return m; })(),
      esperado: (() => { const e = {}; for (let q = 1; q <= 12; q++) e[q] = LETRAS[(q * 2) % 5]; return e; })(),
    }),
  ];
}

/* ---------------- Execução ---------------- */

async function rodarTudo(filtro = null) {
  const botao = document.getElementById('rodar');
  botao.disabled = true;
  SAIDA.textContent = 'Carregando OpenCV…';
  const { cv } = await carregarOpenCV();
  const todas = await cenarios();
  const lista = typeof filtro === 'number' ? [todas[filtro]] : todas;
  const resultados = [];
  for (let i = 0; i < lista.length; i++) {
    ESTADO.textContent = `${i + 1}/${lista.length}: ${lista[i].nome}`;
    try {
      resultados.push(await rodarCenario(cv, lista[i]));
    } catch (e) {
      resultados.push({ cenario: lista[i].nome, erro: String(e && e.stack || e) });
    }
    window.__omrResultado = resultados;
    SAIDA.textContent = JSON.stringify(resultados, null, 2);
  }
  ESTADO.textContent = 'concluído';
  SAIDA.textContent = JSON.stringify(resultados, null, 2);
  window.__omrResultado = resultados;
  botao.disabled = false;
  return resultados;
}

window.__omrResultado = null;
window.__cenarios = cenarios;
window.__rodarTestes = rodarTudo;
document.getElementById('rodar').addEventListener('click', () => rodarTudo().catch((e) => {
  SAIDA.textContent = 'ERRO: ' + (e && e.stack || e);
  ESTADO.textContent = 'erro';
  document.getElementById('rodar').disabled = false;
}));

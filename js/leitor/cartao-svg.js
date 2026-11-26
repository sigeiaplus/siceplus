/* ============================================================
   SICEP+ · Desenho do cartão de respostas (SVG em milímetros)
   ------------------------------------------------------------
   Módulo puro (sem DOM): recebe os dados e devolve o texto SVG.
   Todas as posições de questões/bolinhas vêm de geometria.js — a MESMA
   fonte usada pelo leitor (leitor.js). O cabeçalho e o rodapé são apenas
   desenho: não deslocam a grade.

   Layout v5 (compacto, paisagem): faixa lateral com a numeração, bolinhas
   vazias alinhadas, A B C D no cabeçalho de cada coluna, linhas pontilhadas
   entre as questões e QR Code no rodapé.
   O cartão não exibe a marca SICEP+: só escola, aluno, turma, avaliação
   e o caderno. Os 4 quadrados pretos são obrigatórios.

   Modos de exportação (opções de montarCartaoSvg, a grade NUNCA muda):
   · modo 'completo'  → identificação (aluno, turma, data…) + grade + rodapé;
   · modo 'gabarito'  → só os 4 quadrados, o cabeçalho A B C D, a numeração e as
                        bolinhas (sem identificação nem instruções), para encaixar
                        numa prova que já tem o próprio cabeçalho;
   · qrModo 'junto'   → QR Code impresso no cartão (posição de geometria.js);
   · qrModo 'separado'→ o cartão sai SEM o QR e o canto inferior direito fica em
                        branco (sem quadriculado). O QR sai à parte (montarQrSvg)
                        para ser colado/impresso na prova.
   ============================================================ */

import { FOLHA, MARCADOR, QR, REGIAO, GEOMETRIA_VERSAO, layoutCartao } from './geometria.js';

const TINTA = '#101318';
const CINZA = '#5A6272';
const LINHA = '#8E96A4';
const TRACEJADO = '#8C8C8C';
const FAIXA_CINZA = '#D2D2D2';
const FONTE = "font-family=\"Arial, Helvetica, sans-serif\"";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Reduz o texto para caber na largura (mm), aproximando 0,58 × corpo por caractere. */
function caber(texto, larguraMm, corpo) {
  const max = Math.max(4, Math.floor(larguraMm / (corpo * 0.58)));
  const t = String(texto ?? '');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** QR como retângulos, preenchendo exatamente o quadrado QR da geometria. */
function qrModulos(qr) {
  const n = qr.getModuleCount();
  const m = QR.lado / n;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${(QR.x + c * m).toFixed(3)} ${(QR.y + r * m).toFixed(3)}h${(m + 0.01).toFixed(3)}v${(m + 0.01).toFixed(3)}h-${(m + 0.01).toFixed(3)}z`;
    }
  }
  return `<path d="${d}" fill="#000"/>`;
}

/**
 * QR Code avulso (para colar/imprimir na prova): QR + margem branca de 4 mm, sem texto.
 * @param {object} qr    objeto do qrcode-generator já montado (make())
 * @param {number} [lado] lado do QR em mm (22 = mesmo tamanho do QR do cartão)
 * @returns {{svg:string, larguraMm:number, alturaMm:number}}
 */
export function montarQrSvg(qr, lado = QR.lado) {
  const margem = 4;
  const T = lado + margem * 2;
  const n = qr.getModuleCount();
  const m = lado / n;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${(margem + c * m).toFixed(3)} ${(margem + r * m).toFixed(3)}h${(m + 0.01).toFixed(3)}v${(m + 0.01).toFixed(3)}h-${(m + 0.01).toFixed(3)}z`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${T} ${T}" width="${T}mm" height="${T}mm" preserveAspectRatio="xMidYMid meet" role="img" aria-label="QR Code do caderno">
  <rect width="${T}" height="${T}" fill="#fff"/>
  <path d="${d}" fill="#000"/>
</svg>`;
  return { svg, larguraMm: T, alturaMm: T };
}

/**
 * Campo de identificação: rótulo pequeno em cima, valor impresso (se houver) e
 * a linha de preenchimento embaixo. Tudo em mm.
 */
function campo(x, y, w, rotulo, valor, { linha = true, corpo = 3.2 } = {}) {
  const ax = x + Math.min(w * 0.5, 16);
  return `
    <text x="${x}" y="${y}" font-size="2.1" letter-spacing="0.15" fill="${CINZA}" ${FONTE}>${esc(rotulo)}</text>
    ${valor ? `<text x="${x}" y="${y + corpo + 0.6}" font-size="${corpo}" font-weight="700" fill="${TINTA}" ${FONTE}>${esc(caber(valor, w * 0.94, corpo))}</text>` : ''}
    ${linha ? `<line x1="${x}" y1="${y + 4.6}" x2="${x + w}" y2="${y + 4.6}" stroke="${LINHA}" stroke-width="0.25"/>` : ''}`;
}

/**
 * @param {object} d
 * @param {{numero:number, anulada?:boolean}[]} d.questoes
 * @param {string[]} d.letras
 * @param {string} d.escola @param {string} d.turma @param {string} d.disciplina
 * @param {string} d.avaliacao @param {string} d.data @param {string} d.caderno
 * @param {object|null} d.qr  objeto do qrcode-generator já montado (make())
 * @param {'completo'|'gabarito'} [d.modo]    padrão 'completo'
 * @param {'junto'|'separado'} [d.qrModo]     padrão 'junto'
 */
export function montarCartaoSvg(d) {
  const L = layoutCartao(d.questoes, d.letras.length, d.letras);
  const { largura: W, altura: H } = FOLHA;
  const { lado, recuo } = MARCADOR;
  const f = (v) => +v.toFixed(3);
  const completo = d.modo !== 'gabarito';
  const qrJunto = d.qrModo !== 'separado';

  const marcadores = [
    [recuo, recuo], [W - recuo - lado, recuo],
    [recuo, H - recuo - lado], [W - recuo - lado, H - recuo - lado],
  ].map(([x, y]) => `<rect x="${x}" y="${y}" width="${lado}" height="${lado}" fill="${TINTA}"/>`).join('');

  /* ---------- Identificação (não entra na grade: a grade vem de layoutCartao) ---------- */
  const X = 12, XF = W - 12, WCAB = XF - X;
  const cab = !completo ? '' : `
    ${campo(X, 16, 88, 'ALUNO(A)', '', { corpo: 3.4 })}
    ${campo(X + 92, 16, 32, 'TURMA', d.turma)}
    ${campo(X + 128, 16, WCAB - 128, 'DATA', d.data)}
    ${campo(X, 24.2, 58, 'AVALIAÇÃO', d.avaliacao)}
    ${campo(X + 62, 24.2, 40, 'DISCIPLINA', d.disciplina)}
    ${campo(X + 106, 24.2, WCAB - 106, 'ESCOLA', d.escola)}
    <line x1="${X}" y1="30.4" x2="${XF}" y2="30.4" stroke="${TINTA}" stroke-width="0.35"/>`;

  const qr = qrJunto ? (d.qr ? qrModulos(d.qr) : '') : '';

  /* ---------- Colunas: A B C D no topo, faixa de numeração, linhas pontilhadas ---------- */
  const yTopo = REGIAO.y0;
  const corpoLetraTopo = 3.1;
  const topoColuna = (faixa) => faixa.letras.map((l) => `
    <text x="${f(l.x)}" y="${f(yTopo - 1.7)}" font-size="${corpoLetraTopo}" font-weight="700" text-anchor="middle" fill="${CINZA}" ${FONTE}>${esc(l.alt)}</text>`).join('');

  const tracejado = `stroke="${TRACEJADO}" stroke-width="0.18" stroke-dasharray="0.9 0.8"`;
  const moldurasColuna = L.faixas.map((faixa) => {
    const yFim = yTopo + faixa.linhas * L.alturaLinha;
    const xFim = faixa.x + faixa.largura;
    let s = `<path d="M${f(faixa.x)} ${f(yTopo)}H${f(xFim)}V${f(yFim)}H${f(faixa.x)}" fill="none" ${tracejado}/>`;
    for (let i = 1; i < faixa.linhas; i++) {
      const y = yTopo + i * L.alturaLinha;
      s += `<line x1="${f(faixa.x)}" y1="${f(y)}" x2="${f(xFim)}" y2="${f(y)}" ${tracejado}/>`;
    }
    return s;
  }).join('');

  // Faixa lateral: número par em cinza, ímpar em branco (como no modelo de referência).
  const numeros = L.numeros.map((n) => {
    const cinza = n.numero % 2 === 0;
    return `
    <rect x="${f(n.x)}" y="${f(n.y - n.h / 2)}" width="${f(n.w)}" height="${f(n.h)}" fill="${cinza ? FAIXA_CINZA : '#fff'}" stroke="${LINHA}" stroke-width="0.2"/>
    <text x="${f(n.x + n.w / 2)}" y="${f(n.y + 1.05)}" font-size="3.1" font-weight="700" text-anchor="middle" fill="${n.anulada ? '#888' : '#3E4350'}" ${FONTE}>${String(n.numero).padStart(2, '0')}</text>`;
  }).join('');

  // Bolinhas VAZIAS (sem letra dentro): a letra fica só no cabeçalho da coluna.
  const bolhas = L.bolhas.map((b) => `
    <circle cx="${f(b.x)}" cy="${f(b.y)}" r="${f(b.d / 2)}" fill="none" stroke="${TINTA}" stroke-width="0.3"/>`).join('');

  const anuladas = L.numeros.filter((n) => n.anulada).map((n) => `
    <text x="${f(n.x + n.w + 3)}" y="${f(n.y + 0.8)}" font-size="2.2" fill="#8A9099" ${FONTE}>ANULADA</text>`).join('');

  /* ---------- Rodapé: instruções, caderno e QR Code ---------- */
  const yR = REGIAO.y1;
  const rodape = !completo ? '' : `
    <line x1="${X}" y1="${yR + 1.6}" x2="${XF}" y2="${yR + 1.6}" stroke="${LINHA}" stroke-width="0.25"/>
    <text x="${X}" y="${yR + 6.2}" font-size="2.2" fill="${CINZA}" ${FONTE}>Preencha UMA única alternativa por questão,</text>
    <text x="${X}" y="${yR + 9.6}" font-size="2.2" fill="${CINZA}" ${FONTE}>cobrindo toda a bolinha, com caneta preta ou azul.</text>
    <text x="${X}" y="${yR + 13}" font-size="2.2" fill="${CINZA}" ${FONTE}>Não rasure nem use corretivo. Em branco conta como erro.</text>
    <g>
      <rect x="112" y="${yR + 4}" width="26" height="11" rx="0.8" fill="none" stroke="${TINTA}" stroke-width="0.3"/>
      <text x="114" y="${yR + 6.9}" font-size="1.8" letter-spacing="0.12" fill="${CINZA}" ${FONTE}>CADERNO</text>
      <text x="125" y="${yR + 13.2}" font-size="5.2" font-weight="700" text-anchor="middle" fill="${TINTA}" ${FONTE}>${esc(String(d.caderno || 'A').slice(0, 2))}</text>
    </g>
    <text x="${X}" y="${yR + 20.2}" font-size="1.9" fill="#8A9099" ${FONTE}>${esc(codigoRotulo(d.codigo))}</text>
    <text x="${X}" y="${yR + 23.4}" font-size="1.9" fill="#8A9099" ${FONTE}>Layout v${GEOMETRIA_VERSAO} · ${L.numeros.length} questões · ${d.letras.length} alternativas</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Cartão de respostas">
  <rect width="${W}" height="${H}" fill="#fff"/>
  ${marcadores}${cab}${qr}
  ${L.faixas.map(topoColuna).join('')}
  ${moldurasColuna}${numeros}${bolhas}${anuladas}${rodape}
</svg>`;
}

/** Código do caderno no rodapé (sem virar marca). */
function codigoRotulo(codigo) {
  const c = String(codigo || '').trim();
  return c ? `Caderno de respostas · ${c}` : 'Caderno de respostas';
}

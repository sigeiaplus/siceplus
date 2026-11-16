/* ============================================================
   SICEP+ · Desenho do cartão de respostas (SVG em milímetros)
   ------------------------------------------------------------
   Módulo puro (sem DOM): recebe os dados e devolve o texto SVG.
   Todas as posições vêm de geometria.js — a MESMA fonte do leitor.
   O cartão não exibe o nome SICEP: só escola, aluno, turma e avaliação.
   ============================================================ */

import { FOLHA, MARCADOR, QR, REGIAO, layoutCartao } from './geometria.js';

const TINTA = '#101318';
const FONTE = "font-family=\"Arial, Helvetica, sans-serif\"";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Reduz o texto para caber na largura (mm), aproximando 0,5 × corpo por caractere. */
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

/** Campo com rótulo e linha de preenchimento (corpo em mm: rótulo 2,3 · valor 3,2). */
function campo(x, y, w, rotulo, valor) {
  const lw = rotulo.length * 1.65 + 1.8;
  const corpo = 3.2;
  return `
    <text x="${x}" y="${y}" font-size="2.3" fill="#444" ${FONTE}>${esc(rotulo)}</text>
    <line x1="${x + lw}" y1="${y + 0.7}" x2="${x + w}" y2="${y + 0.7}" stroke="${TINTA}" stroke-width="0.3"/>
    ${valor ? `<text x="${x + lw + 1}" y="${y - 0.2}" font-size="${corpo}" font-weight="700" fill="${TINTA}" ${FONTE}>${esc(caber(valor, w - lw - 1, corpo))}</text>` : ''}`;
}

/**
 * @param {object} d
 * @param {{numero:number, anulada?:boolean}[]} d.questoes
 * @param {string[]} d.letras
 * @param {string} d.escola @param {string} d.turma @param {string} d.disciplina
 * @param {string} d.avaliacao @param {string} d.data @param {string} d.caderno
 * @param {object|null} d.qr  objeto do qrcode-generator já montado (make())
 */
export function montarCartaoSvg(d) {
  const L = layoutCartao(d.questoes, d.letras.length, d.letras);
  const { largura: W, altura: H } = FOLHA;
  const { lado, recuo } = MARCADOR;
  const f = (v) => +v.toFixed(3);

  const marcadores = [
    [recuo, recuo], [W - recuo - lado, recuo],
    [recuo, H - recuo - lado], [W - recuo - lado, H - recuo - lado],
  ].map(([x, y]) => `<rect x="${x}" y="${y}" width="${lado}" height="${lado}" fill="${TINTA}"/>`).join('');

  // Cabeçalho: 5 linhas à esquerda do QR (x 14 → 138). A linha do ALUNO tem mais altura para a letra de mão.
  const X = 14, WCAB = 124;
  const cab = [
    campo(X, 19, WCAB, 'ESCOLA', d.escola),
    campo(X, 28.5, WCAB, 'ALUNO', ''),
    campo(X, 37, 74, 'TURMA', d.turma) + campo(X + 80, 37, 44, 'MATRÍCULA', ''),
    campo(X, 45, WCAB, 'AVALIAÇÃO', d.avaliacao),
    campo(X, 53, 66, 'DISCIPLINA', d.disciplina) + campo(X + 72, 53, 30, 'DATA', d.data) + campo(X + 108, 53, 16, 'CAD.', d.caderno),
    `<line x1="14" y1="57.5" x2="172" y2="57.5" stroke="#999" stroke-width="0.2"/>`,
  ].join('');

  const qr = d.qr ? qrModulos(d.qr) : '';

  const numeros = L.numeros.map((n) => `
    <text x="${f(n.x + n.w - 0.8)}" y="${f(n.y + 1)}" font-size="3" font-weight="700" text-anchor="end" fill="${n.anulada ? '#888' : TINTA}" ${FONTE}>${String(n.numero).padStart(2, '0')}</text>`).join('');

  const corpoLetra = Math.max(1.6, L.diametro * 0.42);
  const bolhas = L.bolhas.map((b) => `
    <circle cx="${f(b.x)}" cy="${f(b.y)}" r="${f(b.d / 2)}" fill="none" stroke="${TINTA}" stroke-width="0.25"/>
    <text x="${f(b.x)}" y="${f(b.y + corpoLetra * 0.35)}" font-size="${f(corpoLetra)}" text-anchor="middle" fill="#666" ${FONTE}>${esc(b.alt)}</text>`).join('');

  const anuladas = L.numeros.filter((n) => n.anulada).map((n) => `
    <text x="${f(n.x + n.w + 4)}" y="${f(n.y + 1)}" font-size="2.4" fill="#888" ${FONTE}>ANULADA</text>`).join('');

  const rodape = `
    <text x="${W / 2}" y="${REGIAO.y1 + 6}" font-size="2.2" fill="#444" text-anchor="middle" ${FONTE}>Preencha uma única alternativa por questão, cobrindo toda a bolinha, com caneta preta ou azul.</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Cartão de respostas">
  <rect width="${W}" height="${H}" fill="#fff"/>
  ${marcadores}${cab}${qr}${numeros}${bolhas}${anuladas}${rodape}
</svg>`;
}

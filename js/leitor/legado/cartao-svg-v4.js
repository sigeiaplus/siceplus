/* ============================================================
   SICEP+ · Desenho do cartão de respostas (SVG em milímetros)
   ------------------------------------------------------------
   Módulo puro (sem DOM): recebe os dados e devolve o texto SVG.
   Todas as posições de questões/bolinhas vêm de geometria.js — a MESMA
   fonte usada pelo leitor (leitor.js). O cabeçalho e o rodapé são apenas
   desenho: não deslocam a grade.

   O cartão não exibe a marca SICEP+: só escola, aluno, turma, avaliação
   e o caderno. Os 4 quadrados pretos e o QR Code são obrigatórios.
   ============================================================ */

import { FOLHA, MARCADOR, QR, REGIAO, GEOMETRIA_VERSAO, layoutCartao } from './geometria-v4.js';

const TINTA = '#101318';
const CINZA = '#5A6272';
const LINHA = '#8E96A4';
const TRACEJADO = '#D3D8E0';
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

  /* ---------- Cabeçalho (não entra na grade: a grade vem de layoutCartao) ---------- */
  const X = 12, WCAB = 124;
  const cab = `
    <line x1="${X}" y1="12.6" x2="${W - X}" y2="12.6" stroke="${TINTA}" stroke-width="0.45"/>
    ${campo(X, 17.4, WCAB, 'ESCOLA', d.escola)}
    ${campo(X, 25.4, WCAB, 'ALUNO(A)', '', { corpo: 3.6 })}
    ${campo(X, 33.4, 36, 'TURMA', d.turma)}
    ${campo(X + 42, 33.4, 38, 'MATRÍCULA', '')}
    ${campo(X + 86, 33.4, 38, 'DATA', d.data)}
    ${campo(X, 41.4, WCAB, 'AVALIAÇÃO', d.avaliacao)}
    ${campo(X, 49.4, 62, 'DISCIPLINA', d.disciplina)}
    ${campo(X + 70, 49.4, 50, 'PROFESSOR(A)', d.professor || '')}
    <line x1="${X}" y1="57.6" x2="${W - X}" y2="57.6" stroke="${LINHA}" stroke-width="0.25"/>
    <g>
      <rect x="140" y="47.8" width="32" height="9.2" rx="0.8" fill="none" stroke="${TINTA}" stroke-width="0.3"/>
      <text x="142" y="50.6" font-size="1.8" letter-spacing="0.12" fill="${CINZA}" ${FONTE}>CADERNO</text>
      <text x="156" y="55.6" font-size="5" font-weight="700" text-anchor="middle" fill="${TINTA}" ${FONTE}>${esc(String(d.caderno || 'A').slice(0, 2))}</text>
    </g>`;

  const qr = d.qr ? qrModulos(d.qr) : '';

  /* ---------- Cabeçalho de cada coluna + separadores ---------- */
  const rotuloColuna = (faixa) => {
    if (faixa.primeira == null) return '';
    const ini = String(faixa.primeira).padStart(2, '0');
    const fim = String(faixa.ultima).padStart(2, '0');
    const cx = faixa.x + (faixa.largura - 2.5) / 2;
    return `<text x="${f(cx)}" y="${REGIAO.y0 - 1.8}" font-size="1.9" letter-spacing="0.12" text-anchor="middle" fill="${CINZA}" ${FONTE}>${ini}–${fim}</text>`;
  };

  const separadores = L.faixas.slice(1).map((faixa) => {
    const x = faixa.x - 1.25;
    return `<line x1="${f(x)}" y1="${REGIAO.y0 - 0.5}" x2="${f(x)}" y2="${REGIAO.y1 - 2}" stroke="${TRACEJADO}" stroke-width="0.2" stroke-dasharray="1.6 1.6"/>`;
  }).join('');

  const numeros = L.numeros.map((n) => `
    <text x="${f(n.x + n.w - 0.8)}" y="${f(n.y + 1)}" font-size="3" font-weight="700" text-anchor="end" fill="${n.anulada ? '#888' : TINTA}" ${FONTE}>${String(n.numero).padStart(2, '0')}</text>`).join('');

  const corpoLetra = Math.max(1.6, L.diametro * 0.42);
  const bolhas = L.bolhas.map((b) => `
    <circle cx="${f(b.x)}" cy="${f(b.y)}" r="${f(b.d / 2)}" fill="none" stroke="${TINTA}" stroke-width="0.26"/>
    <text x="${f(b.x)}" y="${f(b.y + corpoLetra * 0.35)}" font-size="${f(corpoLetra)}" text-anchor="middle" fill="#6A7280" ${FONTE}>${esc(b.alt)}</text>`).join('');

  const anuladas = L.numeros.filter((n) => n.anulada).map((n) => `
    <text x="${f(n.x + n.w + 3.4)}" y="${f(n.y + 1)}" font-size="2.2" fill="#8A9099" ${FONTE}>ANULADA</text>`).join('');

  /* ---------- Rodapé ---------- */
  const rodape = `
    <line x1="${X}" y1="${REGIAO.y1 + 1.5}" x2="${W - X}" y2="${REGIAO.y1 + 1.5}" stroke="${LINHA}" stroke-width="0.25"/>
    <text x="${W / 2}" y="${REGIAO.y1 + 6}" font-size="2.3" text-anchor="middle" fill="${CINZA}" ${FONTE}>Preencha UMA única alternativa por questão, cobrindo toda a bolinha, com caneta preta ou azul.</text>
    <text x="${W / 2}" y="${REGIAO.y1 + 9.6}" font-size="2.1" text-anchor="middle" fill="${CINZA}" ${FONTE}>Não rasure nem use corretivo. Questões em branco contam como erro.</text>
    <text x="${X}" y="${REGIAO.y1 + 14}" font-size="1.9" fill="#8A9099" ${FONTE}>Layout v${GEOMETRIA_VERSAO} · ${L.numeros.length} questões · ${d.letras.length} alternativas</text>
    <text x="${W - X}" y="${REGIAO.y1 + 14}" font-size="1.9" text-anchor="end" fill="#8A9099" ${FONTE}>${esc(codigoRotulo(d.codigo))}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Cartão de respostas">
  <rect width="${W}" height="${H}" fill="#fff"/>
  ${marcadores}${cab}${qr}
  ${L.faixas.map(rotuloColuna).join('')}
  ${separadores}${numeros}${bolhas}${anuladas}${rodape}
</svg>`;
}

/** Código do caderno no rodapé (sem virar marca). */
function codigoRotulo(codigo) {
  const c = String(codigo || '').trim();
  return c ? `Caderno de respostas · ${c}` : 'Caderno de respostas';
}

/* ============================================================
   SICEP+ · Geometria v3 do cartão de respostas (leitura de cartões antigos)
   ------------------------------------------------------------
   Cópia fiel do layout v3, que era o usado na impressão antes da v4.
   A leitura usa ESTA geometria só quando a folha impressa é comprovadamente
   v3 (grade antiga conferida) — cartões v4 continuam sendo lidos pela v4.

   v3: questões numeradas na vertical (01 02 / 03 04 / 05 06 ...),
       no mínimo 3 colunas, até 10 por coluna e 5 colunas (50 questões).
   ============================================================ */

import { FOLHA, MARCADOR, QR, REGIAO, MAX_POR_COLUNA, MAX_COLUNAS, MAX_QUESTOES, centrosMarcadores } from './geometria-v4.js';

export const VERSAO_V3 = 3;

/** Mínimo de colunas usadas (6 questões → 3 colunas × 2 linhas). */
export const COLUNAS_MIN_V3 = 3;

/** Quantas colunas e linhas uma avaliação de n questões usava na v3. */
export function gradeParaV3(n) {
  if (n < 1) return { cols: 1, rows: 1 };
  const cols = Math.min(MAX_COLUNAS, Math.max(Math.ceil(n / MAX_POR_COLUNA), Math.min(COLUNAS_MIN_V3, n)));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

/**
 * Posições (mm) da grade v3 impressa.
 * @param {{numero:number, anulada?:boolean}[]} questoes
 * @param {number} numAlternativas
 * @param {string[]} letras
 */
export function layoutCartaoV3(questoes, numAlternativas, letras) {
  const n = questoes.length;
  if (n > MAX_QUESTOES) {
    throw new Error(`O cartão comporta no máximo ${MAX_QUESTOES} questões (recebeu ${n}).`);
  }
  const { cols, rows } = gradeParaV3(n);
  const largReg = REGIAO.x1 - REGIAO.x0;
  const altReg = REGIAO.y1 - REGIAO.y0;

  const alturaLinha = Math.min(14, altReg / rows);
  const larguraCol = largReg / cols;
  const folga = 2.5;                                  // espaço entre colunas
  const larguraNumero = cols >= 4 ? 5.5 : 7;
  const passo = (larguraCol - folga - larguraNumero - 0.8) / numAlternativas;
  const diametro = Math.min(6, passo * 0.82, alturaLinha * 0.7);

  const numeros = [];
  const bolhas = [];

  questoes.forEach((q, i) => {
    const col = Math.floor(i / rows);
    const lin = i % rows;
    const yc = REGIAO.y0 + alturaLinha * (lin + 0.5);
    const xCol = REGIAO.x0 + col * larguraCol;

    numeros.push({
      numero: q.numero,
      anulada: !!q.anulada,
      col,
      x: xCol, y: yc, w: larguraNumero, h: alturaLinha,
    });

    if (q.anulada) return;
    for (let a = 0; a < numAlternativas; a++) {
      bolhas.push({
        numero: q.numero,
        alt: letras[a],
        col,
        x: xCol + larguraNumero + 0.8 + passo * (a + 0.5),
        y: yc,
        d: diametro,
      });
    }
  });

  return {
    versao: VERSAO_V3,
    folha: FOLHA,
    marcador: MARCADOR,
    marcadores: centrosMarcadores(),
    regiao: REGIAO,
    qr: QR,
    colunas: cols,
    linhas: rows,
    alturaLinha,
    larguraColuna: larguraCol,
    diametro,
    numeros,
    bolhas,
  };
}

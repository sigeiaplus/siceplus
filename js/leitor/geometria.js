/* ============================================================
   SICEP+ · Geometria do cartão de respostas
   ------------------------------------------------------------
   Fonte única de verdade para IMPRESSÃO (cartoes.js) e LEITURA
   (leitor.js). Tudo em milímetros, na folha de 186 × 273 mm.

   Se mudar algo aqui, os cartões já impressos deixam de bater
   com a leitura: por isso o layout é versionado (GEOMETRIA_VERSAO).
   ============================================================ */

export const GEOMETRIA_VERSAO = 2;

export const FOLHA = { largura: 186, altura: 273 };

/** Quadrados pretos de referência (um em cada canto). */
export const MARCADOR = { lado: 7, recuo: 4 };

/** Região onde ficam as questões. */
export const REGIAO = { x0: 14, y0: 112, x1: 172, y1: 250 };

/** Centro de cada marcador, na ordem: superior-esq., superior-dir., inferior-dir., inferior-esq. */
export function centrosMarcadores() {
  const c = MARCADOR.recuo + MARCADOR.lado / 2;
  const { largura: W, altura: H } = FOLHA;
  return [
    { x: c, y: c },
    { x: W - c, y: c },
    { x: W - c, y: H - c },
    { x: c, y: H - c },
  ];
}

function colunasPara(n) {
  if (n <= 25) return 2;
  if (n <= 40) return 3;
  return 4;
}

/**
 * Calcula a posição (mm) de cada número e de cada bolinha.
 * @param {{numero:number, anulada?:boolean}[]} questoes
 * @param {number} numAlternativas  4 ou 5
 * @param {string[]} letras         ['A','B',...]
 */
export function layoutCartao(questoes, numAlternativas, letras) {
  const n = questoes.length;
  const cols = colunasPara(n);
  const rows = Math.max(1, Math.ceil(n / cols));
  const largReg = REGIAO.x1 - REGIAO.x0;
  const altReg = REGIAO.y1 - REGIAO.y0;

  const alturaLinha = Math.min(11, altReg / rows);
  const larguraCol = largReg / cols;
  const folga = cols === 2 ? 6 : cols === 3 ? 5 : 4;
  const larguraNumero = cols === 2 ? 8 : cols === 3 ? 7 : 6;
  const passo = (larguraCol - folga - larguraNumero - 1) / numAlternativas;
  const diametro = Math.min(7.5, passo * 0.8, alturaLinha * 0.75);

  const numeros = [];
  const bolhas = [];

  questoes.forEach((q, i) => {
    // preenchimento por coluna: 1..rows na 1ª coluna, e assim por diante
    const col = Math.floor(i / rows);
    const lin = i % rows;
    const yc = REGIAO.y0 + alturaLinha * (lin + 0.5);
    const xCol = REGIAO.x0 + col * larguraCol;

    numeros.push({
      numero: q.numero,
      anulada: !!q.anulada,
      x: xCol, y: yc, w: larguraNumero, h: alturaLinha,
    });

    if (q.anulada) return;
    for (let a = 0; a < numAlternativas; a++) {
      bolhas.push({
        numero: q.numero,
        alt: letras[a],
        x: xCol + larguraNumero + 1 + passo * (a + 0.5),
        y: yc,
        d: diametro,
      });
    }
  });

  return {
    versao: GEOMETRIA_VERSAO,
    folha: FOLHA,
    marcador: MARCADOR,
    marcadores: centrosMarcadores(),
    regiao: REGIAO,
    colunas: cols,
    alturaLinha,
    diametro,
    numeros,
    bolhas,
  };
}

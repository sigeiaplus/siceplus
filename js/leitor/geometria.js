/* ============================================================
   SICEP+ · Geometria do cartão de respostas
   ------------------------------------------------------------
   Fonte única de verdade para IMPRESSÃO (cartao-svg.js) e LEITURA
   (leitor.js). Tudo em milímetros, na folha de 186 × 273 mm.

   Se mudar algo aqui, os cartões já impressos deixam de bater
   com a leitura: por isso o layout é versionado (GEOMETRIA_VERSAO).

   v3: questões numeradas na vertical (01 02 / 03 04 / 05 06 ...),
       até 10 por coluna e 5 colunas (50 questões), cabeçalho no alto.
   ============================================================ */

export const GEOMETRIA_VERSAO = 3;

export const FOLHA = { largura: 186, altura: 273 };

/** Quadrados pretos de referência (um em cada canto). */
export const MARCADOR = { lado: 7, recuo: 4 };

/** Capacidade: o QR Code NÃO entra nessa conta. */
export const MAX_POR_COLUNA = 10;
export const MAX_COLUNAS = 5;
export const MAX_QUESTOES = MAX_POR_COLUNA * MAX_COLUNAS;
/** Mínimo de colunas usadas (6 questões → 3 colunas × 2 linhas). */
export const COLUNAS_MIN = 3;

/** Região onde ficam as questões (abaixo do cabeçalho, acima do rodapé). */
export const REGIAO = { x0: 12, y0: 62, x1: 174, y1: 252 };

/** QR Code, canto superior direito (o leitor usa esta área para achar a rotação). */
export const QR = { x: 142, y: 14, lado: 30 };

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

/** Quantas colunas e linhas uma avaliação de n questões usa. */
export function gradePara(n) {
  if (n < 1) return { cols: 1, rows: 1 };
  const cols = Math.min(MAX_COLUNAS, Math.max(Math.ceil(n / MAX_POR_COLUNA), Math.min(COLUNAS_MIN, n)));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

/**
 * Calcula a posição (mm) de cada número e de cada bolinha.
 * Numeração vertical: a coluna 1 recebe 01, 02, 03…, depois a coluna 2, etc.
 * @param {{numero:number, anulada?:boolean}[]} questoes
 * @param {number} numAlternativas  4 ou 5
 * @param {string[]} letras         ['A','B',...]
 */
export function layoutCartao(questoes, numAlternativas, letras) {
  const n = questoes.length;
  if (n > MAX_QUESTOES) {
    throw new Error(`O cartão comporta no máximo ${MAX_QUESTOES} questões (recebeu ${n}).`);
  }
  const { cols, rows } = gradePara(n);
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
      x: xCol, y: yc, w: larguraNumero, h: alturaLinha,
    });

    if (q.anulada) return;
    for (let a = 0; a < numAlternativas; a++) {
      bolhas.push({
        numero: q.numero,
        alt: letras[a],
        x: xCol + larguraNumero + 0.8 + passo * (a + 0.5),
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
    qr: QR,
    colunas: cols,
    linhas: rows,
    alturaLinha,
    diametro,
    numeros,
    bolhas,
  };
}

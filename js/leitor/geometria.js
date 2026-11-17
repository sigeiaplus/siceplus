/* ============================================================
   SICEP+ · Geometria do cartão de respostas
   ------------------------------------------------------------
   Fonte única de verdade para IMPRESSÃO (cartao-svg.js) e LEITURA
   (leitor.js). Tudo em milímetros, na folha de 186 × 273 mm.

   Se mudar algo aqui os cartões já impressos deixam de bater com a
   leitura — por isso o layout é versionado (GEOMETRIA_VERSAO) e essa
   versão vai escrita no cartão e no QR Code (qr-caderno.js).

   v4: preenchimento vertical em colunas de 10 (01–10, 11–20, … 41–50),
       até 5 colunas = 50 questões; linhas mais altas e bolinhas maiores.
   v3: questões em 3 colunas mesmo com poucas questões (layout antigo).
   ============================================================ */

export const GEOMETRIA_VERSAO = 4;

export const FOLHA = { largura: 186, altura: 273 };

/** Quadrados pretos de referência (um em cada canto). */
export const MARCADOR = { lado: 7, recuo: 4 };

/** Capacidade: o QR Code NÃO entra nessa conta. */
export const MAX_POR_COLUNA = 10;
export const MAX_COLUNAS = 5;
export const MAX_QUESTOES = MAX_POR_COLUNA * MAX_COLUNAS;

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

/**
 * Quantas colunas e linhas uma avaliação de n questões usa.
 * A coluna 1 fica com 01–10, a 2 com 11–20 e assim por diante (as últimas
 * colunas podem ficar incompletas), como manda a especificação do cartão.
 */
export function gradePara(n) {
  if (n < 1) return { cols: 1, rows: 1 };
  const cols = Math.min(MAX_COLUNAS, Math.max(1, Math.ceil(n / MAX_POR_COLUNA)));
  const rows = Math.min(MAX_POR_COLUNA, n);
  return { cols, rows };
}

/**
 * Calcula a posição (mm) de cada número e de cada bolinha.
 * Numeração vertical: a coluna 1 recebe 01, 02, 03…, depois a coluna 2, etc.
 * `grade` força outro número de colunas/linhas (usado só no diagnóstico do
 * leitor, para descobrir com que grade um cartão antigo foi impresso).
 * @param {{numero:number, anulada?:boolean}[]} questoes
 * @param {number} numAlternativas  4 ou 5
 * @param {string[]} letras         ['A','B',...]
 * @param {{cols:number, rows:number}} [grade]
 */
export function layoutCartao(questoes, numAlternativas, letras, grade = null) {
  const n = questoes.length;
  if (n > MAX_QUESTOES) {
    throw new Error(`O cartão comporta no máximo ${MAX_QUESTOES} questões (recebeu ${n}).`);
  }
  const base = gradePara(n);
  const cols = grade ? Math.min(MAX_COLUNAS, Math.max(1, grade.cols | 0)) : base.cols;
  const rows = grade ? Math.min(MAX_POR_COLUNA, Math.max(1, grade.rows | 0)) : base.rows;
  if (cols * rows < n) {
    throw new Error(`Grade ${cols}×${rows} não comporta ${n} questões.`);
  }
  const largReg = REGIAO.x1 - REGIAO.x0;
  const altReg = REGIAO.y1 - REGIAO.y0;

  // Linhas altas o suficiente para preencher a folha sem apertar; a grade é
  // centralizada na região quando sobram milímetros.
  const alturaLinha = Math.min(19, Math.max(9, altReg / rows));
  const yTopo = REGIAO.y0 + Math.max(0, (altReg - alturaLinha * rows) / 2);
  const larguraCol = largReg / cols;
  const folga = 2.5;                                  // espaço entre colunas
  const larguraNumero = cols >= 4 ? 5.5 : 7;
  const passo = (larguraCol - folga - larguraNumero - 0.8) / numAlternativas;
  const diametro = Math.min(6.4, passo * 0.84, alturaLinha * 0.55);

  const numeros = [];
  const bolhas = [];

  questoes.forEach((q, i) => {
    const col = Math.floor(i / rows);
    const lin = i % rows;
    const yc = yTopo + alturaLinha * (lin + 0.5);
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

  // Faixa de cada coluna (para o cabeçalho impresso e para mensagens de erro).
  const faixas = Array.from({ length: cols }, (_, c) => {
    const daColuna = numeros.filter((q) => q.col === c);
    return {
      col: c,
      x: REGIAO.x0 + c * larguraCol,
      largura: larguraCol,
      primeira: daColuna.length ? daColuna[0].numero : null,
      ultima: daColuna.length ? daColuna[daColuna.length - 1].numero : null,
    };
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
    larguraColuna: larguraCol,
    diametro,
    faixas,
    numeros,
    bolhas,
  };
}

/** Quantas questões cabem numa grade (para validar o diagnóstico do leitor). */
export function gradeComporta(grade, n) {
  return grade.cols * grade.rows >= n;
}

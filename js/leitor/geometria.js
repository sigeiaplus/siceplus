/* ============================================================
   SICEP+ · Geometria do cartão de respostas (v5 · compacto)
   ------------------------------------------------------------
   Fonte única de verdade para IMPRESSÃO (cartao-svg.js) e LEITURA
   (leitor.js). Tudo em milímetros, na folha de 186 × 135 mm (paisagem).

   Se mudar algo aqui os cartões já impressos deixam de bater com a
   leitura — por isso o layout é versionado (GEOMETRIA_VERSAO) e essa
   versão vai escrita no cartão e no QR Code (qr-caderno.js).

   v5: cartão compacto (paisagem, 186 × 135 mm). 5 colunas verticais de
       10 questões (01–10, 11–20, … 41–50), faixa lateral de numeração,
       bolinhas de 4,6 mm sem letra dentro (A B C D ficam no cabeçalho),
       linhas de 7 mm, QR Code no rodapé.
       A largura e a altura da coluna não dependem do nº de questões:
       cada coluna é sempre igual; só o número de colunas usadas muda.
   v4 e v3: ver legado/ (só para comparação e testes, não são mais lidos).
   ============================================================ */

export const GEOMETRIA_VERSAO = 5;

export const FOLHA = { largura: 186, altura: 135 };

/** Quadrados pretos de referência (um em cada canto). */
export const MARCADOR = { lado: 7, recuo: 4 };

/** Capacidade: o QR Code NÃO entra nessa conta. */
export const MAX_POR_COLUNA = 10;
export const MAX_COLUNAS = 5;
export const MAX_QUESTOES = MAX_POR_COLUNA * MAX_COLUNAS;

/** Região das questões: x0..x1 = 5 colunas; y0..y1 = 10 linhas de ALTURA_LINHA. */
export const ALTURA_LINHA = 7;
export const REGIAO = { x0: 11, y0: 36, x1: 175, y1: 36 + ALTURA_LINHA * MAX_POR_COLUNA };

/** Medidas da coluna (mm). */
export const FOLGA_COLUNAS = 2;       // espaço entre colunas
export const LARGURA_NUMERO = 5.5;    // faixa lateral com o número da questão
export const RECUO_BOLHAS = 1.2;      // respiro entre a faixa e a 1ª bolinha, e após a última
export const LARGURA_COLUNA = (REGIAO.x1 - REGIAO.x0 - FOLGA_COLUNAS * (MAX_COLUNAS - 1)) / MAX_COLUNAS;
export const DIAMETRO_MAX = 4.6;

/** QR Code, rodapé à direita (o leitor usa esta área para achar a rotação). */
export const QR = { x: 146, y: 108.5, lado: 22 };

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
 * colunas podem ficar incompletas).
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
 * leitor, para descobrir com que grade um cartão foi impresso).
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

  const alturaLinha = ALTURA_LINHA;
  const yTopo = REGIAO.y0;
  const larguraCol = LARGURA_COLUNA;
  const passoColuna = larguraCol + FOLGA_COLUNAS;
  // Centraliza o bloco de colunas na folha quando há menos de 5 (a mesma conta vale para
  // o desenho e para o leitor). Com 5 colunas o deslocamento é zero.
  const deslocX = ((MAX_COLUNAS - cols) * passoColuna) / 2;
  const passo = (larguraCol - LARGURA_NUMERO - RECUO_BOLHAS * 2) / numAlternativas;
  const diametro = Math.min(DIAMETRO_MAX, passo * 0.8, alturaLinha * 0.66);

  const numeros = [];
  const bolhas = [];

  questoes.forEach((q, i) => {
    const col = Math.floor(i / rows);
    const lin = i % rows;
    const yc = yTopo + alturaLinha * (lin + 0.5);
    const xCol = REGIAO.x0 + deslocX + col * passoColuna;

    numeros.push({
      numero: q.numero,
      anulada: !!q.anulada,
      col, lin,
      x: xCol, y: yc, w: LARGURA_NUMERO, h: alturaLinha,
    });

    if (q.anulada) return;
    for (let a = 0; a < numAlternativas; a++) {
      bolhas.push({
        numero: q.numero,
        alt: letras[a],
        col,
        x: xCol + LARGURA_NUMERO + RECUO_BOLHAS + passo * (a + 0.5),
        y: yc,
        d: diametro,
      });
    }
  });

  // Faixa de cada coluna: cabeçalho impresso (A B C D) e mensagens de erro.
  const faixas = Array.from({ length: cols }, (_, c) => {
    const daColuna = numeros.filter((q) => q.col === c);
    const x = REGIAO.x0 + deslocX + c * passoColuna;
    return {
      col: c,
      x,
      largura: larguraCol,
      linhas: daColuna.length,
      primeira: daColuna.length ? daColuna[0].numero : null,
      ultima: daColuna.length ? daColuna[daColuna.length - 1].numero : null,
      letras: Array.from({ length: numAlternativas }, (_, a) => ({
        alt: letras[a],
        x: x + LARGURA_NUMERO + RECUO_BOLHAS + passo * (a + 0.5),
      })),
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
    passoColuna,
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

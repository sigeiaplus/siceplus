/* ============================================================
   SICEP+ · OMR — pipeline completo de leitura do cartão
   ------------------------------------------------------------
   Une as etapas do leitor.js (OpenCV) em uma chamada só:
     foto → 4 marcadores → perspectiva → conferência da grade
          → QR (na folha endireitada) → bolinhas → estados

   REGRA DE SEGURANÇA: o que for duvidoso (marca fraca, marcação dupla,
   leitura incerta, grade que não confere, cartão de outra avaliação)
   NÃO vira resposta. Fica com `detectada = null` e `confere = true`.
   Use respostasConfirmadas() para saber o que pode seguir sem conferência.
   ============================================================ */

import {
  PARAMS_PADRAO, mesclarParams, layoutDeAvaliacao,
  detectarMarcadores, alinharCartao, verificarGrade, lerBolhas, lerQRNaFolha, lerQR,
} from './leitor.js';

const CHAVE_PARAMS = 'sicep.omr.params';

/* ---------------- Plano B: parâmetros ajustáveis e guardados ---------------- */

/** Parâmetros efetivos: padrões + o que foi salvo neste aparelho. */
export function carregarParametros() {
  try {
    const salvo = JSON.parse(globalThis.localStorage?.getItem(CHAVE_PARAMS) || 'null');
    return mesclarParams(salvo || {});
  } catch (_) {
    return mesclarParams({});
  }
}

/** Guarda só o que difere do padrão. Devolve os parâmetros efetivos. */
export function salvarParametros(parcial) {
  const efetivos = mesclarParams({ ...carregarParametros(), ...parcial });
  const diferente = Object.fromEntries(Object.entries(efetivos).filter(([k, v]) => v !== PARAMS_PADRAO[k]));
  try { globalThis.localStorage?.setItem(CHAVE_PARAMS, JSON.stringify(diferente)); } catch (_) { /* sem armazenamento */ }
  return efetivos;
}

export function restaurarParametros() {
  try { globalThis.localStorage?.removeItem(CHAVE_PARAMS); } catch (_) { /* ok */ }
  return mesclarParams({});
}

/* ---------------- Pipeline ---------------- */

const MOTIVOS = {
  mais_de_50: 'O cartão comporta no máximo 50 questões.',
  marcadores: 'Não achei os 4 quadrados pretos dos cantos. Mostre o cartão inteiro, com boa luz.',
  alinhamento: 'Os quadrados dos cantos não bateram com o cartão. Fotografe de frente, sem dobras.',
  qr_diferente: 'Este cartão é de outra avaliação (o QR não confere).',
};

/**
 * @param {object} cv        OpenCV carregado (carregarOpenCV().cv)
 * @param {{data:Uint8ClampedArray,width:number,height:number}} imagem  RGBA (ImageData)
 * @param {object} o
 * @param {{numero:number, anulada?:boolean}[]} o.questoes
 * @param {number} [o.numAlternativas=5]
 * @param {string} [o.codigoEsperado]   código do caderno da avaliação escolhida (compara com o QR)
 * @param {object} [o.params]           ajustes de leitura (ver PARAMS_PADRAO); padrão = salvos no aparelho
 * @param {HTMLCanvasElement} [o.canvasQR] ajuda o BarcodeDetector nativo, se existir
 * @returns {Promise<object>} { ok, bloqueado, motivo, aviso[], etapas, leituras, resumo, alinhada, params, ms }
 */
export async function processarCartao(cv, imagem, o = {}) {
  const t0 = Date.now();
  const P = mesclarParams(o.params || carregarParametros());
  const etapas = {
    marcadores: { ok: false }, perspectiva: { ok: false }, grade: { ok: false }, qr: { ok: false, texto: null, origem: null },
  };
  const aviso = [];
  const falha = (chave) => ({
    ok: false, bloqueado: true, motivo: chave, mensagem: MOTIVOS[chave], aviso, etapas,
    leituras: [], resumo: resumir([], true), alinhada: null, params: P, ms: Date.now() - t0,
  });

  let layout;
  try {
    layout = layoutDeAvaliacao(o.questoes || [], o.numAlternativas || 5);
  } catch (e) {
    return falha('mais_de_50');
  }

  const m = detectarMarcadores(cv, imagem, { maxLado: P.maxLado });
  etapas.marcadores = { ok: m.ok, achados: m.achados ?? 0, ocupacao: m.ocupacao ?? null };
  if (!m.ok) return falha('marcadores');

  const al = alinharCartao(cv, imagem, m.cantos);
  etapas.perspectiva = { ok: !!al.ok };
  if (!al.ok) return falha('alinhamento');

  try {
    // 1) a grade do cartão bate com o layout esperado?
    const g = verificarGrade(cv, al.cinza, layout, P.minGrade);
    etapas.grade = g;

    // 2) QR: primeiro na folha endireitada; só depois na foto inteira.
    let texto = lerQRNaFolha(cv, al.rgba);
    let origem = texto ? 'folha' : null;
    if (!texto) {
      texto = await lerQR(cv, imagem, o.canvasQR || null);
      origem = texto ? 'foto' : null;
    }
    etapas.qr = { ok: !!texto, texto, origem };

    // 3) bolinhas
    let leituras = lerBolhas(cv, al.cinza, layout, P).leituras;

    // 4) motivos para NÃO confiar em nada automaticamente
    let bloqueado = false, motivo = null;
    const esperado = String(o.codigoEsperado || '').trim().toLowerCase();
    if (esperado && texto && String(texto).trim().toLowerCase() !== esperado) {
      bloqueado = true; motivo = 'qr_diferente';
    } else if (!g.ok) {
      bloqueado = true; motivo = 'grade';
    }
    if (!texto) aviso.push('qr_nao_lido');
    if (!g.ok) aviso.push('grade_nao_confere');

    if (bloqueado) {
      // Nada vira resposta: a leitura vira só sugestão para quem conferir.
      leituras = leituras.map((l) => (l.estado === 'anulada' ? l : {
        ...l, sugestao: l.sugestao || l.detectada, detectada: null, confere: true, bloqueada: true,
      }));
    }

    // cópia simples da folha endireitada (para desenharRevisao) — os Mats são liberados abaixo
    const alinhada = { cols: al.rgba.cols, rows: al.rgba.rows, data: new Uint8ClampedArray(al.rgba.data) };

    return {
      ok: !bloqueado,
      bloqueado,
      motivo,
      mensagem: motivo ? (MOTIVOS[motivo] || 'A leitura não confere com o cartão esperado. Confira tudo manualmente.') : null,
      aviso,
      etapas,
      layout,
      leituras,
      resumo: resumir(leituras, bloqueado),
      alinhada,
      params: P,
      ms: Date.now() - t0,
    };
  } finally {
    al.cinza.delete();
    al.rgba.delete();
  }
}

/* ---------------- Uso do resultado ---------------- */

/** Só as respostas que podem seguir direto: estado 'ok' e leitura não bloqueada. */
export function respostasConfirmadas(resultado) {
  const r = {};
  if (!resultado || resultado.bloqueado) return r;
  for (const l of resultado.leituras) {
    if (l.estado === 'ok' && l.detectada && !l.confere) r[l.numero] = l.detectada;
  }
  return r;
}

/** Números das questões que precisam de conferência manual. */
export function questoesParaConferir(resultado) {
  return (resultado?.leituras || []).filter((l) => l.confere).map((l) => l.numero);
}

function resumir(leituras, bloqueado) {
  const por = { ok: 0, branco: 0, fraca: 0, multipla: 0, incerta: 0, anulada: 0 };
  leituras.forEach((l) => { por[l.estado] = (por[l.estado] || 0) + 1; });
  const conferir = leituras.filter((l) => l.confere).map((l) => l.numero);
  return {
    total: leituras.length,
    ...por,
    conferir,
    podeSalvarDireto: !bloqueado && leituras.length > 0 && conferir.length === 0,
  };
}

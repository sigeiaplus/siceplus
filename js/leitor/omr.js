/* ============================================================
   SIGEIA AVALIAÇÕES · OMR — pipeline completo de leitura do cartão
   ------------------------------------------------------------
   Une as etapas do leitor.js (OpenCV) em uma chamada só:
     foto → 4 marcadores → perspectiva → QR → conferência da grade
          → bolinhas → estados

   REGRA DE SEGURANÇA: o que for duvidoso (marca fraca, marcação dupla,
   leitura incerta, grade que não confere, cartão de outra versão ou de
   outra avaliação) NÃO vira resposta. Fica com `detectada = null` e
   `confere = true`. Use respostasConfirmadas() para saber o que pode
   seguir sem conferência.

   O bloqueio é sempre explicado: cada motivo tem uma mensagem própria
   (cartão cortado, outra versão, outra avaliação, grade não confere…),
   para o professor saber o que refazer.
   ============================================================ */

import {
  PARAMS_PADRAO, mesclarParams, layoutDeAvaliacao, LETRAS_CARTAO,
  detectarMarcadores, alinharCartao, verificarGrade, diagnosticarGrade,
  lerBolhas, lerQRNaFolha, lerQR,
} from './leitor.js';
import { interpretarPayload, resumoQR } from './qr-caderno.js';
import { GEOMETRIA_VERSAO, layoutCartao } from './geometria.js';

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

/* ---------------- Mensagens de bloqueio ---------------- */

/**
 * Cada motivo tem texto próprio: o professor precisa saber se o problema é
 * o cartão (versão/avaliação), a foto (corte/tremida) ou o preenchimento.
 */
const MOTIVOS = {
  mais_de_50: () => 'O cartão comporta no máximo 50 questões.',
  // `achados` conta formas escuras candidatas (não só marcadores). Com 4 ou mais, o problema não é
  // "faltam quadrados": eles existem, mas não formam o retângulo do cartão (foto muito inclinada,
  // cartão dobrado, ângulo extremo). Só a mensagem muda; os critérios de detecção são os mesmos.
  marcadores: (c) => (c.achados >= 4
    ? 'Não foi possível identificar a geometria do cartão: achei formas escuras na foto, mas elas não formam os 4 cantos da folha. Isso acontece com a foto muito inclinada, o cartão dobrado, sombra forte ou parte da folha fora da imagem. Fotografe de frente, com a folha inteira, reta e bem iluminada.'
    : c.achados >= 2
      ? `Encontrei apenas ${c.achados} dos 4 quadrados pretos dos cantos. O cartão pode estar cortado na foto — afaste um pouco a câmera e enquadre a folha inteira.`
      : 'Não achei os 4 quadrados pretos dos cantos. Mostre o cartão inteiro, com boa luz e sem sombra.'),
  cartao_cortado: () => 'Os quadrados dos cantos estão na beirada da foto: o cartão foi cortado. Afaste a câmera e enquadre a folha inteira, com uma margem em volta.',
  alinhamento: () => 'Os quadrados dos cantos não bateram com o cartão. Fotografe de frente, sem dobras e com os 4 quadrados inteiros dentro da foto — se algum canto estiver cortado, o cartão não é lido.',
  versao_diferente: (c) => `Este cartão foi impresso com o layout v${c.geometria} do cartão-resposta e o SIGEIA AVALIAÇÕES atual usa o v${GEOMETRIA_VERSAO}. Gere e imprima um cartão novo desta avaliação (aba Cartões).`,
  cartao_outra_versao: (c) => `As bolinhas deste cartão não batem com a avaliação: o cartão impresso usa ${c.grade.cols} coluna(s) × ${c.grade.rows} linha(s) e esta avaliação usa ${c.atual?.colunas} × ${c.atual?.linhas}. Ele foi impresso antes de a avaliação ser alterada (ou em outra versão do cartão). Gere e imprima um cartão novo na aba Cartões.`,
  questoes_diferentes: (c) => `O QR deste cartão diz ${c.questoes} questões, mas a avaliação tem ${c.avaliacao}. O cartão é de outra versão da avaliação — imprima um cartão novo.`,
  alternativas_diferentes: (c) => `O QR deste cartão diz ${c.alternativas} alternativas, mas a avaliação tem ${c.avaliacaoAlts}. Imprima um cartão novo desta avaliação.`,
  qr_diferente: (c) => `Este cartão é de outra avaliação (QR "${c.lido}"). Esperado: "${c.esperado}". Nada foi lido.`,
  grade: () => 'As bolinhas deste cartão não batem com o layout desta avaliação. Prováveis causas: cartão de outra versão/impressão antiga, foto torta ou cartão amassado. Se o cartão foi impresso antes de alguma alteração na avaliação, imprima um cartão novo (aba Cartões).',
  erro: (c) => 'Erro ao processar a imagem' + (c.detalhe ? ': ' + c.detalhe : '.') + ' Tente outra foto.',
};

/* ---------------- Pipeline ---------------- */

/**
 * @param {object} cv        OpenCV carregado (carregarOpenCV().cv)
 * @param {{data:Uint8ClampedArray,width:number,height:number}} imagem  RGBA (ImageData)
 * @param {object} o
 * @param {{numero:number, anulada?:boolean}[]} o.questoes
 * @param {number} [o.numAlternativas=5]
 * @param {string} [o.codigoEsperado]   código do caderno da avaliação escolhida (compara com o QR)
 * @param {object} [o.params]           ajustes de leitura (ver PARAMS_PADRAO); padrão = salvos no aparelho
 * @param {HTMLCanvasElement} [o.canvasQR] ajuda o BarcodeDetector nativo, se existir
 * @returns {Promise<object>} { ok, bloqueado, motivo, mensagem, aviso[], etapas, layout, leituras, resumo, alinhada, params, ms }
 */
export async function processarCartao(cv, imagem, o = {}) {
  const t0 = Date.now();
  const P = mesclarParams(o.params || carregarParametros());
  const etapas = {
    marcadores: { ok: false }, perspectiva: { ok: false }, grade: { ok: false },
    qr: { ok: false, texto: null, origem: null, cartao: null }, diagnostico: null,
  };
  const aviso = [];
  const falha = (chave, ctx = {}) => ({
    ok: false, bloqueado: true, motivo: chave, mensagem: MOTIVOS[chave](ctx), aviso, etapas,
    leituras: [], resumo: resumir([], true), alinhada: null, params: P, ms: Date.now() - t0,
  });

  let layout;
  try {
    layout = layoutDeAvaliacao(o.questoes || [], o.numAlternativas || 5);
  } catch (e) {
    return falha('mais_de_50');
  }
  const nQuestoes = layout.numeros.length;
  const nAlts = (o.numAlternativas || 5);

  const m = detectarMarcadores(cv, imagem, { maxLado: P.maxLado });
  etapas.marcadores = {
    ok: m.ok, achados: m.achados ?? 0, ocupacao: m.ocupacao ?? null, margem: m.margem ?? null, cortado: !!m.cortado,
  };
  if (!m.ok) return falha('marcadores', { achados: m.achados ?? 0 });
  if (m.cortado) return falha('cartao_cortado');

  const al = alinharCartao(cv, imagem, m.cantos);
  etapas.perspectiva = { ok: !!al.ok, refinado: !!al.refinado, marcadores: al.marcadoresMedidos ?? 0 };
  if (!al.ok) return falha('alinhamento');

  try {
    // 1) QR: primeiro na folha endireitada; só depois na foto inteira.
    let texto = lerQRNaFolha(cv, al.rgba);
    let origem = texto ? 'folha' : null;
    if (!texto) {
      texto = await lerQR(cv, imagem, o.canvasQR || null);
      origem = texto ? 'foto' : null;
    }
    const cartao = texto ? interpretarPayload(texto) : null;
    etapas.qr = { ok: !!texto, texto, origem, cartao };

    if (!texto) aviso.push('qr_nao_lido');

    // 2) O QR diz de que cartão é: conferir versão do layout e tamanho da grade.
    //    Cartões de layout anterior (v3/v4) têm folha de outro tamanho: não são lidos.
    //    O leitor para aqui, com mensagem clara, em vez de ler lixo.
    if (cartao && !cartao.legado) {
      if (cartao.geometria && cartao.geometria !== GEOMETRIA_VERSAO) {
        return falha('versao_diferente', { geometria: cartao.geometria });
      }
      if (cartao.questoes && cartao.questoes !== nQuestoes) {
        return falha('questoes_diferentes', { questoes: cartao.questoes, avaliacao: nQuestoes });
      }
      if (cartao.alternativas && cartao.alternativas !== nAlts) {
        return falha('alternativas_diferentes', { alternativas: cartao.alternativas, avaliacaoAlts: nAlts });
      }
    }

    // 3) O cartão é da avaliação escolhida?
    const esperado = String(o.codigoEsperado || '').trim();
    if (esperado && cartao && !igualCodigo(cartao.codigo, esperado)) {
      return falha('qr_diferente', { lido: resumoQR(texto), esperado });
    }

    // 4) A grade impressa corresponde ao layout calculado?
    let g = verificarGrade(cv, al.cinza, layout, P.minGrade);
    etapas.versao = layout.versao;
    etapas.grade = g;
    if (!g.ok) {
      // O QR já provou qual é o cartão (mesma versão, mesmas questões e alternativas) e a
      // grade está pelo menos meio no lugar: o problema é a foto (desfoque, sombra, tremor),
      // não o cartão. Segue com aviso — e nenhuma questão em branco é dada como certa
      // (o bloco abaixo marca todas as em branco para conferência manual).
      const identidadeConfirmada = !!cartao && !cartao.legado
        && (!cartao.geometria || cartao.geometria === layout.versao)
        && (!cartao.questoes || cartao.questoes === nQuestoes)
        && (!cartao.alternativas || cartao.alternativas === nAlts);
      if (!(identidadeConfirmada && g.razao >= 0.5)) {
        aviso.push('grade_nao_confere');
        // Antes de culpar a foto: o cartão pode ser de outra versão do layout.
        const d = diagnosticarGrade(cv, al.cinza, {
          questoes: o.questoes || [], numAlternativas: nAlts, minimo: P.minGrade,
        });
        etapas.diagnostico = d;
        // Só afirma "outra versão" quando outra grade explica MUITO bem o que está impresso.
        const outraGrade = d.grade && (d.grade.cols !== layout.colunas || d.grade.rows !== layout.linhas);
        if (outraGrade && d.razao >= Math.max(0.85, P.minGrade)) {
          return falha('cartao_outra_versao', { grade: d.grade, atual: layout });
        }
        return falha('grade', { razao: g.razao, impresso: layout });
      }
      etapas.grade = { ...g, parcial: true };
    }

    // 5) bolinhas
    let leituras = lerBolhas(cv, al.cinza, layout, P).leituras;

    // Grade "quase" certa (algumas bolinhas fora do lugar): cartão pode ter sido impresso
    // com outra versão da avaliação. Questão em branco deixa de ser resposta automática
    // e passa para a conferência — em branco por não existir no cartão é diferente de
    // em branco por não ter sido marcada.
    if (g.razao < 0.95) {
      aviso.push('grade_parcial');
      leituras = leituras.map((l) => (l.estado === 'branco' ? { ...l, confere: true } : l));
    }

    // cópia simples da folha endireitada (para desenharRevisao) — os Mats são liberados abaixo
    const alinhada = { cols: al.rgba.cols, rows: al.rgba.rows, data: new Uint8ClampedArray(al.rgba.data) };

    return {
      ok: true,
      bloqueado: false,
      motivo: null,
      mensagem: null,
      aviso,
      etapas,
      layout,
      leituras,
      resumo: resumir(leituras, false),
      alinhada,
      params: P,
      ms: Date.now() - t0,
    };
  } catch (e) {
    console.error('[SIGEIA AVALIAÇÕES] processarCartao', e);
    return falha('erro', { detalhe: e?.message || String(e) });
  } finally {
    al.cinza.delete();
    al.rgba.delete();
  }
}

const igualCodigo = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

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

/** Rótulo curto de como o cartão foi impresso, para exibir na conferência. */
export function descreverCartao(cartao) {
  if (!cartao) return '';
  if (cartao.legado) return 'QR antigo (só o código do caderno)';
  return [
    `caderno ${cartao.caderno || '—'}`,
    cartao.geometria ? `layout v${cartao.geometria}` : null,
    cartao.questoes ? `${cartao.questoes} questões` : null,
    cartao.alternativas ? `${cartao.alternativas} alternativas` : null,
  ].filter(Boolean).join(' · ');
}

/** Layout do cartão para a grade forçada (usado em diagnóstico/testes). */
export function layoutParaGrade(questoes, grade, numAlternativas = 5) {
  return layoutCartao(questoes, numAlternativas, LETRAS_CARTAO.slice(0, numAlternativas), grade);
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

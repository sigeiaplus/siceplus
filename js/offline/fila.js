/* ============================================================
   SICEP+ · Fila de sincronização offline — Etapa 6D

   Resultados gravados sem internet (ou que falharam por rede) ficam
   na fila IndexedDB e são enviados ao Supabase quando possível.

   Garantias:
   - Idempotência: cada operação carrega o `resultado_id` gerado no
     aparelho (6C). Repetir o envio atualiza a MESMA linha, nunca cria outra.
   - Ordem: itens processados por `seq` crescente, um de cada vez.
     Falha de rede para tudo (a ordem se mantém); erro definitivo de um
     resultado só bloqueia as operações seguintes do MESMO resultado/aluno.
   - Uma sincronização por vez: trava entre abas (Web Locks) + trava na aba.
   - Nada se perde: item com erro continua guardado até enviar ou o
     usuário descartar. Só o status muda.
   - Etapa 6E: também avaliações criadas offline. Cada avaliação entra como DOIS itens
     gravados juntos, nesta ordem: 'avaliacao' (linha + código do caderno) e 'questoes'
     (questões e alternativas). Se a avaliação for recusada, as questões e os resultados
     dela esperam; nada é enviado fora de ordem. Nada é apagado por uma recusa: o que
     ficou guardado volta para a fila.
   - Etapa 6F: 'edicao' (avaliação já existente editada no aparelho). Antes de gravar,
     compara a versão que o professor tinha com a versão atual da nuvem. Se divergirem,
     o item vira 'conflito' e as DUAS versões ficam guardadas até o professor decidir.
   - Nada aqui fala com o SIDED+.

   Status: pendente → sincronizando → sincronizado | erro | conflito
   ============================================================ */

import * as banco from './db.js';
import * as nuvem from '../nuvem.js';

export const STATUS = {
  PENDENTE: 'pendente',
  SINCRONIZANDO: 'sincronizando',
  SINCRONIZADO: 'sincronizado',
  ERRO: 'erro',
  CONFLITO: 'conflito',
};

export const TIPOS_DE_AVALIACAO = ['avaliacao', 'questoes', 'edicao'];

const TEMPO_MAX_ITEM_MS = 45000;          // um item não pode segurar a fila para sempre
const RETENCAO_SINCRONIZADOS_MS = 7 * 24 * 60 * 60 * 1000;
const NOME_TRAVA = 'sicep-fila-sync';
const NOME_CANAL = 'sicep-fila-sync';

/* ---------------- Aviso de mudanças (esta aba e as outras) ---------------- */

const ouvintes = new Set();
let canal = null;
try { if (typeof BroadcastChannel !== 'undefined') canal = new BroadcastChannel(NOME_CANAL); } catch (e) { canal = null; }
if (canal) {
  canal.onmessage = () => ouvintes.forEach((f) => { try { f(); } catch (e) { /* ignora */ } });
  if (typeof canal.unref === 'function') canal.unref(); // Node (testes): não segura o processo aberto
}

/** Chama `fn` sempre que a fila mudar. Devolve a função que cancela. */
export function aoMudar(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function avisarMudanca() {
  ouvintes.forEach((f) => { try { f(); } catch (e) { /* ignora */ } });
  try { canal?.postMessage('mudou'); } catch (e) { /* ignora */ }
}

/* ---------------- Entrada e consulta ---------------- */

/**
 * Registra um resultado na fila. `dados`: { resultado_id, chave_alvo, payload, imagem_ref, confianca, local }.
 * Devolve o item ou null (IndexedDB indisponível — quem chama decide o plano B).
 */
export async function enfileirar(usuarioId, dados) {
  const item = await banco.filaEnfileirar(usuarioId, {
    tipo: 'resultado',
    resultado_id: dados.resultado_id,
    chave_alvo: dados.chave_alvo,
    dados: { payload: dados.payload, imagem_ref: dados.imagem_ref || null, confianca: dados.confianca ?? null },
    local: dados.local,
    scan_ok: false,
    sincronizado_em: null,
  });
  if (item) avisarMudanca();
  return item;
}

/**
 * Registra uma avaliação criada no aparelho (6E): item 'avaliacao' primeiro, 'questoes' depois,
 * numa única gravação. `dados`: { avaliacao_id, avaliacao (corpo da avaliação), codigo_caderno,
 * escola_id, professor_id, questoes, num_alternativas, local }.
 * Devolve os itens ou null (IndexedDB indisponível — quem chama decide o plano B).
 */
export async function enfileirarAvaliacao(usuarioId, dados) {
  const comum = { avaliacao_id: dados.avaliacao_id, chave_alvo: `avaliacao|${dados.avaliacao_id}`, local: dados.local, scan_ok: false };
  const itens = await banco.filaEnfileirarLote(usuarioId, dados.avaliacao_id, [
    {
      ...comum,
      tipo: 'avaliacao',
      dados: {
        avaliacao: dados.avaliacao,
        codigo_caderno: dados.codigo_caderno || null,
        escola_id: dados.escola_id || null,
        professor_id: dados.professor_id || null,
        qtd_questoes: dados.questoes.length,
        num_alternativas: dados.num_alternativas,
      },
    },
    {
      ...comum,
      tipo: 'questoes',
      dados: { questoes: dados.questoes, num_alternativas: dados.num_alternativas },
    },
  ]);
  if (itens) avisarMudanca();
  return itens;
}

/**
 * Registra uma EDIÇÃO de avaliação já existente, feita no aparelho (6F).
 * `dados`: { avaliacao_id, patch, questoes, num_alternativas, codigo_caderno, escola_id,
 * professor_id, base_versao, trimestre_travado, remover_questoes, local }.
 * Devolve o item (ou null se o IndexedDB não existir).
 */
export async function enfileirarEdicao(usuarioId, dados) {
  const item = await banco.filaEnfileirarEdicao(usuarioId, {
    tipo: 'edicao',
    avaliacao_id: dados.avaliacao_id,
    chave_alvo: `avaliacao|${dados.avaliacao_id}`,
    dados: {
      patch: dados.patch,
      questoes: dados.questoes,
      num_alternativas: dados.num_alternativas,
      codigo_caderno: dados.codigo_caderno || null,
      escola_id: dados.escola_id || null,
      professor_id: dados.professor_id || null,
      base_versao: dados.base_versao || null,
      trimestre_travado: !!dados.trimestre_travado,
      remover_questoes: dados.remover_questoes !== false,
    },
    local: dados.local,
    scan_ok: false,
    sincronizado_em: null,
  });
  if (item) avisarMudanca();
  return item;
}

export function listar(usuarioId) { return banco.filaListar(usuarioId); }

/** Contagem por status e total em aberto (tudo que ainda não chegou ao servidor). */
export async function contar(usuarioId) {
  const itens = await banco.filaListar(usuarioId);
  const c = { pendente: 0, sincronizando: 0, sincronizado: 0, erro: 0, conflito: 0, aberto: 0, total: itens.length };
  itens.forEach((i) => { c[i.status] = (c[i.status] || 0) + 1; });
  c.aberto = c.pendente + c.sincronizando + c.erro + c.conflito;
  return c;
}

/**
 * Resolve um conflito de edição (decisão explícita do professor).
 * - 'local': mantém a versão deste aparelho; o próximo envio sobrescreve a da nuvem (forçar).
 * - 'nuvem': mantém a versão da nuvem; a edição local é descartada (nada mais é apagado).
 * As duas versões continuam guardadas até esta chamada.
 */
export async function resolverConflito(usuarioId, seq, escolha) {
  if (escolha === 'nuvem') {
    const ok = await banco.filaRemover([seq]);
    if (ok) avisarMudanca();
    return ok;
  }
  const item = await banco.filaAtualizar(seq, (x) => ({
    ...x,
    status: STATUS.PENDENTE,
    permanente: false,
    erro: null,
    tentativas: 0,
    conflito: null,
    dados: { ...x.dados, forcar: true },
  }));
  if (item) avisarMudanca();
  return Boolean(item);
}

/** Descarta um item que não vai mais ser enviado (ação explícita do usuário). */
export async function descartar(seq) {
  const ok = await banco.filaRemover([seq]);
  if (ok) avisarMudanca();
  return ok;
}

/** Libera o item para nova tentativa imediata (apaga o erro e o bloqueio). */
export async function liberarParaNovaTentativa(usuarioId) {
  const itens = await banco.filaListar(usuarioId);
  await Promise.all(itens.filter((i) => i.status === STATUS.ERRO).map((i) => banco.filaAtualizar(i.seq, (x) => ({
    ...x, status: STATUS.PENDENTE, permanente: false,
  }))));
}

/* ---------------- Classificação de falhas ---------------- */

/**
 * Transitória = vale tentar de novo sozinho (rede, tempo esgotado, servidor 5xx/408/425/429).
 * Definitiva = o servidor recusou este resultado (4xx, duplicado): só o usuário resolve.
 */
export function ehTransitoria(e) {
  if (!e) return true;
  if (e.codigo === 'RESULTADO_DUPLICADO') return false;
  if (e.status == null) return true;
  return e.status >= 500 || [408, 425, 429].includes(e.status);
}

export function mensagemDoErro(e) {
  if (e?.codigo === 'CONFLITO') return 'A avaliação foi alterada na nuvem enquanto você editava aqui. Escolha qual versão manter.';
  if (e?.codigo === 'RESULTADO_DUPLICADO') {
    return 'Já existe outro resultado deste aluno nesta avaliação na nuvem (gravado em outro aparelho ou momento).';
  }
  if (e?.status == null) return 'Sem conexão com a nuvem.';
  return `A nuvem recusou o envio (${String(e.message || e.status).slice(0, 160)}).`;
}

function comLimite(promessa, ms) {
  let t;
  const limite = new Promise((_, falha) => { t = setTimeout(() => falha(new Error('A nuvem demorou demais para responder.')), ms); });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(t));
}

const semInternet = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/* ---------------- Processamento ---------------- */

let emAndamento = null; // promessa da sincronização desta aba (evita duas ao mesmo tempo aqui)

/**
 * Processa a fila do usuário.
 * `aoSincronizar(item, linhaDoServidor)` é chamado SÓ depois que o servidor confirmou a gravação:
 * é aí que o estado local deixa de ser "pendente".
 *
 * Devolve { rodou, motivo?, sincronizados, falhas, parou }:
 *   motivo 'offline' | 'ocupado' quando nada foi tentado.
 */
export function processar(usuarioId, { aoSincronizar = null } = {}) {
  if (emAndamento) return emAndamento;

  const execucao = (async () => {
    if (usuarioId == null) return { rodou: false, motivo: 'sem-usuario', sincronizados: 0, falhas: 0 };
    if (semInternet()) return { rodou: false, motivo: 'offline', sincronizados: 0, falhas: 0 };

    const rodar = () => rodarFila(usuarioId, { aoSincronizar });
    const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
    if (locks && typeof locks.request === 'function') {
      // Outra aba já sincronizando: ela vai pegar também o que acabou de entrar (relê a fila a cada item).
      const r = await locks.request(NOME_TRAVA, { ifAvailable: true }, async (trava) => (trava ? rodar() : null));
      return r || { rodou: false, motivo: 'ocupado', sincronizados: 0, falhas: 0 };
    }
    return rodar();
  })();

  // A trava desta aba só é solta DEPOIS de atribuída: se a execução terminar sem nenhum `await`
  // (ex.: offline), limpar dentro do próprio async deixaria a promessa velha presa para sempre.
  emAndamento = execucao;
  const soltar = () => { if (emAndamento === execucao) emAndamento = null; };
  execucao.then(soltar, soltar);
  return execucao;
}

async function rodarFila(usuarioId, { aoSincronizar }) {
  const resumo = { rodou: true, sincronizados: 0, falhas: 0, conflitos: 0, parou: null };

  // Com a trava em mãos ninguém mais está enviando: o que ficou "sincronizando" é de uma
  // execução interrompida (aba fechada, bateria...). Volta a pendente — o envio é idempotente.
  const iniciais = await banco.filaListar(usuarioId);
  await Promise.all(iniciais.filter((i) => i.status === STATUS.SINCRONIZANDO).map((i) => banco.filaAtualizar(i.seq, (x) => ({
    ...x, status: STATUS.PENDENTE,
  }))));

  const tratados = new Set();   // seq já tentados nesta execução (não repete o que falhou)
  const bloqueadas = new Set(); // resultados com erro definitivo: operações seguintes do mesmo alvo esperam
  const avaliacoesBloqueadas = new Set(); // avaliação recusada/em conflito: suas questões e resultados esperam
  const marcarBloqueio = (i) => {
    bloqueadas.add(i.chave_alvo);
    if (TIPOS_DE_AVALIACAO.includes(i.tipo)) avaliacoesBloqueadas.add(i.avaliacao_id);
  };

  for (;;) {
    if (semInternet()) { resumo.parou = 'offline'; break; }

    // Relê a fila a cada passo: o que entrou durante o envio é pego na mesma execução, na ordem.
    const itens = await banco.filaListar(usuarioId);
    const proximo = itens.find((i) => {
      if (tratados.has(i.seq) || i.status === STATUS.SINCRONIZADO) return false;
      // Conflito só sai daqui por decisão do professor (resolverConflito).
      if (i.status === STATUS.CONFLITO) { marcarBloqueio(i); return false; }
      if (i.status === STATUS.ERRO && i.permanente) { marcarBloqueio(i); return false; } // só o usuário libera (liberarParaNovaTentativa)
      return true;
    });
    if (!proximo) break;
    tratados.add(proximo.seq);

    if (bloqueadas.has(proximo.chave_alvo)) continue;
    // Resultado de uma avaliação que a nuvem recusou: espera (sem a avaliação na nuvem ele também seria recusado).
    if (proximo.tipo === 'resultado' && avaliacoesBloqueadas.has(proximo.local?.avaliacao_id)) continue;

    const emEnvio = await banco.filaAtualizar(proximo.seq, (x) => ({
      ...x, status: STATUS.SINCRONIZANDO, tentativas: (x.tentativas || 0) + 1,
    }));
    if (!emEnvio) continue; // foi descartado no meio do caminho
    avisarMudanca();

    try {
      const linha = await comLimite(enviarItem(emEnvio), TEMPO_MAX_ITEM_MS);

      // O servidor confirmou. Só agora o item vira "sincronizado".
      // Se o item foi descartado ou mudou de estado no meio do envio, não mexe nele.
      const final = await banco.filaAtualizar(emEnvio.seq, (x) => {
        if (x.status !== STATUS.SINCRONIZANDO) return null;
        return { ...x, status: STATUS.SINCRONIZADO, erro: null, permanente: false, sincronizado_em: new Date().toISOString(), scan_ok: emEnvio.scan_ok };
      });
      if (final) {
        resumo.sincronizados += 1;
        if (aoSincronizar) { try { await aoSincronizar(final, linha); } catch (e) { console.warn('[SICEP+] aoSincronizar', e); } }
      }
    } catch (e) {
      // Divergência entre a edição local e a nuvem: guarda as duas versões e para este alvo.
      if (e?.codigo === 'CONFLITO') {
        await banco.filaAtualizar(emEnvio.seq, (x) => (x.status === STATUS.SINCRONIZANDO
          ? {
            ...x,
            status: STATUS.CONFLITO,
            erro: mensagemDoErro(e),
            codigo_erro: 'CONFLITO',
            permanente: true,
            conflito: {
              detectado_em: new Date().toISOString(),
              servidor: e.servidor?.resumo || null,
            },
            scan_ok: emEnvio.scan_ok,
          }
          : null));
        resumo.conflitos = (resumo.conflitos || 0) + 1;
        marcarBloqueio(emEnvio);
        avisarMudanca();
        continue;
      }

      const transitoria = ehTransitoria(e);
      resumo.falhas += 1;
      await banco.filaAtualizar(emEnvio.seq, (x) => (x.status === STATUS.SINCRONIZANDO
        ? { ...x, status: STATUS.ERRO, erro: mensagemDoErro(e), codigo_erro: e?.codigo || null, permanente: !transitoria, scan_ok: emEnvio.scan_ok }
        : null));
      console.warn('[SICEP+] sincronizar item', emEnvio.tipo, emEnvio.resultado_id || emEnvio.avaliacao_id, e?.message || e);
      if (transitoria) { resumo.parou = 'rede'; avisarMudanca(); break; } // rede caiu: não adianta seguir; a ordem se mantém
      marcarBloqueio(emEnvio);
    }
    avisarMudanca();
  }

  await podarSincronizados(usuarioId);
  avisarMudanca();
  return resumo;
}

/**
 * Um item. Tudo aqui é idempotente: repetir após queda de rede não cria nada em dobro.
 *  - 'resultado': grava o resultado e, se houver, registra o scan uma única vez;
 *  - 'avaliacao': grava a avaliação (id do aparelho) e o código do caderno;
 *  - 'questoes' : grava questões e alternativas (só roda depois da avaliação: ordem da fila);
 *  - 'edicao'   : aplica a edição local sobre a avaliação existente, com detecção de conflito.
 */
async function enviarItem(item) {
  if (item.tipo === 'edicao') {
    const d = item.dados;
    return nuvem.aplicarEdicaoAvaliacao({
      avaliacao_id: item.avaliacao_id,
      patch: d.patch,
      questoes: d.questoes,
      num_alternativas: d.num_alternativas,
      codigo_caderno: d.codigo_caderno,
      professor_id: d.professor_id,
      escola_id: d.escola_id,
      base_versao: d.forcar ? null : d.base_versao,
      forcar: !!d.forcar,
      trimestre_travado: !!d.trimestre_travado,
      remover_questoes: d.remover_questoes !== false,
    });
  }

  if (item.tipo === 'avaliacao') {
    const d = item.dados;
    const avaliacao = await nuvem.gravarAvaliacaoIdempotente({ ...d.avaliacao, id: item.avaliacao_id }, item.usuario_id);
    if (d.codigo_caderno) {
      await nuvem.salvarLayoutCaderno({
        avaliacaoId: avaliacao.id,
        professorId: d.professor_id,
        escolaId: d.escola_id,
        codigo: d.codigo_caderno,
        qtdQuestoes: d.qtd_questoes,
        qtdAlternativas: d.num_alternativas,
      });
    }
    return avaliacao;
  }

  if (item.tipo === 'questoes') {
    const d = item.dados;
    const salvas = await nuvem.gravarQuestoesIdempotente(item.avaliacao_id, d.questoes, d.num_alternativas);
    return { questoes: salvas };
  }

  const { payload, imagem_ref: imagemRef, confianca } = item.dados;
  const linha = await nuvem.gravarResultadoIdempotente({ ...payload, id: item.resultado_id });

  if (imagemRef && !item.scan_ok) {
    await nuvem.registrarScan({
      resultado_id: item.resultado_id,
      imagem_url: imagemRef,
      respostas_detectadas: payload.respostas,
      confianca,
    });
    item.scan_ok = true; // o resultado já está gravado: numa nova tentativa só falta o scan, e ele não repete
  }
  return linha;
}

/** Sincronizados antigos saem da fila (histórico curto); o que não chegou nunca é podado. */
async function podarSincronizados(usuarioId) {
  const limite = Date.now() - RETENCAO_SINCRONIZADOS_MS;
  const itens = await banco.filaListar(usuarioId);
  const velhos = itens
    .filter((i) => i.status === STATUS.SINCRONIZADO && i.sincronizado_em && Date.parse(i.sincronizado_em) < limite)
    .map((i) => i.seq);
  if (velhos.length) await banco.filaRemover(velhos);
}

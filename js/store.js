/* ============================================================
   SICEP+ · Camada de dados — SOMENTE dados reais (Supabase)

   Não existe modo demonstração: se a sessão ou a conexão
   falharem, a interface mostra o motivo e não preenche a tela
   com dados inventados.

   Mapeamento conferido no banco:
   - sicep_avaliacoes.professor_id  -> users(id)
   - turma_disciplinas.professor_id -> professores(id)
   ============================================================ */

import * as nuvem from './nuvem.js';
import * as offline from './offline/db.js';
import * as filaSync from './offline/fila.js';
import { configurado, CONFIG } from './config.js';

export const ALTERNATIVAS = ['A', 'B', 'C', 'D', 'E'];
export const MAX_QUESTOES = 50;

export const SITUACOES = {
  normal: { rotulo: 'Corrigido', geraNota: true, tipo: 'ok' },
  ausente: { rotulo: 'Ausente', geraNota: true, notaZero: true, tipo: 'err' },
  abstencao: { rotulo: 'Abstenção', geraNota: true, notaZero: true, tipo: 'warn', exigeColuna: true },
  nao_entregue: { rotulo: 'Cartão não entregue', geraNota: true, notaZero: true, tipo: 'warn', exigeColuna: true },
  cartao_branco: { rotulo: 'Cartão em branco', geraNota: true, notaZero: true, tipo: 'warn', exigeColuna: true },
  cartao_invalido: { rotulo: 'Cartão inválido ou danificado', geraNota: false, tipo: 'err', exigeColuna: true },
};

const CHAVE_DEMO_ANTIGA = 'sicep.demo.v2';

const vazio = () => ({
  sessao: null,
  turmas: [],
  disciplinas: [],
  professores: [],
  turma_disciplinas: [],
  alunos: [],
  avaliacoes: [],
  resultados: [],
  scans: [],
  fila: [],
  erros: [],
});

let db = vazio();
let estado = 'carregando'; // carregando | sem-config | sem-sessao | erro | pronto
let erro = null;
let recursos = { prazo: false, faixas: false, anulada: false, situacao: false, turma_disciplina: false, trimestre: false };
let origem = 'nuvem'; // nuvem | cache — de onde vieram os dados em memória
let cacheEm = null;   // ISO da última cópia local usada/gravada
let motivoCache = null;
// Fila de sincronização (6D): contagem em memória para o chip e as guardas; a verdade fica no IndexedDB.
let contagemFila = { pendente: 0, sincronizando: 0, sincronizado: 0, erro: 0, aberto: 0, total: 0 };
let sincronizando = false;
const ouvintesFila = new Set();

// Sessão offline: vale por este tempo a partir do login (não renova sozinha).
// Passou disso, é preciso entrar de novo com internet.
export const VALIDADE_SESSAO_MS = 14 * 24 * 60 * 60 * 1000;
// Sem resposta da nuvem neste prazo, o app abre com a cópia local.
const LIMITE_NUVEM_MS = 20000;
// Ao salvar um resultado, espera a nuvem no máximo isto; depois segue (o envio continua em segundo plano).
const ESPERA_MAX_SALVAR_MS = 15000;

function comLimite(promessa, ms) {
  let t;
  const limite = new Promise((_, falha) => { t = setTimeout(() => falha(new Error('A nuvem demorou demais para responder.')), ms); });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(t));
}

function esperarNoMaximo(promessa, ms) {
  let t;
  const limite = new Promise((ok) => { t = setTimeout(ok, ms); });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(t));
}

// Precisão de nota: até 10 casas decimais (0,25 não vira 0,3).
const arred = (n) => Math.round((Number(n) || 0) * 1e10) / 1e10;
const hojeISO = () => new Date().toISOString().slice(0, 10);

/* ---------------- Sessão persistida (reabrir offline) ---------------- */

function gravarSessaoNoNavegador(usuario, professor) {
  sessionStorage.setItem('ded_user', JSON.stringify(usuario));
  sessionStorage.setItem('prof_data', JSON.stringify(professor));
}

// Só o necessário para o app funcionar: nunca senha, hash, CPF ou e-mail.
function sessaoMinima(usuario, professor, criadoEm = Date.now()) {
  return {
    usuario_id: usuario.id,
    usuario: { id: usuario.id, nome: usuario.nome || null, role: usuario.role || null, escola_id: usuario.escola_id || null },
    professor: professor ? { id: professor.id, nome: professor.nome || null, escola_id: professor.escola_id || null } : null,
    criado_em: criadoEm,
    expira_em: criadoEm + VALIDADE_SESSAO_MS,
  };
}

/** Apaga sessão e cópia local do usuário (logout ou sessão vencida). */
async function esquecerLocal(usuarioId) {
  try { sessionStorage.removeItem('ded_user'); sessionStorage.removeItem('prof_data'); } catch (e) { /* ignora */ }
  try { await offline.apagarSessao(); } catch (e) { /* ignora */ }
  try { if (usuarioId != null) await offline.limparCache(usuarioId); } catch (e) { /* ignora */ }
}

/**
 * Garante que a sessão do navegador exista e esteja dentro da validade.
 * - Sem sessão do navegador (app foi fechado): restaura a sessão persistida, se ainda valer.
 * - Sessão persistida vencida: apaga sessão e cópia local; o usuário precisa entrar de novo.
 * Nunca cria sessão nova: só login online (entrar) faz isso.
 */
async function conferirSessaoLocal() {
  let persistida = null;
  try { persistida = await offline.lerSessao(); } catch (e) { persistida = null; }

  if (persistida && (!persistida.expira_em || Date.now() >= persistida.expira_em || !persistida.usuario?.id)) {
    await esquecerLocal(persistida.usuario_id);
    return;
  }

  if (nuvem.sessaoRemota()) return; // sessão do navegador já existe e não está vencida
  if (!persistida) return;

  try { gravarSessaoNoNavegador(persistida.usuario, persistida.professor); } catch (e) { /* ignora */ }
}

/** Primeira abertura com sessão do navegador mas sem registro persistido (ex.: sessão anterior a esta versão). */
async function garantirSessaoPersistida(remota) {
  try {
    const atual = await offline.lerSessao();
    if (atual && atual.usuario_id === remota.usuario_id) return;
    const usuario = JSON.parse(sessionStorage.getItem('ded_user') || 'null');
    const prof = JSON.parse(sessionStorage.getItem('prof_data') || 'null');
    if (!usuario?.id) return;
    await offline.limparCacheDeOutros(usuario.id);
    await offline.gravarSessao(sessaoMinima(usuario, prof));
  } catch (e) { /* ignora */ }
}

/* ---------------- Inicialização ---------------- */

export async function iniciar() {
  // Remove qualquer resíduo de demonstração de versões anteriores.
  try { localStorage.removeItem(CHAVE_DEMO_ANTIGA); } catch (e) { /* ignora */ }

  if (!configurado()) {
    estado = 'sem-config';
    return { estado, erro: null };
  }

  await conferirSessaoLocal();

  const remota = nuvem.sessaoRemota();
  if (!remota) {
    estado = 'sem-sessao';
    return { estado, erro: null };
  }

  estado = 'carregando';
  const usuarioId = remota.usuario_id;
  let falhaNuvem = null;

  // Sem internet declarada pelo navegador: nem tenta a nuvem, vai direto para a cópia local.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    falhaNuvem = new Error('Sem conexão com a internet.');
  } else {
    try {
      const novosRecursos = await comLimite(nuvem.detectarRecursos(), LIMITE_NUVEM_MS);
      const ctx = await comLimite(nuvem.carregarContexto(), LIMITE_NUVEM_MS);
      const [avs, ress] = await comLimite(Promise.all([
        nuvem.carregarAvaliacoes(remota.usuario_id, novosRecursos),
        nuvem.carregarResultados(remota.usuario_id),
      ]), LIMITE_NUVEM_MS);
      recursos = novosRecursos;
      db = montar(ctx, avs, ress);
      estado = 'pronto';
      erro = null;
      origem = 'nuvem';
      motivoCache = null;
      await aplicarFilaNoEstado();
      await garantirSessaoPersistida(remota);
      await gravarCacheLocal();
      return { estado, erro: null, recursos, origem };
    } catch (e) {
      falhaNuvem = e;
    }
  }

  // A nuvem falhou: nunca apaga o que já existe localmente.
  console.warn('[SICEP+] Nuvem indisponível, tentando a cópia local:', falhaNuvem?.message);

  const copia = await offline.lerCache(usuarioId).catch(() => null);
  if (copia) {
    db = copia.db;
    recursos = { ...recursos, ...copia.recursos };
    estado = 'pronto';
    erro = null;
    origem = 'cache';
    cacheEm = copia.atualizado_em;
    motivoCache = falhaNuvem?.message || null;
    await aplicarFilaNoEstado();
    return { estado, erro: null, recursos, origem };
  }

  // Sem cópia gravada, mas os dados deste mesmo usuário ainda estão na memória (ex.: recarregar sem rede).
  if (db.sessao && db.sessao.usuario_id === usuarioId) {
    estado = 'pronto';
    erro = null;
    origem = 'cache';
    motivoCache = falhaNuvem?.message || null;
    await aplicarFilaNoEstado();
    return { estado, erro: null, recursos, origem };
  }

  console.error('[SICEP+] Falha ao carregar dados reais:', falhaNuvem);
  estado = 'erro';
  erro = falhaNuvem?.message || 'Falha ao carregar os dados.';
  db = vazio();
  return { estado, erro };
}

/** Grava no IndexedDB a cópia dos dados atuais (somente quando vieram da nuvem). */
async function gravarCacheLocal() {
  if (origem !== 'nuvem' || !db.sessao) return false;
  const ok = await offline.salvarCache(db.sessao.usuario_id, {
    sessao: db.sessao,
    recursos,
    turmas: db.turmas,
    disciplinas: db.disciplinas,
    professores: db.professores,
    turma_disciplinas: db.turma_disciplinas,
    alunos: db.alunos,
    avaliacoes: db.avaliacoes,
    // A cópia local só recebe o que o servidor já confirmou. Resultado ainda na fila
    // (pendente/sincronizando/erro) vive na fila, não aqui — e é reaplicado ao abrir.
    resultados: db.resultados.filter((r) => !r.sync || r.sync === 'sincronizado'),
  });
  if (ok) cacheEm = new Date().toISOString();
  return ok;
}

// Chamado depois de gravações bem-sucedidas na nuvem, para a cópia local não ficar velha.
function atualizarCacheLocal() {
  gravarCacheLocal().catch(() => { /* cópia local é auxiliar */ });
}

export async function recarregar() {
  return iniciar();
}

function montar(ctx, avs, resultados) {
  const sessao = {
    usuario_id: ctx.sessao.usuario_id,
    professor_id: ctx.sessao.professor_id,
    nome: ctx.sessao.nome,
    escola: ctx.escolaNome || 'Escola não informada',
    escola_id: ctx.sessao.escola_id,
    perfil: ctx.sessao.role,
  };

  const avaliacoes = avs.map((a) => {
    const aplicacoes = (a.turmas_ids || []).map((turmaId) => {
      const candidatos = ctx.turma_disciplinas.filter((v) => v.turma_id === turmaId);
      const comNome = candidatos.find((v) => {
        const d = ctx.disciplinas.find((x) => x.id === v.disciplina_id);
        return d && a.disciplina && d.nome === a.disciplina;
      });
      const v = comNome || candidatos[0] || null;
      return {
        id: `${a.id}:${turmaId}`,
        turma_id: turmaId,
        turma_disciplina_id: v?.id || null,
        disciplina_id: v?.disciplina_id || null,
        professor_id: v?.professor_id || ctx.sessao.professor_id,
        sided_avaliacao_id: a.sided_avaliacao_id || null,
      };
    });
    return { ...a, aplicacoes };
  });

  const resultadosMapeados = resultados.map((r) => {
    const av = avaliacoes.find((x) => x.id === r.avaliacao_id) || null;
    const apl = av?.aplicacoes.find((x) => x.turma_id === r.turma_id) || null;
    const respostas = r.respostas || {};
    const calc = av ? calcularCorrecao(av, respostas) : null;
    const situacao = r.situacao || (r.ausente ? 'ausente' : 'normal');
    const nota = r.nota == null ? null : Number(r.nota);
    const total = Number(av?.valor_total || 0);
    // A nota gravada é a fonte da verdade; o percentual vem dela.
    const percentual = nota == null || total <= 0
      ? null
      : Math.round((nota / total) * 1000) / 10;

    return {
      id: r.id,
      avaliacao_id: r.avaliacao_id,
      aplicacao_id: apl?.id || null,
      turma_id: r.turma_id,
      turma_disciplina_id: apl?.turma_disciplina_id || null,
      disciplina_id: apl?.disciplina_id || null,
      aluno_id: r.aluno_id,
      respostas,
      nota,
      acertos: calc && situacao === 'normal' ? calc.acertos : null,
      erros: calc && situacao === 'normal' ? calc.erros : null,
      anuladas: calc ? calc.anuladas : 0,
      percentual,
      confianca: r.confianca != null ? Number(r.confianca) : null,
      situacao,
      status: r.status || 'confirmado',
      revisado_em: r.revisado_em || null,
      enviado_em: r.enviado_sided_em || null,
      origem: 'leitura',
      criado_em: r.created_at,
      registrado_por: r.registrado_por,
      observacao: '',
    };
  });

  return {
    sessao,
    turmas: ctx.turmas,
    disciplinas: ctx.disciplinas,
    professores: ctx.professores,
    turma_disciplinas: ctx.turma_disciplinas,
    alunos: ctx.alunos,
    avaliacoes,
    resultados: resultadosMapeados,
    scans: [],
    fila: [],
    erros: [],
  };
}

/* ---------------- Estado e sessão ---------------- */

export function get() { return db; }
export function sessao() { return db.sessao; }
export function autenticado() { return Boolean(db.sessao) && estado === 'pronto'; }
export function estadoAtual() { return estado; }
export function erroDeConexao() { return erro; }
/** 'nuvem' (dados recém-carregados do Supabase) ou 'cache' (cópia local, sem conexão com a nuvem). */
export function origemDados() { return origem; }
export function dadosEmCache() { return origem === 'cache'; }
export function cacheAtualizadoEm() { return cacheEm; }
export function motivoDoCache() { return motivoCache; }
export function recursosDisponiveis() { return recursos; }
export function tem(recurso) { return Boolean(recursos[recurso]); }
export function situacaoSuportada(situacao) {
  const cfg = SITUACOES[situacao];
  if (!cfg) return false;
  return !cfg.exigeColuna || recursos.situacao;
}
export function urlLogin() { return CONFIG.loginUrl; }

const PERFIS_PERMITIDOS = ['professor', 'admin', 'diretor', 'especialista', 'secretaria'];

/** Login próprio do SICEP+ com as mesmas credenciais do SIGEIA+/SIDED+. */
export async function entrar(identificador, senha) {
  const login = String(identificador || '').trim();
  if (!login || !senha) return { ok: false, erro: 'Preencha o acesso e a senha.' };

  // Login novo exige internet: offline só reabre uma sessão que já foi autenticada.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, erro: 'Sem internet. Para entrar pela primeira vez é preciso estar conectado.' };
  }

  let usuario = null;
  try {
    usuario = await nuvem.login(login, senha);
  } catch (e) {
    return { ok: false, erro: e.message };
  }

  if (!usuario) return { ok: false, erro: 'CPF/e-mail ou senha incorretos.' };

  if (usuario.role && !PERFIS_PERMITIDOS.includes(usuario.role)) {
    return { ok: false, erro: 'O SICEP+ é exclusivo para professores e gestão escolar.' };
  }

  const professor = await nuvem.resolverProfessor(usuario);
  if (!professor) {
    return { ok: false, erro: 'Acesso correto, mas não há cadastro de professor vinculado a este usuário.' };
  }

  try {
    gravarSessaoNoNavegador(usuario, professor);
  } catch (e) {
    return { ok: false, erro: 'O navegador bloqueou o armazenamento da sessão.' };
  }

  // Login novo: outro usuário no mesmo aparelho perde a cópia local; a validade recomeça agora.
  await offline.limparCacheDeOutros(usuario.id);
  await offline.gravarSessao(sessaoMinima(usuario, professor));

  const r = await iniciar();
  if (r.estado !== 'pronto') {
    return { ok: false, erro: r.erro || 'Não foi possível carregar seus dados agora.', estado: r.estado };
  }
  if (r.origem === 'cache') {
    // Login aceito pela nuvem, mas os dados vieram da cópia local: avisa em vez de fingir sincronização.
    return { ok: true, aviso: 'Entrou, mas a nuvem não respondeu: mostrando os dados salvos neste aparelho.' };
  }
  return { ok: true };
}

export async function sair() {
  const usuarioId = db.sessao?.usuario_id ?? nuvem.sessaoRemota()?.usuario_id ?? null;
  try {
    // Sair apaga a sessão e a cópia local deste usuário (aparelho pode ser compartilhado).
    await Promise.race([esquecerLocal(usuarioId), new Promise((ok) => setTimeout(ok, 3000))]);
  } finally {
    location.reload();
  }
}

/* ---------------- Consultas acadêmicas ---------------- */

export function turma(id) { return db.turmas.find((t) => t.id === id) || null; }
export function disciplina(id) { return db.disciplinas.find((d) => d.id === id) || null; }
export function professor(id) { return db.professores.find((p) => p.id === id) || null; }
export function vinculo(id) { return db.turma_disciplinas.find((v) => v.id === id) || null; }
export function aluno(id) { return db.alunos.find((a) => a.id === id) || null; }

export function turmasDoProfessor(professorId) {
  const ids = new Set(db.turma_disciplinas.filter((v) => v.professor_id === professorId).map((v) => v.turma_id));
  return db.turmas.filter((t) => ids.has(t.id));
}

export function disciplinasDaTurma(turmaId, professorId) {
  return db.turma_disciplinas
    .filter((v) => v.turma_id === turmaId && v.professor_id === professorId)
    .map((v) => ({ vinculo: v, disciplina: disciplina(v.disciplina_id), professor: professor(v.professor_id) }))
    .filter((x) => x.disciplina);
}

export function alunosDaTurma(turmaId) {
  return db.alunos
    .filter((a) => a.turma_id === turmaId)
    .sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, 'pt-BR'));
}

/* ---------------- Avaliações ---------------- */

export function avaliacoes() {
  return [...db.avaliacoes].sort((a, b) => String(b.data_aplicacao || '').localeCompare(String(a.data_aplicacao || '')));
}

export function avaliacao(id) { return db.avaliacoes.find((a) => a.id === id) || null; }
export function aplicacoes(av) { return av?.aplicacoes || []; }
export function aplicacaoDe(av, turmaId) { return (av?.aplicacoes || []).find((x) => x.turma_id === turmaId) || null; }

export function contextoAplicacao(apl) {
  if (!apl) return null;
  return {
    turma: turma(apl.turma_id),
    disciplina: disciplina(apl.disciplina_id),
    professor: professor(apl.professor_id),
  };
}

export function nomeDisciplina(av) {
  const nomes = new Set((av?.aplicacoes || []).map((x) => disciplina(x.disciplina_id)?.nome).filter(Boolean));
  return [...nomes].join(', ') || av?.disciplina || '—';
}

export async function criarAvaliacao(dados) {
  // Ids gerados aqui e guardados em `dados`: repetir a chamada com o mesmo objeto
  // reaproveita os mesmos ids e a nuvem não cria nada em dobro.
  if (!dados.id_cliente) dados.id_cliente = nuvem.novoUuid();
  dados.questoes.forEach((q) => { if (!q.id_cliente) q.id_cliente = nuvem.novoUuid(); });

  const remota = await nuvem.criarAvaliacao({
    id: dados.id_cliente,
    titulo: dados.titulo,
    descricao: dados.descricao,
    disciplina: dados.disciplina,
    valor_total: Number(dados.valor_total),
    data_aplicacao: dados.data_aplicacao,
    lancar_sided: !!dados.lancar_sided,
    turmas_ids: dados.aplicacoes.map((a) => a.turma_id),
    num_alternativas: Number(dados.num_alternativas),
    questoes: dados.questoes.map((q) => ({ ...q, id: q.id || q.id_cliente })),
    prazo_correcao: recursos.prazo ? dados.prazo_correcao : null,
    trimestre: recursos.trimestre ? (Number(dados.trimestre) || null) : null,
    faixas: recursos.faixas ? dados.faixas : null,
  }, db.sessao.usuario_id);

  const local = {
    id: remota.id,
    titulo: dados.titulo,
    descricao: dados.descricao || '',
    disciplina: dados.disciplina || '',
    valor_total: Number(dados.valor_total),
    data_aplicacao: dados.data_aplicacao,
    prazo_correcao: recursos.prazo ? dados.prazo_correcao : null,
    trimestre: recursos.trimestre ? (Number(dados.trimestre) || null) : null,
    faixas: recursos.faixas ? dados.faixas : { verde: 80, amarelo: 60 },
    modo: 'impresso',
    lancar_sided: !!dados.lancar_sided,
    status: 'pronta',
    layout: { codigo_caderno: 'SICEP-A', versao: 1, num_alternativas: Number(dados.num_alternativas) },
    criado_em: hojeISO(),
    questoes: dados.questoes.map((q, i) => ({
      id: remota.questoes?.find((x) => Number(x.numero) === Number(q.numero))?.id || q.id || q.id_cliente || null,
      numero: q.numero,
      enunciado: q.enunciado || '',
      valor: Number(q.valor),
      num_alternativas: Number(dados.num_alternativas),
      gabarito: q.gabarito,
      anulada: !!q.anulada,
    })),
    aplicacoes: dados.aplicacoes.map((a) => ({
      id: `${remota.id}:${a.turma_id}`,
      turma_id: a.turma_id,
      turma_disciplina_id: a.turma_disciplina_id,
      disciplina_id: a.disciplina_id,
      professor_id: a.professor_id,
      sided_avaliacao_id: null,
    })),
  };

  db.avaliacoes.unshift(local);
  atualizarCacheLocal();
  return local;
}

/* ---------------- Editar / excluir avaliação ---------------- */

const codigoLimpo = (codigo) => String(codigo || '').trim().slice(0, 50);

/** Cria (sem dados.id) ou atualiza (com dados.id) a avaliação. */
export async function salvarAvaliacao(dados) {
  const codigo = codigoLimpo(dados.codigo_caderno);
  const numAlternativas = Number(dados.num_alternativas);

  if (dados.id) {
    const av = avaliacao(dados.id);
    if (!av) throw new Error('Avaliação não encontrada.');

    const patch = {
      titulo: dados.titulo,
      descricao: dados.descricao || null,
      disciplina: dados.disciplina || null,
      valor_total: Number(dados.valor_total),
      data_aplicacao: dados.data_aplicacao,
      lancar_sided: !!dados.lancar_sided,
      turmas_ids: dados.aplicacoes.map((a) => a.turma_id),
      ...(recursos.prazo && dados.prazo_correcao ? { prazo_correcao: dados.prazo_correcao } : {}),
      // Depois de enviar notas, o trimestre não muda: a avaliação espelhada no SIDED+ já foi criada nele.
      ...(recursos.trimestre && dados.trimestre && !trimestreTravado(av) ? { trimestre: Number(dados.trimestre) } : {}),
      ...(recursos.faixas ? { faixa_verde: Number(dados.faixas.verde), faixa_amarela: Number(dados.faixas.amarelo) } : {}),
    };

    await nuvem.atualizarAvaliacao(dados.id, patch, dados.questoes, numAlternativas);
    if (codigo) {
      await nuvem.salvarLayoutCaderno({
        avaliacaoId: dados.id,
        professorId: db.sessao.professor_id,
        escolaId: db.sessao.escola_id,
        codigo,
        qtdQuestoes: dados.questoes.length,
        qtdAlternativas: numAlternativas,
      });
    }
    await iniciar();
    return dados.id;
  }

  const local = await criarAvaliacao(dados);
  if (codigo) {
    await nuvem.salvarLayoutCaderno({
      avaliacaoId: local.id,
      professorId: db.sessao.professor_id,
      escolaId: db.sessao.escola_id,
      codigo,
      qtdQuestoes: dados.questoes.length,
      qtdAlternativas: numAlternativas,
    });
    await iniciar();
  }
  return local.id;
}

/** Remove a avaliação e tudo que depende dela (resultados e questões). */
export async function excluirAvaliacao(id) {
  const av = avaliacao(id);
  if (!av) return { ok: false, erro: 'Avaliação não encontrada.' };

  const resultados = resultadosDaAvaliacao(id).length;
  try {
    await nuvem.excluirAvaliacao(id);
  } catch (e) {
    return { ok: false, erro: 'Falha ao excluir: ' + e.message };
  }

  db.avaliacoes = db.avaliacoes.filter((a) => a.id !== id);
  db.resultados = db.resultados.filter((r) => r.avaliacao_id !== id);
  atualizarCacheLocal();
  return { ok: true, resultados };
}

export function gabaritoDe(av) {
  const mapa = {};
  (av?.questoes || []).forEach((q) => { mapa[q.numero] = q.gabarito; });
  return mapa;
}

/* ---------------- Correção ---------------- */

export function valorTotalEfetivo(av) {
  return arred((av?.questoes || []).reduce((s, q) => s + (q.anulada ? 0 : Number(q.valor || 0)), 0));
}

/** Questões anuladas são creditadas a todos os alunos. */
export function calcularCorrecao(av, respostas) {
  let acertos = 0;
  let erros = 0;
  let anuladas = 0;
  let pontos = 0;

  (av?.questoes || []).forEach((q) => {
    const valor = Number(q.valor || 0);
    if (q.anulada) { anuladas += 1; pontos += valor; return; }
    if (respostas && respostas[q.numero] === q.gabarito) { acertos += 1; pontos += valor; }
    else erros += 1;
  });

  const base = Number(av?.valor_total || 0) || valorTotalEfetivo(av);
  return {
    acertos, erros, anuladas,
    nota: arred(pontos),
    percentual: base > 0 ? Math.round((pontos / base) * 1000) / 10 : 0,
    total: base,
  };
}

export function faixaDe(av, percentual) {
  const faixas = av?.faixas || { verde: 80, amarelo: 60 };
  if (percentual >= faixas.verde) return 'verde';
  if (percentual >= faixas.amarelo) return 'amarelo';
  return 'vermelho';
}

/* ---------------- Prazo ---------------- */

export function prazoDe(av) {
  if (!av?.prazo_correcao) return { status: 'sem', texto: recursos.prazo ? 'Sem prazo definido' : 'Prazo indisponível' };
  const fim = new Date(av.prazo_correcao);
  if (Number.isNaN(fim.getTime())) return { status: 'sem', texto: 'Sem prazo definido' };
  const agora = new Date();
  const texto = fim.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  if (agora > fim) return { status: 'atrasado', texto };
  if (fim.toDateString() === agora.toDateString()) return { status: 'hoje', texto };
  return { status: 'ok', texto };
}

/* ---------------- Resultados ---------------- */

export function resultados() {
  return [...db.resultados].sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
}

export function resultadosDaAvaliacao(avaliacaoId, turmaId = null) {
  return db.resultados.filter((r) => r.avaliacao_id === avaliacaoId && (!turmaId || r.turma_id === turmaId));
}

export function resultadoDoAluno(avaliacaoId, alunoId, turmaId = null) {
  return db.resultados.find(
    (r) => r.avaliacao_id === avaliacaoId && r.aluno_id === alunoId && (!turmaId || r.turma_id === turmaId)
  ) || null;
}

export function progresso(av, turmaId) {
  const total = alunosDaTurma(turmaId).length;
  const feitos = resultadosDaAvaliacao(av.id, turmaId);
  return {
    total,
    registrados: feitos.length,
    confirmados: feitos.filter((r) => r.status === 'confirmado').length,
  };
}

export async function salvarResultado({
  avaliacao: av, aplicacao: apl, alunoId, respostas = {},
  confianca = null, situacao = 'normal', imagemRef = null, observacao = '', revisado = false,
  substituir = false, resultadoId = null,
}) {
  if (!av || !apl) return { ok: false, erro: 'Avaliação ou turma não identificada.' };
  if (!situacaoSuportada(situacao)) {
    return { ok: false, erro: 'Esta situação exige uma coluna que ainda não existe em sicep_resultados.' };
  }

  const existente = resultadoDoAluno(av.id, alunoId, apl.turma_id);
  // Releitura explícita (vinda de Resultados) pode substituir uma nota confirmada;
  // a nova leitura volta para revisão e só é reenviada depois da sua confirmação.
  if (existente && existente.status === 'confirmado' && !substituir) {
    return { ok: false, erro: 'Já existe resultado confirmado para este aluno nesta avaliação.' };
  }

  const cfg = SITUACOES[situacao] || SITUACOES.normal;
  const calc = calcularCorrecao(av, respostas);
  const nota = cfg.notaZero ? 0 : cfg.geraNota ? calc.nota : null;
  const percentual = cfg.notaZero ? 0 : cfg.geraNota ? calc.percentual : 0;
  const status = cfg.revisao || !revisado ? 'revisao' : 'confirmado';

  const payload = {
    avaliacao_id: av.id,
    aluno_id: alunoId,
    turma_id: apl.turma_id,
    nota,
    respostas,
    ausente: situacao === 'ausente',
    registrado_por: db.sessao.usuario_id,
  };
  if (recursos.situacao) payload.situacao = situacao;
  if (recursos.turma_disciplina) payload.turma_disciplina_id = apl.turma_disciplina_id;
  if (recursos.status || recursos.situacao) payload.status = status;
  if (recursos.revisado) payload.revisado_em = status === 'confirmado' ? new Date().toISOString() : null;

  // O id nasce aqui, no aparelho, e acompanha o resultado até o servidor (6C):
  // reenviar a mesma operação atualiza a mesma linha, nunca cria outra.
  const id = existente?.id || resultadoId || nuvem.novoUuid();
  const usuarioId = db.sessao.usuario_id;

  const local = {
    id,
    avaliacao_id: av.id,
    aplicacao_id: apl.id,
    turma_id: apl.turma_id,
    turma_disciplina_id: apl.turma_disciplina_id,
    disciplina_id: apl.disciplina_id,
    aluno_id: alunoId,
    respostas,
    nota,
    acertos: calc.acertos,
    erros: calc.erros,
    anuladas: calc.anuladas,
    percentual,
    confianca,
    situacao,
    status: recursos.status || recursos.situacao ? status : 'confirmado',
    revisado_em: recursos.revisado && status === 'confirmado' ? new Date().toISOString() : null,
    // Gravar/sincronizar nunca mexe no envio ao SIDED+: o que já foi enviado continua marcado.
    enviado_em: existente?.enviado_em || null,
    origem: 'leitura',
    criado_em: existente?.criado_em || hojeISO(),
    registrado_por: usuarioId,
    observacao,
  };
  const aviso = !recursos.status && !recursos.situacao
    ? 'Nota gravada. O campo de status de revisão ainda não existe no banco.'
    : null;
  const anterior = existente ? { ...existente } : null;

  const aplicarNaMemoria = (linha) => {
    const atual = db.resultados.find((x) => x.id === id);
    if (atual) Object.assign(atual, linha);
    else db.resultados.unshift({ ...linha });
  };
  const desfazerNaMemoria = () => {
    if (anterior) { const atual = db.resultados.find((x) => x.id === id); if (atual) Object.assign(atual, anterior); }
    else db.resultados = db.resultados.filter((x) => x.id !== id);
  };
  const erroDaNuvem = (e) => (e?.codigo === 'RESULTADO_DUPLICADO'
    ? 'Já existe um resultado deste aluno nesta avaliação (gravado em outro momento ou aparelho). Recarregue os dados para vê-lo.'
    : 'Falha ao gravar na nuvem: ' + (e?.message || e));

  // 1) Grava na fila local (IndexedDB) ANTES de qualquer rede: a partir daqui o resultado não se perde.
  const item = await filaSync.enfileirar(usuarioId, {
    resultado_id: id,
    chave_alvo: `${av.id}|${alunoId}|${apl.turma_id}`,
    payload,
    imagem_ref: imagemRef,
    confianca,
    local,
  });

  // Plano B: navegador sem IndexedDB. Só funciona online, como antes da 6D.
  if (!item) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: false, erro: 'Sem internet e este navegador não permite guardar o resultado no aparelho. Nada foi salvo.' };
    }
    try {
      await nuvem.gravarResultadoIdempotente({ ...payload, id });
      if (imagemRef) await nuvem.registrarScan({ resultado_id: id, imagem_url: imagemRef, respostas_detectadas: respostas, confianca });
    } catch (e) {
      return { ok: false, erro: erroDaNuvem(e) };
    }
    aplicarNaMemoria({ ...local, sync: 'sincronizado' });
    atualizarCacheLocal();
    return { ok: true, resultado: db.resultados.find((x) => x.id === id), aviso };
  }

  // 2) Mostra na tela como "aguardando envio". O servidor ainda não confirmou.
  aplicarNaMemoria({ ...local, sync: 'pendente' });
  await atualizarEstadoDaFila();

  // 3) Tenta enviar agora (sem internet, não faz nada). Não deixa a tela esperando uma rede lenta.
  await esperarNoMaximo(sincronizarFila(), ESPERA_MAX_SALVAR_MS);
  const atual = (await filaSync.listar(usuarioId)).find((i) => i.seq === item.seq);

  if (atual?.status === 'sincronizado') {
    return { ok: true, resultado: db.resultados.find((x) => x.id === id), aviso };
  }

  // A nuvem RECUSOU este resultado (ex.: já existe outro do mesmo aluno): como antes da 6D,
  // quem salvou na hora vê o erro e nada fica gravado. O formulário continua à mão para corrigir.
  if (atual?.status === 'erro' && atual.permanente) {
    await filaSync.descartar(item.seq);
    desfazerNaMemoria();
    await atualizarEstadoDaFila();
    return { ok: false, erro: atual.codigo_erro === 'RESULTADO_DUPLICADO' ? erroDaNuvem({ codigo: 'RESULTADO_DUPLICADO' }) : `Falha ao gravar na nuvem: ${atual.erro || 'recusado.'}` };
  }

  // Sem internet, rede instável ou envio ainda em curso: o resultado está salvo no aparelho e segue na fila.
  const offlineAgora = typeof navigator !== 'undefined' && navigator.onLine === false;
  return {
    ok: true,
    pendente: true,
    resultado: db.resultados.find((x) => x.id === id),
    mensagem: offlineAgora
      ? 'Sem internet: resultado salvo neste aparelho. Será enviado quando a conexão voltar.'
      : 'Resultado salvo neste aparelho. O envio à nuvem será refeito automaticamente.',
    aviso,
  };
}

export async function registrarSituacao({ avaliacao: av, aplicacao: apl, alunoId, situacao, observacao = '' }) {
  return salvarResultado({
    avaliacao: av, aplicacao: apl, alunoId,
    respostas: {}, situacao, observacao, revisado: true, confianca: 1,
  });
}

const MSG_AGUARDANDO_ENVIO = 'Este resultado ainda não chegou à nuvem (aguardando sincronização). Espere o envio terminar para continuar.';
const aguardandoEnvio = (r) => Boolean(r?.sync) && r.sync !== 'sincronizado';

export async function confirmarResultado(id) {
  const r = db.resultados.find((x) => x.id === id);
  if (!r) return { ok: false, erro: 'Resultado não encontrado.' };
  if (aguardandoEnvio(r)) return { ok: false, erro: MSG_AGUARDANDO_ENVIO };

  if (!recursos.status && !recursos.situacao) {
    return { ok: false, erro: 'A coluna de status de revisão ainda não existe em sicep_resultados; nada foi alterado.' };
  }

  const agora = new Date().toISOString();
  const patch = { status: 'confirmado' };
  if (recursos.revisado) patch.revisado_em = agora;

  try {
    await nuvem.api(`sicep_resultados?id=eq.${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  } catch (e) {
    return { ok: false, erro: 'Falha ao confirmar: ' + e.message };
  }
  r.status = 'confirmado';
  if (recursos.revisado) r.revisado_em = agora;
  atualizarCacheLocal();
  return { ok: true };
}

/**
 * Exclui somente o resultado do SICEP+. A nota já enviada ao SIDED+ não é
 * apagada por aqui: notas do SIDED+ podem ter sido editadas pelo professor.
 */
export async function excluirResultado(id) {
  const r = db.resultados.find((x) => x.id === id);
  if (!r) return { ok: false, erro: 'Resultado não encontrado.' };
  if (aguardandoEnvio(r)) return { ok: false, erro: MSG_AGUARDANDO_ENVIO };

  try {
    await nuvem.api(`sicep_resultados?id=eq.${r.id}`, { method: 'DELETE' });
  } catch (e) {
    return { ok: false, erro: 'Falha ao excluir: ' + e.message };
  }

  // Scans vinculados são opcionais: se a tabela não existir, a exclusão já valeu.
  try {
    await nuvem.api(`sicep_ocr_scans?resultado_id=eq.${r.id}`, { method: 'DELETE' });
  } catch (e) { /* tabela opcional */ }

  db.resultados = db.resultados.filter((x) => x.id !== r.id);
  atualizarCacheLocal();
  return { ok: true, enviado: Boolean(r.enviado_em) };
}

export function resumo() {
  const confirmados = db.resultados.filter((r) => r.status === 'confirmado' && r.nota != null && r.situacao === 'normal');
  const pendentes = db.resultados.filter((r) => r.status !== 'confirmado');
  const media = confirmados.length
    ? arred(confirmados.reduce((s, r) => s + Number(r.nota || 0), 0) / confirmados.length)
    : 0;
  return { total: db.resultados.length, confirmados: confirmados.length, pendentes: pendentes.length, media };
}

/* ---------------- SIDED+ ---------------- */

/** Trimestre não muda depois que alguma nota da avaliação foi enviada ao SIDED+. */
export function trimestreTravado(av) {
  return !!av && db.resultados.some((r) => r.avaliacao_id === av.id && r.enviado_em);
}

/** Define/corrige o trimestre de uma avaliação (usado nas avaliações antigas sem trimestre). */
export async function definirTrimestre(avaliacaoId, trimestre) {
  const av = avaliacao(avaliacaoId);
  const tri = Number(trimestre);
  if (!av) return { ok: false, erro: 'Avaliação não encontrada.' };
  if (![1, 2, 3].includes(tri)) return { ok: false, erro: 'Escolha o 1º, 2º ou 3º trimestre.' };
  if (!recursos.trimestre) {
    return { ok: false, erro: 'A coluna trimestre ainda não existe em sicep_avaliacoes. Execute a migração SQL antes.' };
  }
  if (trimestreTravado(av)) {
    return { ok: false, erro: 'Já há notas enviadas ao SIDED+ desta avaliação; o trimestre não pode mais ser alterado aqui.' };
  }
  try {
    await nuvem.api(`sicep_avaliacoes?id=eq.${av.id}`, { method: 'PATCH', body: JSON.stringify({ trimestre: tri }) });
  } catch (e) {
    return { ok: false, erro: 'Falha ao salvar o trimestre: ' + e.message };
  }
  av.trimestre = tri;
  atualizarCacheLocal();
  return { ok: true };
}

/** Resultados prontos para envio: revisados, confirmados, com nota e AINDA NÃO enviados. */
export function pendentesDeEnvio(avaliacaoId, turmaId) {
  const idsAlunos = new Set(db.alunos.filter((a) => a.turma_id === turmaId).map((a) => a.id));
  return resultadosDaAvaliacao(avaliacaoId, turmaId)
    // Resultado ainda na fila de sincronização não existe na nuvem: não vai ao SIDED+ antes disso.
    .filter((r) => r.status === 'confirmado' && r.nota != null && !r.enviado_em && idsAlunos.has(r.aluno_id) && !aguardandoEnvio(r));
}

export function jaEnviados(avaliacaoId, turmaId) {
  return resultadosDaAvaliacao(avaliacaoId, turmaId).filter((r) => r.enviado_em);
}

/**
 * Envia ao SIDED+ as notas revisadas e ainda não enviadas de uma avaliação em uma turma.
 * O trimestre vem da própria avaliação (definido na criação). `resultadoIds` restringe o envio
 * (usado para tentar de novo só o que falhou).
 *
 * Retorna { ok, enviados, falhas: [{ resultado_id, aluno_id, erro }], aviso }.
 * Falha parcial não desfaz o que já foi enviado: cada nota enviada é marcada na hora.
 */
export async function enviarAoSided(avaliacaoId, turmaId, resultadoIds = null) {
  const av = avaliacao(avaliacaoId);
  const apl = aplicacaoDe(av, turmaId);
  if (!av || !apl) return { ok: false, erro: 'Avaliação/turma não encontrada.' };
  if (!av.lancar_sided) return { ok: false, erro: 'Esta avaliação não está marcada para lançar no SIDED+.' };
  if (![1, 2, 3].includes(Number(av.trimestre))) {
    return { ok: false, erro: 'Esta avaliação não tem trimestre definido. Defina o trimestre antes de enviar.' };
  }
  // Notas só vão ao SIDED+ com conexão: sem internet nada é enviado nem marcado como enviado.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, erro: 'Sem conexão com a internet. O envio ao SIDED+ só é feito online.' };
  }

  const pedidos = resultadoIds ? new Set(resultadoIds) : null;
  const lista = pendentesDeEnvio(av.id, turmaId).filter((r) => !pedidos || pedidos.has(r.id));
  if (!lista.length) return { ok: false, erro: 'Nenhuma nota revisada, confirmada e ainda não enviada.' };

  const base = () => ({
    avaliacaoSicep: { ...av, sided_avaliacao_id: av.sided_avaliacao_id || apl.sided_avaliacao_id },
    turma: turma(turmaId),
    turmaDisciplinaId: apl.turma_disciplina_id,
    professorId: apl.professor_id,
    trimestre: Number(av.trimestre),
  });
  const itemDe = (x) => ({ aluno_id: x.aluno_id, nota: x.nota, situacao: x.situacao });
  const MSG_CONFLITO = 'Já existe no SIDED+ uma nota diferente para este aluno. Ela não foi sobrescrita; confira no SIDED+.';

  const enviadosIds = [];
  const falhas = [];
  let ultimoSided = null;

  // Caminho rápido: um único envio. Se ele falhar por inteiro, cai para um aluno por vez
  // para saber exatamente quem não foi.
  let r = null;
  try {
    r = await nuvem.enviarNotasSided({ ...base(), items: lista.map(itemDe) });
  } catch (e) {
    r = null;
  }

  if (r) {
    ultimoSided = r.sided_avaliacao_id;
    const ok = new Set(r.enviadosAlunos);
    lista.forEach((x) => {
      if (ok.has(x.aluno_id)) enviadosIds.push(x.id);
      else if (r.conflitos.includes(x.aluno_id)) falhas.push({ resultado_id: x.id, aluno_id: x.aluno_id, erro: MSG_CONFLITO });
      else falhas.push({ resultado_id: x.id, aluno_id: x.aluno_id, erro: 'Não foi gravada no SIDED+.' });
    });
  } else {
    for (const x of lista) {
      try {
        const um = await nuvem.enviarNotasSided({
          ...base(),
          avaliacaoSicep: { ...base().avaliacaoSicep, sided_avaliacao_id: ultimoSided || base().avaliacaoSicep.sided_avaliacao_id },
          items: [itemDe(x)],
        });
        ultimoSided = um.sided_avaliacao_id;
        if (um.enviadosAlunos.includes(x.aluno_id)) enviadosIds.push(x.id);
        else falhas.push({ resultado_id: x.id, aluno_id: x.aluno_id, erro: um.conflitos.includes(x.aluno_id) ? MSG_CONFLITO : 'Não foi gravada no SIDED+.' });
      } catch (e) {
        falhas.push({ resultado_id: x.id, aluno_id: x.aluno_id, erro: e.message || 'Falha ao enviar.' });
        if (!navigator.onLine) {
          // Sem internet: não adianta tentar os demais um a um.
          lista.slice(lista.indexOf(x) + 1).forEach((y) => falhas.push({ resultado_id: y.id, aluno_id: y.aluno_id, erro: 'Sem conexão.' }));
          break;
        }
      }
    }
  }

  let aviso = null;
  if (enviadosIds.length) {
    const agora = new Date().toISOString();
    const enviados = lista.filter((x) => enviadosIds.includes(x.id));
    enviados.forEach((x) => { x.enviado_em = agora; });
    if (recursos.enviado) {
      try {
        await nuvem.api(`sicep_resultados?id=in.(${enviadosIds.join(',')})`, {
          method: 'PATCH',
          body: JSON.stringify({ enviado_sided_em: agora }),
        });
      } catch (e) {
        console.warn('[SICEP+] enviado_sided_em:', e.message);
        aviso = 'As notas foram gravadas no SIDED+, mas não consegui registrar o envio no SICEP+. Ao recarregar elas podem voltar como pendentes; reenviar é seguro (não duplica).';
      }
    } else {
      aviso = 'As notas foram gravadas no SIDED+, mas o banco ainda não tem a coluna enviado_sided_em: o estado de envio não fica salvo depois de recarregar.';
    }
    apl.sided_avaliacao_id = ultimoSided;
    const alvoAv = db.avaliacoes.find((x) => x.id === av.id);
    // Instrumento com várias turmas tem UMA avaliação por turma no SIDED+.
    // Um id único no instrumento apontaria todas as turmas para a mesma avaliação.
    if (alvoAv && (alvoAv.turmas_ids || []).length <= 1) alvoAv.sided_avaliacao_id = ultimoSided;
  }

  if (enviadosIds.length) atualizarCacheLocal();
  return { ok: falhas.length === 0, enviados: enviadosIds.length, falhas, aviso };
}

/* ---------------- Sincronização ---------------- */

export function fila() { return [...db.fila]; }
export function erros() { return [...db.erros]; }

const zeroFila = () => ({ pendente: 0, sincronizando: 0, sincronizado: 0, erro: 0, aberto: 0, total: 0 });

function notificarFila() {
  ouvintesFila.forEach((f) => { try { f(); } catch (e) { /* ignora */ } });
}

/** Chama `fn` quando o estado da sincronização muda (chip, painel). Devolve a função que cancela. */
export function aoMudarSincronizacao(fn) {
  ouvintesFila.add(fn);
  return () => ouvintesFila.delete(fn);
}

/** Quantos resultados ainda não chegaram à nuvem (pendentes, enviando ou com erro). */
export function totalNaFilaDeEnvio() { return contagemFila.aberto; }
export function contagemDaFila() { return { ...contagemFila }; }
export function estaSincronizando() { return sincronizando; }

/**
 * Relê a fila e acerta, na memória, a marca `sync` de cada resultado:
 * item em aberto → status do item; sem item em aberto → 'sincronizado' (ou sem marca).
 */
async function atualizarEstadoDaFila() {
  const uid = db.sessao?.usuario_id;
  if (uid == null) { contagemFila = zeroFila(); notificarFila(); return; }

  const itens = await filaSync.listar(uid);
  const c = zeroFila();
  itens.forEach((i) => { c[i.status] = (c[i.status] || 0) + 1; c.total += 1; });
  c.aberto = c.pendente + c.sincronizando + c.erro;
  contagemFila = c;

  const emAberto = new Map(); // itens vêm em ordem de seq: o último de cada resultado vale
  const feitos = new Set();
  itens.forEach((i) => {
    if (i.status === 'sincronizado') feitos.add(i.resultado_id);
    else emAberto.set(i.resultado_id, i.status);
  });
  db.resultados.forEach((r) => {
    if (emAberto.has(r.id)) r.sync = emAberto.get(r.id);
    else if (r.sync) r.sync = feitos.has(r.id) ? 'sincronizado' : undefined;
  });
  notificarFila();
}

/**
 * Ao abrir (da nuvem ou da cópia local), recoloca na lista os resultados que ainda estão na fila.
 * É assim que um resultado salvo offline continua na tela depois de fechar e reabrir o app.
 * Se a nuvem já tem OUTRO resultado do mesmo aluno/avaliação, mostra o da nuvem; o item da fila
 * fica guardado e, ao ser enviado, é barrado como duplicado (sem criar o segundo).
 */
async function aplicarFilaNoEstado() {
  const uid = db.sessao?.usuario_id;
  if (uid == null) return;
  try {
    const itens = (await filaSync.listar(uid)).filter((i) => i.status !== 'sincronizado');
    itens.forEach((it) => {
      const l = it.local;
      if (!l) return;
      const mesmaChave = (r) => r.avaliacao_id === l.avaliacao_id && r.aluno_id === l.aluno_id && r.turma_id === l.turma_id;
      const propria = db.resultados.find((r) => r.id === it.resultado_id);
      const outra = db.resultados.find((r) => r.id !== it.resultado_id && mesmaChave(r) && !r.sync);
      if (!propria && outra) return;
      const linha = { ...l, enviado_em: propria?.enviado_em ?? l.enviado_em ?? null, sync: it.status };
      if (propria) Object.assign(propria, linha);
      else db.resultados.unshift(linha);
    });
    await atualizarEstadoDaFila();
  } catch (e) {
    console.warn('[SICEP+] fila ao abrir:', e);
  }
}

/** Chamado pela fila SÓ depois que o servidor confirmou a gravação de um item. */
async function aoConfirmarNoServidor(item, linha) {
  const r = db.resultados.find((x) => x.id === item.resultado_id);
  if (r && linha?.created_at) r.criado_em = linha.created_at;
  await atualizarEstadoDaFila();   // marca 'sincronizado' (ou mantém pendente se há operação mais nova)

  // A cópia local só passa a incluir o resultado AGORA, com o servidor já tendo confirmado.
  // Grava a linha direto: vale também quando o app foi aberto offline (dados vindos da cópia local).
  if (r && r.sync === 'sincronizado' && db.sessao) {
    const { sync, ...confirmada } = r;
    await offline.gravar('resultados', db.sessao.usuario_id, r.id, confirmada);
  }
  atualizarCacheLocal();
}

let temporizadorRetentativa = null;
let falhasSeguidas = 0;

function agendarNovaTentativa(r) {
  clearTimeout(temporizadorRetentativa);
  temporizadorRetentativa = null;
  if (r?.parou === 'rede' && !(typeof navigator !== 'undefined' && navigator.onLine === false)) {
    // A internet "voltou" mas a nuvem ainda não responde: tenta de novo com espera crescente (5s … 60s).
    const espera = Math.min(60000, 5000 * 2 ** falhasSeguidas);
    falhasSeguidas += 1;
    temporizadorRetentativa = setTimeout(() => { sincronizarFila(); }, espera);
  } else if (r?.rodou && !r.parou) {
    falhasSeguidas = 0;
  }
}

/**
 * Envia a fila ao Supabase (uma sincronização por vez, na ordem). Sem internet não faz nada.
 * Chamada ao abrir o app, no evento `online`, ao salvar um resultado e pelo botão "Tentar agora".
 */
export async function sincronizarFila() {
  const uid = db.sessao?.usuario_id;
  if (uid == null || estado !== 'pronto') return null;
  sincronizando = true;
  notificarFila();
  let r = null;
  try {
    r = await filaSync.processar(uid, { aoSincronizar: aoConfirmarNoServidor });
  } finally {
    sincronizando = false;
  }
  await atualizarEstadoDaFila();
  agendarNovaTentativa(r);
  return r;
}

/** Botão "Tentar agora": libera itens com erro (inclusive os recusados) e envia de novo. */
export async function tentarSincronizarAgora() {
  const uid = db.sessao?.usuario_id;
  if (uid == null) return null;
  await filaSync.liberarParaNovaTentativa(uid);
  await atualizarEstadoDaFila();
  let r = await sincronizarFila();
  // Se já havia uma sincronização em curso, ela pode ter terminado antes de ver os itens liberados.
  if (r && (await filaSync.contar(uid)).pendente) r = await sincronizarFila();
  return r;
}

let sincronizacaoAtiva = false;

/** Liga a sincronização automática (uma vez) e já processa a fila: é o "ao abrir o aplicativo". */
export function ativarSincronizacao() {
  if (!sincronizacaoAtiva && typeof window !== 'undefined') {
    sincronizacaoAtiva = true;
    window.addEventListener('online', () => { falhasSeguidas = 0; notificarFila(); sincronizarFila(); });
    window.addEventListener('offline', () => notificarFila());
    filaSync.aoMudar(() => { atualizarEstadoDaFila(); }); // mudanças feitas por outra aba
  }
  return sincronizarFila();
}

/** Itens da fila ainda não enviados, para o painel (com nomes para leitura humana). */
export async function itensDaFila() {
  const uid = db.sessao?.usuario_id;
  if (uid == null) return [];
  const itens = await filaSync.listar(uid);
  return itens
    .filter((i) => i.status !== 'sincronizado')
    .map((i) => ({
      seq: i.seq,
      status: i.status,
      tentativas: i.tentativas || 0,
      erro: i.erro || null,
      permanente: Boolean(i.permanente),
      criado_em: i.criado_em,
      aluno: aluno(i.local?.aluno_id)?.nome_completo || '—',
      avaliacao: avaliacao(i.local?.avaliacao_id)?.titulo || '—',
      turma: turma(i.local?.turma_id)?.nome || '',
    }));
}

/** Descarta um item (ação explícita do usuário) e recarrega a lista a partir da nuvem/cópia local. */
export async function descartarItemDaFila(seq) {
  const ok = await filaSync.descartar(seq);
  if (ok) await iniciar();
  return ok;
}

export function estadoSincronizacao() {
  if (estado !== 'pronto') return { classe: 'offline', texto: 'Offline', abertos: 0 };
  const c = contagemFila;
  const abertos = c.aberto;
  if (!navigator.onLine) return { classe: 'offline', texto: abertos ? `Offline · ${abertos} a enviar` : 'Offline', abertos };
  if (sincronizando && abertos) return { classe: 'pendente', texto: `Enviando ${abertos}…`, abertos };
  if (c.erro) return { classe: 'pendente', texto: `${abertos} a enviar · ${c.erro} com erro`, abertos };
  if (abertos) return { classe: 'pendente', texto: `${abertos} a enviar`, abertos };
  if (origem === 'cache') return { classe: 'offline', texto: 'Dados salvos', abertos };
  return { classe: '', texto: 'Sincronizado', abertos };
}

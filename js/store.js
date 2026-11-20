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

// Precisão de nota: até 10 casas decimais (0,25 não vira 0,3).
const arred = (n) => Math.round((Number(n) || 0) * 1e10) / 1e10;
const hojeISO = () => new Date().toISOString().slice(0, 10);

/* ---------------- Inicialização ---------------- */

export async function iniciar() {
  // Remove qualquer resíduo de demonstração de versões anteriores.
  try { localStorage.removeItem(CHAVE_DEMO_ANTIGA); } catch (e) { /* ignora */ }

  if (!configurado()) {
    estado = 'sem-config';
    return { estado, erro: null };
  }

  const remota = nuvem.sessaoRemota();
  if (!remota) {
    estado = 'sem-sessao';
    return { estado, erro: null };
  }

  estado = 'carregando';
  try {
    recursos = await nuvem.detectarRecursos();
    const ctx = await nuvem.carregarContexto();
    const [avs, ress] = await Promise.all([
      nuvem.carregarAvaliacoes(remota.usuario_id, recursos),
      nuvem.carregarResultados(remota.usuario_id),
    ]);
    db = montar(ctx, avs, ress);
    estado = 'pronto';
    erro = null;
    return { estado, erro: null, recursos };
  } catch (e) {
    console.error('[SICEP+] Falha ao carregar dados reais:', e);
    estado = 'erro';
    erro = e.message;
    db = vazio();
    return { estado, erro: e.message };
  }
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
    sessionStorage.setItem('ded_user', JSON.stringify(usuario));
    sessionStorage.setItem('prof_data', JSON.stringify(professor));
  } catch (e) {
    return { ok: false, erro: 'O navegador bloqueou o armazenamento da sessão.' };
  }

  const r = await iniciar();
  if (r.estado !== 'pronto') {
    return { ok: false, erro: r.erro || 'Não foi possível carregar seus dados agora.', estado: r.estado };
  }
  return { ok: true };
}

export function sair() {
  try {
    sessionStorage.removeItem('ded_user');
    sessionStorage.removeItem('prof_data');
  } catch (e) { /* ignora */ }
  location.reload();
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
  const remota = await nuvem.criarAvaliacao({
    titulo: dados.titulo,
    descricao: dados.descricao,
    disciplina: dados.disciplina,
    valor_total: Number(dados.valor_total),
    data_aplicacao: dados.data_aplicacao,
    lancar_sided: !!dados.lancar_sided,
    turmas_ids: dados.aplicacoes.map((a) => a.turma_id),
    num_alternativas: Number(dados.num_alternativas),
    questoes: dados.questoes,
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
    questoes: dados.questoes.map((q) => ({
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
  substituir = false,
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

  let id = existente?.id || null;
  try {
    if (existente) {
      await nuvem.api(`sicep_resultados?id=eq.${existente.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      const criado = await nuvem.salvarResultado(payload);
      id = criado.id;
    }
    if (imagemRef) {
      await nuvem.registrarScan({
        resultado_id: id,
        imagem_url: imagemRef,
        respostas_detectadas: respostas,
        confianca,
      });
    }
  } catch (e) {
    return { ok: false, erro: 'Falha ao gravar na nuvem: ' + e.message };
  }

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
    enviado_em: existente?.enviado_em || null,
    origem: 'leitura',
    criado_em: existente?.criado_em || hojeISO(),
    registrado_por: db.sessao.usuario_id,
    observacao,
  };

  if (existente) Object.assign(existente, local);
  else db.resultados.unshift(local);

  return {
    ok: true,
    resultado: local,
    aviso: !recursos.status && !recursos.situacao
      ? 'Nota gravada. O campo de status de revisão ainda não existe no banco.'
      : null,
  };
}

export async function registrarSituacao({ avaliacao: av, aplicacao: apl, alunoId, situacao, observacao = '' }) {
  return salvarResultado({
    avaliacao: av, aplicacao: apl, alunoId,
    respostas: {}, situacao, observacao, revisado: true, confianca: 1,
  });
}

export async function confirmarResultado(id) {
  const r = db.resultados.find((x) => x.id === id);
  if (!r) return { ok: false, erro: 'Resultado não encontrado.' };

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
  return { ok: true };
}

/**
 * Exclui somente o resultado do SICEP+. A nota já enviada ao SIDED+ não é
 * apagada por aqui: notas do SIDED+ podem ter sido editadas pelo professor.
 */
export async function excluirResultado(id) {
  const r = db.resultados.find((x) => x.id === id);
  if (!r) return { ok: false, erro: 'Resultado não encontrado.' };

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
  return { ok: true };
}

/** Resultados prontos para envio: revisados, confirmados, com nota e AINDA NÃO enviados. */
export function pendentesDeEnvio(avaliacaoId, turmaId) {
  const idsAlunos = new Set(db.alunos.filter((a) => a.turma_id === turmaId).map((a) => a.id));
  return resultadosDaAvaliacao(avaliacaoId, turmaId)
    .filter((r) => r.status === 'confirmado' && r.nota != null && !r.enviado_em && idsAlunos.has(r.aluno_id));
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

  return { ok: falhas.length === 0, enviados: enviadosIds.length, falhas, aviso };
}

/* ---------------- Sincronização ---------------- */

export function fila() { return [...db.fila]; }
export function erros() { return [...db.erros]; }

export function estadoSincronizacao() {
  if (estado !== 'pronto') return { classe: 'offline', texto: 'Offline' };
  if (!navigator.onLine) return { classe: 'offline', texto: 'Offline' };
  return { classe: '', texto: 'Sincronizado' };
}

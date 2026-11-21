/* ============================================================
   SICEP+ · Cliente Supabase (REST/PostgREST)
   ------------------------------------------------------------
   Mesmo padrão usado pelo SIDED+ (api(path, options)).

   Mapeamento conferido no banco real:
   - sicep_avaliacoes.professor_id  -> users(id)
   - turma_disciplinas.professor_id -> professores(id)
   - turmas / alunos / notas / avaliacoes conforme schema público
   ============================================================ */

import { CONFIG, configurado } from './config.js';

const cabecalhosBase = () => ({
  apikey: CONFIG.supabaseAnonKey,
  Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
  'Content-Type': 'application/json',
});

function url(path) {
  return `${CONFIG.supabaseUrl.replace(/\/+$/, '')}/rest/v1/${path}`;
}

async function api(path, opcoes = {}) {
  const res = await fetch(url(path), {
    ...opcoes,
    headers: { ...cabecalhosBase(), ...(opcoes.headers || {}) },
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => '');
    const erro = new Error(`${res.status} ${texto.slice(0, 240)}`.trim());
    erro.status = res.status;
    throw erro;
  }
  const tipo = res.headers.get('content-type') || '';
  if (!tipo.includes('json')) return null;
  const corpo = await res.json();
  return corpo;
}

/* ---------------- Autenticação (mesmas credenciais do SIGEIA+/SIDED+) ----------------
   O SIDED+ autentica pela função buscar_usuario_login(login, senha), que aceita
   login, e-mail ou CPF. O SICEP+ usa exatamente a mesma função e a mesma tabela
   users — não existe cadastro nem senha própria do SICEP+.
   ------------------------------------------------------------------------------ */

export async function login(identificador, senha) {
  const res = await fetch(`${CONFIG.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/buscar_usuario_login`, {
    method: 'POST',
    headers: cabecalhosBase(),
    body: JSON.stringify({ p_login: identificador, p_senha: senha }),
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => '');
    throw new Error(`Servidor de acesso indisponível (${res.status}). ${texto.slice(0, 120)}`.trim());
  }
  const dados = await res.json().catch(() => []);
  if (!Array.isArray(dados) || !dados.length) return null;
  return dados[0];
}

/**
 * O SIDED+ guarda o professor em sessionStorage.prof_data.
 * O SICEP+ resolve o mesmo vínculo a partir do usuário autenticado:
 * users.login / users.cpf / users.nome -> professores.id_login / cpf / nome.
 */
export async function resolverProfessor(usuario) {
  if (!usuario?.id) return null;
  const select = '&select=id,nome,disciplina,escola_id&limit=1';
  const tentativas = [];

  if (usuario.login) tentativas.push(`professores?id_login=eq.${encodeURIComponent(String(usuario.login))}${select}`);
  if (usuario.cpf) tentativas.push(`professores?cpf=eq.${encodeURIComponent(String(usuario.cpf).replace(/\D/g, ''))}${select}`);
  if (usuario.nome) {
    const escola = usuario.escola_id ? `&escola_id=eq.${usuario.escola_id}` : '';
    tentativas.push(`professores?nome=ilike.${encodeURIComponent(String(usuario.nome))}${escola}${select}`);
  }

  for (const caminho of tentativas) {
    try {
      const linhas = await api(caminho) || [];
      if (linhas.length) return linhas[0];
    } catch (e) {
      // Coluna ausente em algum banco antigo: segue para a próxima tentativa.
      console.warn('[SICEP+] vínculo com professores:', e.message);
    }
  }
  return null;
}

/* ---------------- Sessão do SIGEIA+/SIDED+ ---------------- */

export function sessaoRemota() {
  try {
    const ded = JSON.parse(sessionStorage.getItem('ded_user') || 'null');
    const prof = JSON.parse(sessionStorage.getItem('prof_data') || 'null');
    if (!ded || !ded.id) return null;
    return {
      usuario_id: ded.id,
      nome: ded.nome || prof?.nome || 'Professor(a)',
      role: ded.role || null,
      escola_id: ded.escola_id || prof?.escola_id || null,
      professor_id: prof?.id || null,
    };
  } catch (e) {
    return null;
  }
}

export function disponivel() {
  return configurado() && Boolean(sessaoRemota());
}

/* ---------------- Contexto acadêmico ---------------- */

export async function carregarContexto() {
  const sessao = sessaoRemota();
  if (!sessao) throw new Error('Sessão não encontrada. Entre pelo SIGEIA+.');
  if (!sessao.professor_id) throw new Error('Cadastro de professor não vinculado a este usuário.');

  const vinculos = await api(
    `turma_disciplinas?professor_id=eq.${sessao.professor_id}` +
    '&select=id,turma_id,disciplina_id,professor_id,disciplinas(id,nome),turmas(id,nome,ano,turno,ano_serie)'
  ) || [];

  const turmasMapa = new Map();
  const disciplinasMapa = new Map();
  const turmaDisciplinas = [];

  vinculos.forEach((v) => {
    if (v.turmas) turmasMapa.set(v.turma_id, {
      id: v.turmas.id,
      nome: v.turmas.nome,
      ano: v.turmas.ano,
      turno: v.turmas.turno,
      ano_serie: v.turmas.ano_serie,
      escola_id: sessao.escola_id,
    });
    if (v.disciplinas) disciplinasMapa.set(v.disciplina_id, { id: v.disciplinas.id, nome: v.disciplinas.nome });
    turmaDisciplinas.push({
      id: v.id,
      turma_id: v.turma_id,
      disciplina_id: v.disciplina_id,
      professor_id: v.professor_id,
    });
  });

  const idsTurmas = [...turmasMapa.keys()];
  const alunos = idsTurmas.length
    ? await api(`alunos?turma_id=in.(${idsTurmas.join(',')})&select=id,nome_completo,turma_id,codigo_simade`) || []
    : [];

  let escolaNome = null;
  if (sessao.escola_id) {
    try {
      const escola = await api(`escolas?id=eq.${sessao.escola_id}&select=nome&limit=1`);
      escolaNome = escola && escola[0] ? escola[0].nome : null;
    } catch (e) {
      escolaNome = null;
    }
  }

  return {
    sessao,
    escolaNome,
    turmas: [...turmasMapa.values()],
    disciplinas: [...disciplinasMapa.values()],
    professores: [{ id: sessao.professor_id, nome: sessao.nome }],
    turma_disciplinas: turmaDisciplinas,
    alunos: alunos.map((a) => ({
      id: a.id,
      nome_completo: a.nome_completo,
      turma_id: a.turma_id,
      codigo_simade: a.codigo_simade,
    })),
  };
}

/* ---------------- Capacidades opcionais ---------------- */

/**
 * Colunas que ainda NÃO existem no banco. A interface só habilita o
 * recurso quando a coluna é encontrada — nunca grava às cegas.
 */
export async function detectarRecursos() {
  const recursos = {
    prazo: false, faixas: false, anulada: false, situacao: false, status: false,
    turma_disciplina: false, revisado: false, enviado: false, trimestre: false,
  };

  const teste = async (path, chave) => {
    try {
      await api(`${path}&limit=1`);
      recursos[chave] = true;
    } catch (e) {
      recursos[chave] = false;
    }
  };

  await Promise.all([
    teste('sicep_avaliacoes?select=prazo_correcao', 'prazo'),
    teste('sicep_avaliacoes?select=faixa_verde,faixa_amarela', 'faixas'),
    teste('sicep_questoes?select=anulada', 'anulada'),
    teste('sicep_resultados?select=situacao', 'situacao'),
    teste('sicep_resultados?select=status', 'status'),
    teste('sicep_resultados?select=turma_disciplina_id', 'turma_disciplina'),
    teste('sicep_resultados?select=revisado_em', 'revisado'),
    teste('sicep_resultados?select=enviado_sided_em', 'enviado'),
    teste('sicep_avaliacoes?select=trimestre', 'trimestre'),
  ]);

  return recursos;
}

/* ---------------- Avaliações ---------------- */

export async function carregarAvaliacoes(usuarioId, recursos) {
  const extras = [];
  if (recursos?.prazo) extras.push('prazo_correcao');
  if (recursos?.faixas) extras.push('faixa_verde', 'faixa_amarela');
  if (recursos?.trimestre) extras.push('trimestre');

  const colunasQuestao = ['id', 'numero', 'enunciado', 'valor', 'num_alternativas', 'gabarito'];
  if (recursos?.anulada) colunasQuestao.push('anulada');

  const campos = [
    'id', 'titulo', 'descricao', 'disciplina', 'valor_total', 'data_aplicacao',
    'modo', 'lancar_sided', 'status', 'turmas_ids', 'created_at', 'sided_avaliacao_id',
    'layout_leitura_id', ...extras,
  ].join(',');

  const linha = await api(
    `sicep_avaliacoes?professor_id=eq.${usuarioId}&select=${campos},` +
    `sicep_questoes(${colunasQuestao.join(',')}),` +
    'sicep_layouts_leitura(id,codigo_caderno,versao,qtd_questoes,qtd_alternativas,tipo_layout)' +
    '&order=created_at.desc'
  ) || [];

  return linha.map((a) => ({
    id: a.id,
    titulo: a.titulo,
    descricao: a.descricao || '',
    disciplina: a.disciplina || '',
    valor_total: Number(a.valor_total || 0),
    data_aplicacao: a.data_aplicacao,
    prazo_correcao: a.prazo_correcao || null,
    // Sem valor presumido: avaliação antiga fica com trimestre null até o professor definir.
    trimestre: a.trimestre != null ? Number(a.trimestre) : null,
    faixas: {
      verde: a.faixa_verde != null ? Number(a.faixa_verde) : 80,
      amarelo: a.faixa_amarela != null ? Number(a.faixa_amarela) : 60,
    },
    modo: a.modo || 'impresso',
    lancar_sided: !!a.lancar_sided,
    status: a.status || 'rascunho',
    turmas_ids: a.turmas_ids || [],
    sided_avaliacao_id: a.sided_avaliacao_id || null,
    layout: a.sicep_layouts_leitura
      ? { codigo_caderno: a.sicep_layouts_leitura.codigo_caderno, versao: a.sicep_layouts_leitura.versao, num_alternativas: a.sicep_layouts_leitura.qtd_alternativas }
      : null,
    questoes: (a.sicep_questoes || [])
      .sort((x, y) => x.numero - y.numero)
      .map((q) => ({
        id: q.id,
        numero: q.numero,
        enunciado: q.enunciado || '',
        valor: Number(q.valor || 0),
        num_alternativas: Number(q.num_alternativas || 4),
        gabarito: q.gabarito || null,
        anulada: !!q.anulada,
      })),
    criado_em: a.created_at,
  }));
}

/* ---------------- Identificadores gerados no dispositivo ---------------- */

/** UUID v4 gerado no próprio aparelho (funciona também sem internet). */
export function novoUuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Enquanto o banco aceitar ids vindos do cliente. Se uma coluna `id` rejeitar UUID
// (tipo numérico ou identidade "always"), o app volta sozinho ao modo antigo
// (id gerado pelo servidor) em vez de quebrar a gravação.
let idsDoCliente = true;
export function idsDoClienteAceitos() { return idsDoCliente; }

function recusouIdDoCliente(e) {
  const t = String(e?.message || '');
  return e?.status === 400 && /22P02|428C9|invalid input syntax|non-DEFAULT value/i.test(t);
}

/**
 * Insere linhas de forma idempotente pela chave primária `id`:
 * repetir a mesma gravação NÃO duplica e NÃO sobrescreve o que já existe
 * (ignore-duplicates). Devolve só as linhas realmente inseridas agora.
 */
async function inserirIdempotente(tabela, linhas) {
  if (!linhas.length) return [];
  if (idsDoCliente && linhas.every((l) => l.id)) {
    try {
      return await api(`${tabela}?on_conflict=id`, {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,missing=default,return=representation' },
        body: JSON.stringify(linhas),
      }) || [];
    } catch (e) {
      if (!recusouIdDoCliente(e)) throw e;
      idsDoCliente = false;
      console.warn('[SICEP+] O banco não aceita id do cliente em', tabela, '— usando id do servidor.');
    }
  }
  return await api(tabela, {
    method: 'POST',
    headers: { Prefer: 'missing=default,return=representation' },
    body: JSON.stringify(linhas.map(({ id, ...resto }) => resto)),
  }) || [];
}

// Violação de índice único (ex.: dois aparelhos criando a mesma questão ao mesmo tempo).
function conflitoDeUnicidade(e) {
  return e?.status === 409 || /23505/.test(String(e?.message || ''));
}

const LETRAS = ['A', 'B', 'C', 'D', 'E'];

/**
 * Questões de uma avaliação: identidade estável por (avaliacao_id, numero).
 * - número que já existe  -> atualiza a mesma linha (o id e os vínculos ficam);
 *   só grava se algum campo mudou;
 * - número novo           -> insere com id gerado no cliente (idempotente);
 * - número que saiu       -> remove só essa linha (apenas quando `remover`).
 * Não depende de índice único no banco e converge se for repetida após uma falha.
 * Devolve { questoes: [{id, numero}], novas: [{id, numero}] }.
 */
async function sincronizarQuestoes(avaliacaoId, questoes, numAlternativas, opcoes) {
  try {
    return await sincronizarQuestoesUmaVez(avaliacaoId, questoes, numAlternativas, opcoes);
  } catch (e) {
    if (!conflitoDeUnicidade(e)) throw e;
    // Outro aparelho gravou a mesma questão no meio do caminho: lê de novo e atualiza essa linha.
    return await sincronizarQuestoesUmaVez(avaliacaoId, questoes, numAlternativas, opcoes);
  }
}

async function sincronizarQuestoesUmaVez(avaliacaoId, questoes, numAlternativas, { remover }) {
  const base = ['id', 'numero', 'enunciado', 'valor', 'num_alternativas', 'gabarito'];
  let temAnulada = true;
  let atuais;
  try {
    atuais = await api(`sicep_questoes?avaliacao_id=eq.${avaliacaoId}&select=${[...base, 'anulada'].join(',')}&order=numero.asc`) || [];
  } catch (e) {
    temAnulada = false;
    atuais = await api(`sicep_questoes?avaliacao_id=eq.${avaliacaoId}&select=${base.join(',')}&order=numero.asc`) || [];
  }

  const porNumero = new Map();
  atuais.forEach((q) => { if (!porNumero.has(Number(q.numero))) porNumero.set(Number(q.numero), q); });

  const corpoDe = (q) => ({
    numero: Number(q.numero),
    enunciado: q.enunciado || null,
    valor: Number(q.valor),
    num_alternativas: Number(numAlternativas),
    gabarito: q.gabarito,
  });
  const igual = (ex, c, q) => (
    (ex.enunciado || null) === c.enunciado
    && Number(ex.valor) === c.valor
    && Number(ex.num_alternativas) === c.num_alternativas
    && (ex.gabarito || null) === (c.gabarito || null)
    && (!temAnulada || !!ex.anulada === !!q.anulada)
  );

  const novasLinhas = [];
  const vistos = new Set();
  for (const q of questoes) {
    const corpo = corpoDe(q);
    if (vistos.has(corpo.numero)) continue; // número repetido na própria lista: vale o primeiro
    vistos.add(corpo.numero);

    const ex = porNumero.get(corpo.numero);
    if (ex) {
      if (!igual(ex, corpo, q)) {
        await api(`sicep_questoes?id=eq.${ex.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...corpo, ...(temAnulada ? { anulada: !!q.anulada } : {}) }),
        });
      }
    } else {
      novasLinhas.push({
        id: q.id || novoUuid(),
        avaliacao_id: avaliacaoId,
        ...corpo,
        ...(q.anulada ? { anulada: true } : {}),
      });
    }
  }

  await inserirIdempotente('sicep_questoes', novasLinhas);

  if (remover) {
    const saiu = atuais.filter((q) => !vistos.has(Number(q.numero)));
    if (saiu.length) {
      const ids = saiu.map((q) => q.id).join(',');
      // Alternativas da questão que saiu (tabela opcional / pode ter cascata).
      try { await api(`sicep_alternativas?questao_id=in.(${ids})`, { method: 'DELETE' }); } catch (e) { /* ignora */ }
      await api(`sicep_questoes?id=in.(${ids})`, { method: 'DELETE' });
    }
  }

  const finais = await api(`sicep_questoes?avaliacao_id=eq.${avaliacaoId}&select=id,numero&order=numero.asc`) || [];
  const idPorNumero = new Map();
  finais.forEach((q) => { if (!idPorNumero.has(Number(q.numero))) idPorNumero.set(Number(q.numero), q.id); });
  const novas = novasLinhas
    .map((l) => ({ id: idPorNumero.get(l.numero), numero: l.numero }))
    .filter((x) => x.id);
  return { questoes: finais, novas };
}

/** Cria só as linhas de alternativas que ainda não existem (repetir não duplica). */
async function garantirAlternativas(salvas, questoesEntrada, numAlternativas) {
  if (!salvas.length) return;
  const letras = LETRAS.slice(0, Number(numAlternativas) || 5);
  const textos = new Map(questoesEntrada.map((q) => [Number(q.numero), q.alternativas || {}]));
  const ids = salvas.map((q) => q.id).join(',');
  const ja = await api(`sicep_alternativas?questao_id=in.(${ids})&select=questao_id,letra`) || [];
  const existe = new Set(ja.map((a) => `${a.questao_id}|${a.letra}`));

  const faltam = [];
  salvas.forEach((q) => {
    letras.forEach((letra) => {
      if (existe.has(`${q.id}|${letra}`)) return;
      faltam.push({ questao_id: q.id, letra, texto: textos.get(Number(q.numero))?.[letra] || null });
    });
  });
  if (faltam.length) await api('sicep_alternativas', { method: 'POST', body: JSON.stringify(faltam) });
}

/**
 * Cria a avaliação com o id vindo do cliente (`dados.id`) e as questões
 * (`dados.questoes[i].id`, opcional). Repetir a mesma chamada completa o que
 * faltou e não cria registros em dobro nem sobrescreve edições posteriores.
 */
export async function criarAvaliacao(dados, usuarioId) {
  const corpo = {
    ...(dados.id ? { id: dados.id } : {}),
    professor_id: usuarioId,
    titulo: dados.titulo,
    descricao: dados.descricao || null,
    disciplina: dados.disciplina || null,
    valor_total: dados.valor_total,
    data_aplicacao: dados.data_aplicacao,
    modo: 'impresso',
    lancar_sided: !!dados.lancar_sided,
    status: 'pronta',
    turmas_ids: dados.turmas_ids,
    ...(dados.prazo_correcao ? { prazo_correcao: dados.prazo_correcao } : {}),
    ...(dados.trimestre ? { trimestre: dados.trimestre } : {}),
    ...(dados.faixas ? { faixa_verde: dados.faixas.verde, faixa_amarela: dados.faixas.amarelo } : {}),
  };

  let [avaliacao] = await inserirIdempotente('sicep_avaliacoes', [corpo]);
  if (!avaliacao && dados.id) {
    // Já existia (tentativa anterior): usa a linha que está lá, sem alterá-la.
    [avaliacao] = await api(`sicep_avaliacoes?id=eq.${dados.id}&professor_id=eq.${usuarioId}&select=*&limit=1`) || [];
  }
  if (!avaliacao) throw new Error('A avaliação não foi gravada.');

  const { questoes: salvas } = await sincronizarQuestoes(avaliacao.id, dados.questoes, dados.num_alternativas, { remover: false });
  // Alternativas (texto opcional — o gabarito oficial é sicep_questoes.gabarito)
  await garantirAlternativas(salvas, dados.questoes, dados.num_alternativas);

  return { ...avaliacao, questoes: salvas };
}

/**
 * Atualiza a avaliação e sincroniza as questões SEM apagar e recriar:
 * as linhas existentes mantêm o id e os vínculos. Repetir a chamada é seguro.
 */
export async function atualizarAvaliacao(avaliacaoId, patch, questoes, numAlternativas) {
  const [atualizada] = await api(`sicep_avaliacoes?id=eq.${avaliacaoId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  }) || [];

  if (Array.isArray(questoes)) {
    const { novas } = await sincronizarQuestoes(avaliacaoId, questoes, numAlternativas, { remover: true });
    await garantirAlternativas(novas, questoes, numAlternativas);
  }

  return atualizada;
}

/** Apaga a avaliação e seus dependentes (não há FK em cascata nas tabelas sicep_*). */
export async function excluirAvaliacao(avaliacaoId) {
  await api(`sicep_resultados?avaliacao_id=eq.${avaliacaoId}`, { method: 'DELETE' });
  await api(`sicep_questoes?avaliacao_id=eq.${avaliacaoId}`, { method: 'DELETE' });
  await api(`sicep_avaliacoes?id=eq.${avaliacaoId}`, { method: 'DELETE' });
}

/**
 * Código do caderno (digitado na criação) vira linha em sicep_layouts_leitura
 * e o QR do cartão usa exatamente esse código.
 */
export async function salvarLayoutCaderno({
  avaliacaoId, professorId, escolaId, codigo, qtdQuestoes, qtdAlternativas, versao = 1,
}) {
  const existentes = await api(
    `sicep_layouts_leitura?professor_id=eq.${professorId}&codigo_caderno=eq.${encodeURIComponent(codigo)}&select=id&limit=1`
  ) || [];

  const corpo = {
    professor_id: professorId,
    escola_id: escolaId || null,
    codigo_caderno: codigo,
    nome: `SICEP+ · ${codigo}`,
    qtd_questoes: qtdQuestoes,
    qtd_alternativas: qtdAlternativas,
    tipo_layout: 'SICEP+',
    versao,
  };

  let layoutId = existentes[0]?.id || null;
  if (layoutId) {
    await api(`sicep_layouts_leitura?id=eq.${layoutId}`, { method: 'PATCH', body: JSON.stringify(corpo) });
  } else {
    const [novo] = await api('sicep_layouts_leitura', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(corpo),
    }) || [];
    layoutId = novo?.id || null;
  }

  if (layoutId) {
    await api(`sicep_avaliacoes?id=eq.${avaliacaoId}`, {
      method: 'PATCH',
      body: JSON.stringify({ layout_leitura_id: layoutId }),
    });
  }
  return layoutId;
}

/* ---------------- Resultados ---------------- */

export async function carregarResultados(usuarioId) {
  const avs = await api(`sicep_avaliacoes?professor_id=eq.${usuarioId}&select=id`) || [];
  if (!avs.length) return [];
  const ids = avs.map((a) => a.id).join(',');
  const linhas = await api(
    `sicep_resultados?avaliacao_id=in.(${ids})&select=*&order=created_at.desc`
  ) || [];
  return linhas;
}

/**
 * Cria o resultado com o id vindo do cliente (`registro.id`).
 * - Mesma gravação repetida (mesmo id): não duplica e não sobrescreve.
 * - Já existe resultado do mesmo aluno/avaliação/turma com OUTRO id: não cria um
 *   segundo; lança erro com `codigo = 'RESULTADO_DUPLICADO'` e `existente`.
 */
export async function salvarResultado(registro) {
  const filtro = `avaliacao_id=eq.${registro.avaliacao_id}&aluno_id=eq.${registro.aluno_id}`
    + (registro.turma_id ? `&turma_id=eq.${registro.turma_id}` : '');
  const [existente] = await api(`sicep_resultados?${filtro}&select=*&limit=1`) || [];
  if (existente) {
    if (registro.id && existente.id === registro.id) return existente; // tentativa repetida já aplicada
    const e = new Error('Já existe um resultado deste aluno nesta avaliação.');
    e.codigo = 'RESULTADO_DUPLICADO';
    e.existente = existente;
    throw e;
  }

  let criado;
  try {
    [criado] = await inserirIdempotente('sicep_resultados', [registro]);
  } catch (e) {
    if (!conflitoDeUnicidade(e)) throw e;
    // Outro aparelho gravou o resultado deste aluno entre a conferência e a gravação.
    const [outro] = await api(`sicep_resultados?${filtro}&select=*&limit=1`) || [];
    if (outro && registro.id && outro.id === registro.id) return outro;
    const dup = new Error('Já existe um resultado deste aluno nesta avaliação.');
    dup.codigo = 'RESULTADO_DUPLICADO';
    dup.existente = outro || null;
    throw dup;
  }
  if (!criado && registro.id) {
    [criado] = await api(`sicep_resultados?id=eq.${registro.id}&select=*&limit=1`) || [];
  }
  return criado;
}

export async function registrarScan({ resultado_id, imagem_url, respostas_detectadas, confianca }) {
  return api('sicep_ocr_scans', {
    method: 'POST',
    body: JSON.stringify({ resultado_id, imagem_url, respostas_detectadas, confianca }),
  });
}

/* ---------------- Integração SIDED+ ---------------- */

/**
 * A avaliação do SIDED+ pertence a UMA turma (avaliacoes.turma_id).
 * Um instrumento do SICEP+ pode valer para várias turmas, portanto o vínculo
 * é por turma — nunca um id único no instrumento (era isso que fazia o envio
 * de uma turma cair na avaliação/turma da primeira e criava registros repetidos).
 */

/** Id guardado no SICEP+ só vale se for mesmo da turma que está sendo enviada. */
async function sidedDaTurma(sidedId, turmaId) {
  if (!sidedId) return null;
  try {
    const linhas = await api(`avaliacoes?id=eq.${sidedId}&select=id,turma_id,nome,pontos,trimestre&limit=1`) || [];
    const l = linhas[0];
    return l && l.turma_id === turmaId ? l : null;
  } catch (e) {
    return null;
  }
}

/** Procura a avaliação equivalente já existente (mesma turma, nome, trimestre e pontos). */
async function sidedEquivalente({ turmaId, nome, pontos, trimestre }) {
  if (!nome) return null;
  const linhas = await api(
    `avaliacoes?turma_id=eq.${turmaId}&trimestre=eq.${trimestre}` +
    `&nome=eq.${encodeURIComponent(nome)}` +
    '&select=id,turma_id,nome,pontos,trimestre,data,created_at&order=created_at.asc'
  ) || [];
  return linhas.find((l) => Math.abs(Number(l.pontos || 0) - Number(pontos || 0)) < 0.005) || null;
}

/**
 * Garante a avaliação espelhada no SIDED+ para ESTA turma e grava as notas em
 * `notas` (upsert em avaliacao_id, aluno_id).
 *
 * Regras conferidas no banco:
 * - avaliacoes: turma_id e professor_id (professores.id) são obrigatórios;
 *   pontos > 0; trimestre ∈ {1,2,3}; tipo = 'normal'.
 * - notas: UNIQUE (avaliacao_id, aluno_id) → upsert idempotente (sem duplicar).
 * - notas NÃO tem professor_id (não enviar essa coluna).
 * - Ausência/abstenção: notas.ausente / notas.nao_realizado.
 */
export async function enviarNotasSided({ avaliacaoSicep, turma, turmaDisciplinaId, professorId, trimestre, items }) {
  if (!turma?.id) throw new Error('Turma não identificada para o envio ao SIDED+.');

  const nome = String(avaliacaoSicep.titulo || '').trim();
  const pontos = Number(avaliacaoSicep.valor_total) || 0;
  const trim = Number(trimestre) || 1;

  let sided = await sidedDaTurma(avaliacaoSicep.sided_avaliacao_id, turma.id);
  if (!sided) sided = await sidedEquivalente({ turmaId: turma.id, nome, pontos, trimestre: trim });

  let criada = false;
  if (!sided) {
    const [nova] = await api('avaliacoes?select=*', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        nome,
        pontos,
        trimestre: trim,
        tipo: 'normal',
        turma_id: turma.id,
        professor_id: professorId,
        turma_disciplina_id: turmaDisciplinaId || null,
        disciplina: avaliacaoSicep.disciplina || null,
        data: avaliacaoSicep.data_aplicacao || null,
        observacoes: 'Registrada pelo SICEP+',
      }),
    }) || [];
    if (!nova?.id) throw new Error('O SIDED+ não devolveu a avaliação criada.');
    sided = nova;
    criada = true;
  }

  // Proteção: nota que já existe no SIDED+ com valor DIFERENTE não é sobrescrita
  // (o professor pode ter editado lá, ou o resultado foi excluído e relido aqui).
  // Nota igual não precisa ser gravada de novo; conta como enviada.
  const conflitos = [];
  let itensGravar = items;
  const existentes = new Map();
  if (!criada && items.length) {
    const ids = items.map((i) => i.aluno_id).join(',');
    const linhas = await api(
      `notas?avaliacao_id=eq.${sided.id}&aluno_id=in.(${ids})&select=aluno_id,nota`
    ) || [];
    linhas.forEach((l) => existentes.set(l.aluno_id, l.nota));
    itensGravar = items.filter((i) => {
      const atual = existentes.get(i.aluno_id);
      if (atual == null) return true;
      if (Math.abs(Number(atual) - Number(i.nota)) < 0.005) return false;
      conflitos.push(i.aluno_id);
      return false;
    });
  }
  const jaIguais = items.filter((i) => existentes.has(i.aluno_id) && existentes.get(i.aluno_id) != null
    && !conflitos.includes(i.aluno_id)).map((i) => i.aluno_id);

  const notas = itensGravar.map((i) => ({
    avaliacao_id: sided.id,
    aluno_id: i.aluno_id,
    nota: i.nota,
    ausente: i.situacao === 'ausente',
    nao_realizado: ['abstencao', 'nao_entregue'].includes(i.situacao),
    turma_id: turma.id,
    turma_disciplina_id: turmaDisciplinaId || null,
  }));

  if (notas.length) {
    await api('notas?on_conflict=avaliacao_id,aluno_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(notas),
    });
  }

  return {
    sided_avaliacao_id: sided.id,
    enviados: notas.length + jaIguais.length,
    enviadosAlunos: [...notas.map((n) => n.aluno_id), ...jaIguais],
    conflitos,
    criada,
  };
}

export { api };

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
    habilidade_bncc: false, habilidades: false, participacao: false,
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
    teste('sicep_questoes?select=habilidade_bncc', 'habilidade_bncc'),
    // Etapa 4B: habilidades do planejamento (SIDED+). Sem tabela/RLS, o recurso fica desligado.
    teste('habilidades_planejamento?select=codigo', 'habilidades'),
    // Controle de presença/ausência/pendência: só liga quando a tabela existe no banco.
    teste('sicep_participacao?select=id,situacao,atualizado_em,enviado_sided_em', 'participacao'),
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
  // A coluna existe no banco; só é lida quando o recurso foi confirmado.
  if (recursos?.habilidade_bncc) colunasQuestao.push('habilidade_bncc');

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
        habilidade_bncc: q.habilidade_bncc || null,
      })),
    criado_em: a.created_at,
  }));
}

/* ---------------- Identificadores gerados no dispositivo ---------------- */

/* ---------------- Habilidades do planejamento (Etapa 4B) ---------------- */

/** Erro de leitura de habilidades com uma mensagem clara para a tela. */
function erroDeHabilidades(e) {
  const status = Number(e?.status) || 0;
  const texto = String(e?.message || '');
  let mensagem;
  if (status === 401 || status === 403 || /permission denied|row-level security|\bRLS\b/i.test(texto)) {
    mensagem = 'O banco recusou a leitura das habilidades por permissão (RLS). Fale com a gestão para liberar a tabela habilidades_planejamento.';
  } else if (status === 404 || /PGRST205|42P01|does not exist/i.test(texto)) {
    mensagem = 'A tabela habilidades_planejamento não existe neste banco. Nenhuma habilidade foi carregada.';
  } else {
    mensagem = `Não foi possível carregar as habilidades agora${texto ? `: ${texto.slice(0, 160)}` : '.'}`;
  }
  const erro = new Error(mensagem);
  erro.codigo = 'HABILIDADES_INDISPONIVEIS';
  erro.status = status || null;
  erro.causa = e;
  return erro;
}

/** Códigos separados por vírgula, sem vazios e sem repetição. */
export function normalizarCodigos(valor) {
  const lista = String(valor ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return lista.length ? [...new Set(lista)].join(',') : null;
}

/**
 * Habilidades cadastradas no planejamento (SIDED+) para os vínculos turma × disciplina.
 * O trimestre de cada habilidade vem da `ordem_divisao` em `parametro_divisoes`
 * (1..3 = trimestres; 4 = recuperação final). Sem essa informação, tenta o nome da divisão.
 * Lança erro com `codigo = 'HABILIDADES_INDISPONIVEIS'` quando a leitura falha (RLS, tabela ausente…).
 */
export async function carregarHabilidades(turmaDisciplinaIds) {
  const ids = [...new Set((turmaDisciplinaIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { habilidades: [], divisoes: [] };

  let linhas;
  try {
    linhas = await api(
      `habilidades_planejamento?turma_disciplina_id=in.(${ids.join(',')})` +
      '&select=id,turma_disciplina_id,codigo,descricao,temas,divisao_id&order=codigo.asc'
    ) || [];
  } catch (e) {
    throw erroDeHabilidades(e);
  }

  const trimestrePorDivisao = new Map();
  const nomePorDivisao = new Map();

  try {
    const parametros = await api('parametro_divisoes?select=divisao_id,ordem_divisao,parametro_id') || [];
    parametros.forEach((pd) => {
      const ordem = Number(pd.ordem_divisao);
      const trimestre = Number.isInteger(ordem) && ordem >= 1 && ordem <= 3 ? ordem : null;
      if (!trimestrePorDivisao.has(pd.divisao_id)) trimestrePorDivisao.set(pd.divisao_id, trimestre);
    });
  } catch (e) {
    // Sem parâmetro_divisoes: o nome da divisão ainda pode dizer o trimestre.
    console.warn('[SICEP+] parametro_divisoes indisponível:', e.message);
  }

  try {
    const divisoes = await api('divisoes?select=id,nome,ordem,tipo') || [];
    divisoes.forEach((d) => {
      nomePorDivisao.set(d.id, d.nome || null);
      if (trimestrePorDivisao.has(d.id)) return;
      const achado = String(d.nome || '').match(/([1-3])\s*[ºo°]?\s*trimestre/i);
      if (achado) trimestrePorDivisao.set(d.id, Number(achado[1]));
    });
  } catch (e) {
    console.warn('[SICEP+] divisoes indisponível:', e.message);
  }

  const habilidades = linhas
    .map((h) => ({
      id: h.id,
      turma_disciplina_id: h.turma_disciplina_id,
      codigo: String(h.codigo || '').trim(),
      descricao: h.descricao || '',
      temas: Array.isArray(h.temas) ? h.temas.filter(Boolean) : [],
      divisao_id: h.divisao_id || null,
      divisao_nome: nomePorDivisao.get(h.divisao_id) || null,
      trimestre: trimestrePorDivisao.get(h.divisao_id) ?? null,
    }))
    .filter((h) => h.codigo);

  return { habilidades, divisoes: [...nomePorDivisao.values()].filter(Boolean) };
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

// Colunas opcionais de questão que podem existir em bancos mais novos (ex.: habilidades).
// São preservadas quando a linha do servidor já as tem — nunca inventadas nem apagadas.
const CAMPOS_EXTRA_QUESTAO = ['habilidade', 'habilidade_id', 'descritor', 'bncc'];

// Coluna real de habilidades (Etapa 4B). Confirmada uma vez por sessão para
// nunca tentar gravar em bancos que ainda não a tenham.
let suportaHabilidadeBncc = null;
async function temColunaHabilidadeBncc() {
  if (suportaHabilidadeBncc !== null) return suportaHabilidadeBncc;
  try {
    await api('sicep_questoes?select=habilidade_bncc&limit=1');
    suportaHabilidadeBncc = true;
  } catch (e) {
    suportaHabilidadeBncc = false;
    console.warn('[SICEP+] coluna habilidade_bncc indisponível:', e.message);
  }
  return suportaHabilidadeBncc;
}

async function sincronizarQuestoesUmaVez(avaliacaoId, questoes, numAlternativas, { remover }) {
  let temAnulada = true;
  let atuais;
  try {
    // select=* permite preservar colunas opcionais existentes (anulada, habilidade…).
    atuais = await api(`sicep_questoes?avaliacao_id=eq.${avaliacaoId}&select=*&order=numero.asc`) || [];
    if (atuais.length && !Object.prototype.hasOwnProperty.call(atuais[0], 'anulada')) temAnulada = false;
  } catch (e) {
    temAnulada = false;
    atuais = await api(`sicep_questoes?avaliacao_id=eq.${avaliacaoId}&select=id,numero,enunciado,valor,num_alternativas,gabarito&order=numero.asc`) || [];
  }

  const temHabilidade = await temColunaHabilidadeBncc();

  const porNumero = new Map();
  atuais.forEach((q) => { if (!porNumero.has(Number(q.numero))) porNumero.set(Number(q.numero), q); });

  const extrasDe = (q, ex) => {
    const extras = {};
    CAMPOS_EXTRA_QUESTAO.forEach((campo) => {
      if (ex && Object.prototype.hasOwnProperty.call(ex, campo) && Object.prototype.hasOwnProperty.call(q, campo)) extras[campo] = q[campo];
    });
    // Habilidades: sempre gravadas quando a coluna existe. Ausente na entrada = preserva
    // o que já está no servidor (nada é apagado por falha de carregamento).
    if (temHabilidade && Object.prototype.hasOwnProperty.call(q, 'habilidade_bncc')) {
      extras.habilidade_bncc = normalizarCodigos(q.habilidade_bncc);
    }
    return extras;
  };
  const corpoDe = (q, ex = null) => ({
    numero: Number(q.numero),
    enunciado: q.enunciado || null,
    valor: Number(q.valor),
    num_alternativas: Number(numAlternativas),
    gabarito: q.gabarito,
    ...extrasDe(q, ex),
  });
  const igual = (ex, c, q) => (
    (ex.enunciado || null) === c.enunciado
    && Number(ex.valor) === c.valor
    && Number(ex.num_alternativas) === c.num_alternativas
    && (ex.gabarito || null) === (c.gabarito || null)
    && (!temAnulada || !!ex.anulada === !!q.anulada)
    && (!temHabilidade || !Object.prototype.hasOwnProperty.call(c, 'habilidade_bncc')
      || normalizarCodigos(ex.habilidade_bncc) === normalizarCodigos(c.habilidade_bncc))
    && CAMPOS_EXTRA_QUESTAO.every((campo) => !Object.prototype.hasOwnProperty.call(ex, campo)
      || !Object.prototype.hasOwnProperty.call(c, campo)
      || JSON.stringify(ex[campo] ?? null) === JSON.stringify(c[campo] ?? null))
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
  const avaliacao = await gravarAvaliacaoIdempotente(dados, usuarioId);
  const salvas = await gravarQuestoesIdempotente(avaliacao.id, dados.questoes, dados.num_alternativas);
  return { ...avaliacao, questoes: salvas };
}

/**
 * Passo 1 da criação (6E): só a linha de sicep_avaliacoes, com o id vindo do cliente.
 * Repetir não duplica: se a linha já existe, devolve a que está lá, sem alterá-la.
 */
export async function gravarAvaliacaoIdempotente(dados, usuarioId) {
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
  return avaliacao;
}

/**
 * Passo 2 da criação (6E): questões e alternativas de uma avaliação que já existe na nuvem.
 * Identidade estável por (avaliacao_id, numero): repetir completa o que faltou e não duplica.
 * Devolve [{ id, numero }] com os ids que a nuvem tem.
 */
export async function gravarQuestoesIdempotente(avaliacaoId, questoes, numAlternativas) {
  const { questoes: salvas } = await sincronizarQuestoes(avaliacaoId, questoes, numAlternativas, { remover: false });
  // Alternativas (texto opcional — o gabarito oficial é sicep_questoes.gabarito)
  await garantirAlternativas(salvas, questoes, numAlternativas);
  return salvas;
}

/**
 * Atualiza a avaliação e sincroniza as questões SEM apagar e recriar:
 * as linhas existentes mantêm o id e os vínculos. Repetir a chamada é seguro.
 */
export async function atualizarAvaliacao(avaliacaoId, patch, questoes, numAlternativas, { remover = true } = {}) {
  const [atualizada] = await api(`sicep_avaliacoes?id=eq.${avaliacaoId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  }) || [];

  if (Array.isArray(questoes)) {
    const { novas } = await sincronizarQuestoes(avaliacaoId, questoes, numAlternativas, { remover });
    await garantirAlternativas(novas, questoes, numAlternativas);
  }

  return atualizada;
}

/* ---------------- Versão da avaliação (edição offline, conflitos) ---------------- */

/**
 * Retrato estável e comparável de uma avaliação + questões.
 * Serve para detectar se a avaliação mudou na nuvem entre o início da edição
 * offline e o envio — sem depender de coluna updated_at (que pode não existir).
 * A ordem dos campos e a ordenação das questões são fixas: mesmos dados, mesma impressão.
 */
function versaoDaAvaliacao(avaliacao, questoes) {
  const av = avaliacao || {};
  const lista = (questoes || []).map((q) => ({
    numero: Number(q.numero),
    enunciado: q.enunciado || '',
    valor: Number(q.valor || 0),
    num_alternativas: Number(q.num_alternativas || 4),
    gabarito: q.gabarito || null,
    anulada: !!q.anulada,
    // Habilidades entram na comparação: editar só os vínculos também detecta divergência.
    habilidade_bncc: normalizarCodigos(q.habilidade_bncc),
  })).sort((a, b) => a.numero - b.numero);
  return {
    titulo: av.titulo || '',
    descricao: av.descricao || '',
    disciplina: av.disciplina || '',
    valor_total: Number(av.valor_total || 0),
    data_aplicacao: av.data_aplicacao || null,
    lancar_sided: !!av.lancar_sided,
    trimestre: av.trimestre != null ? Number(av.trimestre) : null,
    turmas_ids: [...(av.turmas_ids || [])].map(String).sort(),
    // As faixas de cor não entram: o banco pode não ter as colunas e o app usa 80/60
    // como padrão, o que geraria conflito falso em toda edição.
    questoes: lista,
  };
}

export function impressaoDaAvaliacao(avaliacao, questoes) {
  return JSON.stringify(versaoDaAvaliacao(avaliacao, questoes));
}

/** Lê a versão que está na nuvem agora (avaliação + questões), com impressão para comparar. */
export async function lerAvaliacaoDaNuvem(avaliacaoId) {
  const [avaliacao] = await api(`sicep_avaliacoes?id=eq.${avaliacaoId}&select=*&limit=1`) || [];
  if (!avaliacao) return null;
  const questoes = await api(`sicep_questoes?avaliacao_id=eq.${avaliacaoId}&select=*&order=numero.asc`) || [];
  return {
    avaliacao,
    questoes,
    impressao: impressaoDaAvaliacao(avaliacao, questoes),
    resumo: {
      titulo: avaliacao.titulo || '',
      descricao: avaliacao.descricao || '',
      valor_total: Number(avaliacao.valor_total || 0),
      data_aplicacao: avaliacao.data_aplicacao || null,
      trimestre: avaliacao.trimestre != null ? Number(avaliacao.trimestre) : null,
      turmas_ids: avaliacao.turmas_ids || [],
      questoes: questoes.map((q) => ({
        numero: Number(q.numero), valor: Number(q.valor || 0),
        gabarito: q.gabarito || null, enunciado: q.enunciado || '', anulada: !!q.anulada,
        habilidade_bncc: normalizarCodigos(q.habilidade_bncc),
      })),
    },
  };
}

/**
 * Aplica uma edição feita no aparelho (Etapa 6F).
 * - Antes de gravar, lê a versão da nuvem e compara com `base_versao` (a que o professor
 *   tinha quando editou). Se mudou e não foi pedido `forcar`, lança erro `CONFLITO` trazendo
 *   a versão do servidor: nada é sobrescrito e as duas versões ficam disponíveis.
 * - `trimestre_travado`: notas já enviadas ao SIDED+; o trimestre não é alterado.
 * - `remover_questoes: false`: notas já enviadas; nenhuma questão é apagada (preserva vínculos).
 * - Questões mantêm o id e os vínculos: só mudam os campos; números novos são inseridos com
 *   id estável gerado no aparelho (repetir não duplica).
 */
export async function aplicarEdicaoAvaliacao({
  avaliacao_id, patch, questoes, num_alternativas, codigo_caderno, professor_id, escola_id,
  base_versao, forcar = false, trimestre_travado = false, remover_questoes = true,
}) {
  const servidor = await lerAvaliacaoDaNuvem(avaliacao_id);
  if (!servidor) {
    const e = new Error('Esta avaliação não existe mais na nuvem.');
    e.status = 404;
    throw e;
  }
  if (!forcar && base_versao && base_versao !== servidor.impressao) {
    const e = new Error('A avaliação foi alterada na nuvem depois do início da sua edição.');
    e.codigo = 'CONFLITO';
    e.servidor = servidor;
    throw e;
  }

  const corpo = { ...patch };
  if (trimestre_travado) delete corpo.trimestre;

  const atualizada = await atualizarAvaliacao(avaliacao_id, corpo, questoes, num_alternativas, {
    remover: remover_questoes !== false,
  });
  if (codigo_caderno) {
    await salvarLayoutCaderno({
      avaliacaoId: avaliacao_id,
      professorId: professor_id,
      escolaId: escola_id,
      codigo: codigo_caderno,
      qtdQuestoes: (questoes || []).length,
      qtdAlternativas: num_alternativas,
    });
  }
  return { avaliacao: atualizada, servidor: await lerAvaliacaoDaNuvem(avaliacao_id) };
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

/* ---------------- Participação (presente / ausente / pendente) ---------------- */

/** Participações das avaliações do professor. Falta de linha = PENDENTE. */
export async function carregarParticipacoes(usuarioId) {
  const avs = await api(`sicep_avaliacoes?professor_id=eq.${usuarioId}&select=id`) || [];
  if (!avs.length) return [];
  const ids = avs.map((a) => a.id).join(',');
  return await api(`sicep_participacao?avaliacao_id=in.(${ids})&select=*`) || [];
}

/**
 * Grava a participação de um aluno SEM sobrescrever alteração mais nova da nuvem.
 * Uma linha por (avaliação, aluno, turma): a chave única impede duplicidade.
 *  1) PATCH condicionado a `atualizado_em <= o deste aparelho` (atômico no servidor);
 *  2) sem linha para atualizar: cria, ignorando duplicata criada por outro aparelho no meio;
 *  3) ainda sem retorno: a nuvem tem versão mais nova; devolve ela, sem alterar nada.
 * Devolve { aplicado, linha }. Repetir o envio é seguro.
 */
export async function gravarParticipacaoSemSobrescrever(reg, { zerarEnvio = false } = {}) {
  const filtro = `avaliacao_id=eq.${reg.avaliacao_id}&aluno_id=eq.${reg.aluno_id}&turma_id=eq.${reg.turma_id}`;
  const corpo = { situacao: reg.situacao, atualizado_em: reg.atualizado_em, atualizado_por: reg.atualizado_por };
  if (zerarEnvio) corpo.enviado_sided_em = null;

  const atualizadas = await api(
    `sicep_participacao?${filtro}&atualizado_em=lte.${encodeURIComponent(reg.atualizado_em)}`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(corpo) }
  ) || [];
  if (atualizadas.length) return { aplicado: true, linha: atualizadas[0] };

  const criadas = await api('sicep_participacao?on_conflict=avaliacao_id,aluno_id,turma_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      id: reg.id,
      avaliacao_id: reg.avaliacao_id,
      aluno_id: reg.aluno_id,
      turma_id: reg.turma_id,
      ...corpo,
    }),
  }) || [];
  if (criadas.length) return { aplicado: true, linha: criadas[0] };

  const [servidor] = await api(`sicep_participacao?${filtro}&select=*&limit=1`) || [];
  return { aplicado: false, linha: servidor || null };
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

/**
 * Grava um resultado da fila de sincronização (Etapa 6D), idempotente pelo `id`
 * gerado no aparelho — repetir a mesma operação nunca cria outra linha:
 * - já existe linha com este id (tentativa anterior chegou, ou é uma releitura):
 *   atualiza essa mesma linha, só se algum campo mudou;
 * - não existe: cria via salvarResultado (6C), que também barra um segundo
 *   resultado do mesmo aluno/avaliação/turma com outro id (RESULTADO_DUPLICADO).
 * Nunca toca em enviado_sided_em: o que já foi ao SIDED+ continua marcado.
 */
export async function gravarResultadoIdempotente(registro) {
  if (!registro?.id) throw new Error('Resultado sem id: não dá para gravar de forma idempotente.');
  const [porId] = await api(`sicep_resultados?id=eq.${registro.id}&select=*&limit=1`) || [];
  if (!porId) return salvarResultado(registro);

  const { id, ...corpo } = registro;
  const mudou = Object.keys(corpo).some((k) => JSON.stringify(porId[k] ?? null) !== JSON.stringify(corpo[k] ?? null));
  if (!mudou) return porId;
  const [atual] = await api(`sicep_resultados?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(corpo),
  }) || [];
  // PATCH sem linha de volta = a linha sumiu entre a leitura e a gravação: recria com o mesmo id.
  return atual || salvarResultado(registro);
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
  const jaIguais = [];
  if (!criada && items.length) {
    const ids = items.map((i) => i.aluno_id).join(',');
    const linhas = await api(
      `notas?avaliacao_id=eq.${sided.id}&aluno_id=in.(${ids})&select=aluno_id,nota,ausente`
    ) || [];
    linhas.forEach((l) => existentes.set(l.aluno_id, l));
    itensGravar = items.filter((i) => {
      const linha = existentes.get(i.aluno_id);
      if (!linha) return true;
      // Ausência sem nota (controle de participação): nunca por cima de nota já lançada.
      if (i.nota == null) {
        if (linha.ausente) { jaIguais.push(i.aluno_id); return false; }
        if (linha.nota == null) return true;
        conflitos.push(i.aluno_id);
        return false;
      }
      const atual = linha.nota;
      if (atual == null) return true;
      if (Math.abs(Number(atual) - Number(i.nota)) < 0.005) { jaIguais.push(i.aluno_id); return false; }
      conflitos.push(i.aluno_id);
      return false;
    });
  }

  const notas = itensGravar.map((i) => ({
    avaliacao_id: sided.id,
    aluno_id: i.aluno_id,
    nota: i.nota,
    ausente: i.situacao === 'ausente',
    // Ausência vinda do controle de participação vai como AUSENTE e NÃO REALIZADO.
    nao_realizado: i.nao_realizado === true || ['abstencao', 'nao_entregue'].includes(i.situacao),
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

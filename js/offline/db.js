/* ============================================================
   SICEP+ · Armazenamento local (IndexedDB) — Etapa 6B

   Guarda uma CÓPIA dos dados que vieram do Supabase e a sessão
   autenticada, para o app reabrir sem internet.

   - O Supabase continua sendo a fonte oficial: aqui só há cache.
   - Cada linha leva `usuario_id`; toda leitura/gravação/limpeza
     filtra por ele (isolamento entre usuários no mesmo aparelho).
   - Nada de fila de sincronização nem escrita offline (etapa futura).
   - Se o IndexedDB não existir ou falhar, as funções devolvem
     null/false e o app segue funcionando só online.
   ============================================================ */

const NOME_BANCO = 'sicep-offline';
const VERSAO_BANCO = 1;
export const VERSAO_ESQUEMA = 1;

// Lojas de dados por usuário. Chave da linha: `${usuario_id}|${id}`.
export const LOJAS = [
  'meta', 'turmas', 'disciplinas', 'professores',
  'turma_disciplinas', 'alunos', 'avaliacoes', 'questoes', 'resultados',
];
const LOJA_SESSAO = 'sessao'; // um único registro: id = 'atual'

let abertura = null;

function aoRedor(req) {
  return new Promise((ok, falha) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
}

function fimDaTransacao(tx) {
  return new Promise((ok, falha) => {
    tx.oncomplete = () => ok(true);
    tx.onerror = () => falha(tx.error);
    tx.onabort = () => falha(tx.error || new Error('Transação cancelada.'));
  });
}

export function disponivel() {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch (e) { return false; }
}

/** Abre (e cria, se preciso) o banco. Devolve null se o IndexedDB não estiver disponível. */
export function abrir() {
  if (abertura) return abertura;
  if (!disponivel()) return Promise.resolve(null);

  abertura = new Promise((ok) => {
    let req;
    try { req = indexedDB.open(NOME_BANCO, VERSAO_BANCO); } catch (e) { ok(null); return; }

    req.onupgradeneeded = () => {
      const idb = req.result;
      LOJAS.forEach((nome) => {
        if (!idb.objectStoreNames.contains(nome)) {
          const loja = idb.createObjectStore(nome, { keyPath: 'k' });
          loja.createIndex('usuario_id', 'usuario_id', { unique: false });
        }
      });
      if (!idb.objectStoreNames.contains(LOJA_SESSAO)) idb.createObjectStore(LOJA_SESSAO, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const idb = req.result;
      // Outra aba pediu atualização do esquema: solta a conexão.
      idb.onversionchange = () => { idb.close(); abertura = null; };
      ok(idb);
    };
    req.onerror = () => { console.warn('[SICEP+] IndexedDB indisponível:', req.error); ok(null); };
    req.onblocked = () => console.warn('[SICEP+] IndexedDB bloqueado por outra aba.');
  }).then((idb) => { if (!idb) abertura = null; return idb; });

  return abertura;
}

const chave = (usuarioId, id) => `${usuarioId}|${id}`;

/* ---------------- Leitura e gravação simples ---------------- */

/** Grava (ou substitui) uma linha de um usuário. */
export async function gravar(loja, usuarioId, id, dados) {
  const idb = await abrir();
  if (!idb) return false;
  try {
    const tx = idb.transaction(loja, 'readwrite');
    tx.objectStore(loja).put({ k: chave(usuarioId, id), usuario_id: usuarioId, dados });
    await fimDaTransacao(tx);
    return true;
  } catch (e) {
    console.warn('[SICEP+] gravar', loja, e);
    return false;
  }
}

/** Lê uma linha de um usuário (ou null). */
export async function ler(loja, usuarioId, id) {
  const idb = await abrir();
  if (!idb) return null;
  try {
    const linha = await aoRedor(idb.transaction(loja, 'readonly').objectStore(loja).get(chave(usuarioId, id)));
    return linha && linha.usuario_id === usuarioId ? linha.dados : null;
  } catch (e) {
    console.warn('[SICEP+] ler', loja, e);
    return null;
  }
}

/** Lista todas as linhas de um usuário em uma loja. */
export async function listar(loja, usuarioId) {
  const idb = await abrir();
  if (!idb) return [];
  try {
    const linhas = await aoRedor(
      idb.transaction(loja, 'readonly').objectStore(loja).index('usuario_id').getAll(IDBKeyRange.only(usuarioId))
    );
    return linhas.map((l) => l.dados);
  } catch (e) {
    console.warn('[SICEP+] listar', loja, e);
    return [];
  }
}

/* ---------------- Cache dos dados do Supabase ---------------- */

function apagarDoUsuario(loja, usuarioId) {
  return new Promise((ok, falha) => {
    const req = loja.index('usuario_id').openKeyCursor(IDBKeyRange.only(usuarioId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { ok(); return; }
      loja.delete(cursor.primaryKey);
      cursor.continue();
    };
    req.onerror = () => falha(req.error);
  });
}

/**
 * Substitui, numa única transação, todo o cache do usuário pelo retrato novo.
 * Se algo falhar, a transação é cancelada e o cache anterior continua intacto.
 *
 * `dados`: { sessao, recursos, turmas, disciplinas, professores, turma_disciplinas,
 *            alunos, avaliacoes (com questoes), resultados }
 */
export async function salvarCache(usuarioId, dados) {
  const idb = await abrir();
  if (!idb || usuarioId == null) return false;
  try {
    const tx = idb.transaction(LOJAS, 'readwrite');
    const lojas = Object.fromEntries(LOJAS.map((n) => [n, tx.objectStore(n)]));
    const pronto = fimDaTransacao(tx);

    await Promise.all(LOJAS.map((n) => apagarDoUsuario(lojas[n], usuarioId)));

    const poe = (nome, id, valor) => lojas[nome].put({ k: chave(usuarioId, id), usuario_id: usuarioId, dados: valor });

    (dados.turmas || []).forEach((x) => poe('turmas', x.id, x));
    (dados.disciplinas || []).forEach((x) => poe('disciplinas', x.id, x));
    (dados.professores || []).forEach((x) => poe('professores', x.id, x));
    (dados.turma_disciplinas || []).forEach((x) => poe('turma_disciplinas', x.id, x));
    (dados.alunos || []).forEach((x) => poe('alunos', x.id, x));
    (dados.resultados || []).forEach((x) => poe('resultados', x.id, x));
    (dados.avaliacoes || []).forEach((av) => {
      const { questoes, ...semQuestoes } = av;
      poe('avaliacoes', av.id, semQuestoes);
      (questoes || []).forEach((q) => poe('questoes', `${av.id}|${q.numero}`, { ...q, avaliacao_id: av.id }));
    });

    poe('meta', 'cache', {
      esquema: VERSAO_ESQUEMA,
      atualizado_em: new Date().toISOString(),
      sessao: dados.sessao,
      recursos: dados.recursos,
    });

    await pronto;
    return true;
  } catch (e) {
    console.warn('[SICEP+] salvarCache', e);
    return false;
  }
}

/** Lê o cache do usuário. Devolve null se não existir ou for de um esquema desconhecido. */
export async function lerCache(usuarioId) {
  const meta = await ler('meta', usuarioId, 'cache');
  if (!meta || meta.esquema !== VERSAO_ESQUEMA || !meta.sessao || meta.sessao.usuario_id !== usuarioId) return null;

  const [turmas, disciplinas, professores, turma_disciplinas, alunos, avaliacoes, questoes, resultados] = await Promise.all(
    ['turmas', 'disciplinas', 'professores', 'turma_disciplinas', 'alunos', 'avaliacoes', 'questoes', 'resultados']
      .map((n) => listar(n, usuarioId))
  );

  const porAvaliacao = new Map();
  questoes.forEach((q) => {
    const { avaliacao_id: avId, ...resto } = q;
    if (!porAvaliacao.has(avId)) porAvaliacao.set(avId, []);
    porAvaliacao.get(avId).push(resto);
  });
  const avaliacoesCompletas = avaliacoes.map((av) => ({
    ...av,
    questoes: (porAvaliacao.get(av.id) || []).sort((a, b) => a.numero - b.numero),
  }));

  return {
    atualizado_em: meta.atualizado_em,
    recursos: meta.recursos || {},
    db: {
      sessao: meta.sessao,
      turmas, disciplinas, professores, turma_disciplinas, alunos,
      avaliacoes: avaliacoesCompletas,
      resultados,
      scans: [], fila: [], erros: [],
    },
  };
}

/** Remove todo o cache de um usuário (não mexe nos dados de outros usuários). */
export async function limparCache(usuarioId) {
  const idb = await abrir();
  if (!idb || usuarioId == null) return false;
  try {
    const tx = idb.transaction(LOJAS, 'readwrite');
    const pronto = fimDaTransacao(tx);
    await Promise.all(LOJAS.map((n) => apagarDoUsuario(tx.objectStore(n), usuarioId)));
    await pronto;
    return true;
  } catch (e) {
    console.warn('[SICEP+] limparCache', e);
    return false;
  }
}

/** Remove o cache de TODOS os usuários, exceto o informado (aparelho compartilhado). */
export async function limparCacheDeOutros(usuarioIdAtual) {
  const idb = await abrir();
  if (!idb) return false;
  try {
    const ids = new Set();
    const tx0 = idb.transaction('meta', 'readonly');
    const todas = await aoRedor(tx0.objectStore('meta').getAll());
    todas.forEach((l) => { if (l.usuario_id !== usuarioIdAtual) ids.add(l.usuario_id); });
    for (const id of ids) await limparCache(id);
    return true;
  } catch (e) {
    console.warn('[SICEP+] limparCacheDeOutros', e);
    return false;
  }
}

/* ---------------- Sessão persistida ---------------- */

/**
 * `sessao`: { usuario_id, usuario:{id,nome,role,escola_id}, professor:{id,nome,escola_id}, criado_em, expira_em }
 * Só campos mínimos: nunca senha, hash nem dados de contato.
 */
export async function gravarSessao(sessao) {
  const idb = await abrir();
  if (!idb) return false;
  try {
    const tx = idb.transaction(LOJA_SESSAO, 'readwrite');
    tx.objectStore(LOJA_SESSAO).put({ id: 'atual', ...sessao });
    await fimDaTransacao(tx);
    return true;
  } catch (e) {
    console.warn('[SICEP+] gravarSessao', e);
    return false;
  }
}

export async function lerSessao() {
  const idb = await abrir();
  if (!idb) return null;
  try {
    return (await aoRedor(idb.transaction(LOJA_SESSAO, 'readonly').objectStore(LOJA_SESSAO).get('atual'))) || null;
  } catch (e) {
    console.warn('[SICEP+] lerSessao', e);
    return null;
  }
}

export async function apagarSessao() {
  const idb = await abrir();
  if (!idb) return false;
  try {
    const tx = idb.transaction(LOJA_SESSAO, 'readwrite');
    tx.objectStore(LOJA_SESSAO).delete('atual');
    await fimDaTransacao(tx);
    return true;
  } catch (e) {
    console.warn('[SICEP+] apagarSessao', e);
    return false;
  }
}

/* ============================================================
   SICEP+ · Supabase falso (PostgREST em memória) para os testes
   em Node — não faz parte do app.

   Cobre apenas as chamadas usadas por js/nuvem.js:
   GET com filtros eq./in./limit/order e embeds simples,
   POST com ignore-duplicates/merge-duplicates, PATCH e DELETE.
   Permite injetar falhas (HTTP 4xx antes de gravar ou "resposta
   perdida" depois de gravar) para simular rede e servidor.
   ============================================================ */

const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), {
  status,
  headers: { 'content-type': 'application/json' },
});

function semAcento(v) { return String(v ?? ''); }

export function instalarNuvemFalsa() {
  const tabelas = {};
  const falhas = [];

  const estado = {
    tabelas,
    falhas,
    /** Reinicia as tabelas com o conteúdo dado. */
    reset(novas = {}) {
      falhas.length = 0;
      Object.keys(tabelas).forEach((k) => { delete tabelas[k]; });
      const padrao = {
        turmas: [], disciplinas: [], turma_disciplinas: [], alunos: [], escolas: [],
        sicep_avaliacoes: [], sicep_questoes: [], sicep_alternativas: [],
        sicep_layouts_leitura: [], sicep_resultados: [], sicep_ocr_scans: [],
        avaliacoes: [], notas: [],
      };
      Object.entries({ ...padrao, ...novas }).forEach(([k, v]) => { tabelas[k] = structuredClone(v); });
    },
    /** Simula uma falha: { metodo, tabela, restantes, tipo: 'antes'|'depois', status }. */
    falhar(f) { falhas.push({ restantes: 1, ...f }); },
  };

  function consumir(metodo, tabela) {
    const i = falhas.findIndex((f) => f.metodo === metodo && f.tabela === tabela && f.restantes > 0);
    if (i < 0) return null;
    const f = falhas[i];
    f.restantes -= 1;
    if (f.restantes <= 0) falhas.splice(i, 1);
    return f;
  }

  function filtrar(linhas, params) {
    let out = linhas;
    for (const [chave, valor] of params.entries()) {
      if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(chave)) continue;
      if (valor.startsWith('eq.')) {
        const alvo = valor.slice(3);
        out = out.filter((l) => semAcento(l[chave]) === alvo);
      } else if (valor.startsWith('in.(')) {
        const lista = valor.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, ''));
        out = out.filter((l) => lista.includes(semAcento(l[chave])));
      } else if (valor.startsWith('ilike.')) {
        const alvo = decodeURIComponent(valor.slice(6)).toLowerCase();
        out = out.filter((l) => semAcento(l[chave]).toLowerCase() === alvo);
      }
    }
    return out;
  }

  function ordenar(linhas, params) {
    const ordem = params.get('order');
    if (!ordem) return linhas;
    const [campo, direcao = 'asc'] = ordem.split('.');
    const copia = [...linhas];
    copia.sort((a, b) => {
      const x = a[campo]; const y = b[campo];
      if (x === y) return 0;
      return (x > y ? 1 : -1) * (direcao === 'desc' ? -1 : 1);
    });
    return copia;
  }

  function comEmbeds(tabela, linhas, select) {
    const sel = select || '';
    return linhas.map((linha) => {
      const r = structuredClone(linha);
      if (tabela === 'sicep_avaliacoes' && sel.includes('sicep_questoes(')) {
        r.sicep_questoes = structuredClone(tabelas.sicep_questoes
          .filter((q) => q.avaliacao_id === r.id)
          .sort((a, b) => a.numero - b.numero));
      }
      if (tabela === 'sicep_avaliacoes' && sel.includes('sicep_layouts_leitura')) {
        r.sicep_layouts_leitura = structuredClone(tabelas.sicep_layouts_leitura.find((l) => l.id === r.layout_leitura_id)) || null;
      }
      if (tabela === 'turma_disciplinas') {
        if (sel.includes('turmas(')) r.turmas = structuredClone(tabelas.turmas.find((t) => t.id === r.turma_id)) || null;
        if (sel.includes('disciplinas(')) r.disciplinas = structuredClone(tabelas.disciplinas.find((d) => d.id === r.disciplina_id)) || null;
      }
      return r;
    });
  }

  function inserir(tabela, corpo, prefer) {
    const linhas = Array.isArray(corpo) ? corpo : [corpo];
    const inseridas = [];
    const merge = /\bmerge-duplicates\b/.test(prefer);
    const ignore = /\bignore-duplicates\b/.test(prefer);
    linhas.forEach((original) => {
      const linha = structuredClone(original);
      if (tabela === 'notas' && merge) {
        const existente = tabelas.notas.find((n) => n.avaliacao_id === linha.avaliacao_id && n.aluno_id === linha.aluno_id);
        if (existente) { Object.assign(existente, linha); inseridas.push(existente); return; }
      }
      if (linha.id != null) {
        const existente = tabelas[tabela].find((l) => l.id === linha.id);
        if (existente) {
          if (ignore) return; // já existe: não altera, não duplica
          if (merge) { Object.assign(existente, linha); inseridas.push(existente); return; }
          const e = new Error('23505 chave duplicada');
          e.status = 409;
          throw e;
        }
      }
      tabelas[tabela].push(linha);
      inseridas.push(linha);
    });
    return inseridas;
  }

  globalThis.fetch = async (entrada, opcoes = {}) => {
    const url = new URL(String(entrada));
    const metodo = String(opcoes.method || 'GET').toUpperCase();
    const casamento = url.pathname.match(/\/rest\/v1\/([^/]+)$/);
    if (!casamento) return json([], 200);
    const tabela = decodeURIComponent(casamento[1]);
    if (!tabelas[tabela]) tabelas[tabela] = [];
    const params = url.searchParams;
    const prefer = String(opcoes.headers?.Prefer || '');

    const falha = consumir(metodo, tabela);
    const aplicarFalhaAntes = () => {
      if (!falha) return null;
      if (falha.tipo === 'antes') {
        if (falha.status) return json({ message: 'recusado pelo teste' }, falha.status);
        throw new TypeError('fetch failed');
      }
      return null;
    };
    const respostaFalha = aplicarFalhaAntes();
    if (respostaFalha) return respostaFalha;

    let corpo = null;
    if (opcoes.body) {
      try { corpo = JSON.parse(opcoes.body); } catch (e) { corpo = null; }
    }

    let resultado;
    if (metodo === 'GET') {
      let linhas = filtrar(tabelas[tabela], params);
      linhas = ordenar(linhas, params);
      const limite = Number(params.get('limit'));
      if (limite > 0) linhas = linhas.slice(0, limite);
      resultado = comEmbeds(tabela, linhas, params.get('select'));
    } else if (metodo === 'POST') {
      resultado = inserir(tabela, corpo, prefer);
    } else if (metodo === 'PATCH') {
      const linhas = filtrar(tabelas[tabela], params);
      linhas.forEach((l) => Object.assign(l, structuredClone(corpo)));
      resultado = structuredClone(linhas);
    } else if (metodo === 'DELETE') {
      const remover = new Set(filtrar(tabelas[tabela], params));
      tabelas[tabela] = tabelas[tabela].filter((l) => !remover.has(l));
      resultado = [];
    } else {
      resultado = [];
    }

    // Resposta perdida: a gravação já aconteceu, mas a rede cai antes da resposta.
    if (falha && falha.tipo === 'depois') throw new TypeError('fetch failed (resposta perdida)');

    if (metodo === 'POST' && !/representation/.test(prefer)) return json([]);
    return json(resultado);
  };

  return estado;
}

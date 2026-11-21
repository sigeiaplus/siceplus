/* ============================================================
   SICEP+ · Etapa 4C — Desempenho por habilidade

   Cálculo puro (sem DOM, sem rede) a partir do que já está em
   memória/cache: avaliações com questoes.habilidade_bncc,
   resultados corrigidos e habilidades do planejamento (SIDED+).

   Regras (as mesmas da correção existente):
   - Questão anulada não entra (nem a favor, nem contra).
   - Resposta em branco/incorreta conta como erro, como em
     `calcularCorrecao` (questão não anulada, resposta diferente
     do gabarito).
   - Questão com várias habilidades conta o resultado para cada
     uma delas — uma vez por aluno/questão/habilidade.
   - Só entram resultados confirmados (status 'confirmado') e com
     situação 'normal'; os demais são apenas contabilizados no
     resumo para a tela avisar.
   ============================================================ */

export const FAIXAS = { dominio: 80, atencao: 60 };

const arred1 = (n) => Math.round(Number(n) * 10) / 10;

/** Códigos de uma questão ("EF06MA01, EF06MA03") sem vazios nem repetição. */
export function codigosDaQuestao(questao) {
  const vistos = new Set();
  const saida = [];
  String(questao?.habilidade_bncc ?? '')
    .split(',')
    .forEach((bruto) => {
      const codigo = bruto.trim();
      if (!codigo || vistos.has(codigo)) return;
      vistos.add(codigo);
      saida.push(codigo);
    });
  return saida;
}

/** Acertos ÷ (acertos + erros), em %. null quando não houve resposta contabilizada. */
export function percentualDe(acertos, erros) {
  const total = Number(acertos || 0) + Number(erros || 0);
  if (total <= 0) return null;
  return arred1((Number(acertos || 0) / total) * 100);
}

export function faixaDe(percentual) {
  if (percentual == null) return null;
  if (percentual >= FAIXAS.dominio) return 'verde';
  if (percentual >= FAIXAS.atencao) return 'amarelo';
  return 'vermelho';
}

/** Descrição/temas por código, juntando todas as turmas do planejamento. */
function catalogoDe(habilidades) {
  const mapa = new Map();
  (habilidades || []).forEach((h) => {
    const codigo = String(h?.codigo || '').trim();
    if (!codigo) return;
    const atual = mapa.get(codigo);
    if (!atual) {
      mapa.set(codigo, {
        descricao: String(h.descricao || ''),
        temas: Array.isArray(h.temas) ? [...h.temas] : [],
      });
      return;
    }
    if (!atual.descricao && h.descricao) atual.descricao = String(h.descricao);
    (Array.isArray(h.temas) ? h.temas : []).forEach((t) => {
      if (!atual.temas.includes(t)) atual.temas.push(t);
    });
  });
  return mapa;
}

/**
 * Calcula o relatório de desempenho.
 * @param {{avaliacoes?:Array, resultados?:Array, habilidades?:Array}} dados  (store.get())
 * @param {{avaliacaoId?:string, turmaId?:string, trimestre?:number|string}} filtro
 *        'todas'/'todos'/''/null/undefined = sem filtro.
 */
export function calcular(dados, filtro = {}) {
  const avaliacoes = dados?.avaliacoes || [];
  const resultados = dados?.resultados || [];
  const catalogo = catalogoDe(dados?.habilidades);

  const avaliacaoId = filtro.avaliacaoId && filtro.avaliacaoId !== 'todas' ? String(filtro.avaliacaoId) : null;
  const turmaId = filtro.turmaId && filtro.turmaId !== 'todas' ? String(filtro.turmaId) : null;
  const triBruto = filtro.trimestre;
  const trimestre = triBruto == null || triBruto === '' || triBruto === 'todos' ? null : Number(triBruto);

  const avaliacoesEscopo = avaliacoes.filter((av) => {
    if (avaliacaoId && av.id !== avaliacaoId) return false;
    if (trimestre != null && Number(av.trimestre) !== trimestre) return false;
    if (turmaId && !(av.aplicacoes || []).some((a) => a.turma_id === turmaId)) return false;
    return true;
  });
  const avaliacaoPorId = new Map(avaliacoesEscopo.map((av) => [av.id, av]));

  const habilidades = new Map();
  const garantirHabilidade = (codigo) => {
    let h = habilidades.get(codigo);
    if (!h) {
      h = { codigo, questoes: new Set(), acertos: 0, erros: 0, alunos: new Set() };
      habilidades.set(codigo, h);
    }
    return h;
  };

  // 1) Questões relacionadas: distintas por avaliação/número, anuladas fora.
  avaliacoesEscopo.forEach((av) => {
    (av.questoes || []).forEach((q) => {
      if (q.anulada) return;
      codigosDaQuestao(q).forEach((codigo) => {
        garantirHabilidade(codigo).questoes.add(`${av.id}|${q.numero}`);
      });
    });
  });

  // 2) Resultados: cada aluno/questão/habilidade conta uma única vez.
  const alunos = new Map();
  const contados = new Set();
  const questoesContadas = new Set();
  let emRevisao = 0;
  let foraDoCalculo = 0;

  resultados.forEach((r) => {
    const av = avaliacaoPorId.get(r.avaliacao_id);
    if (!av) return;
    if (turmaId && r.turma_id !== turmaId) return;
    if ((r.situacao || 'normal') !== 'normal') { foraDoCalculo += 1; return; }
    if (r.status !== 'confirmado') { emRevisao += 1; return; }

    const respostas = r.respostas || {};
    let aluno = alunos.get(r.aluno_id);
    if (!aluno) {
      aluno = { aluno_id: r.aluno_id, acertos: 0, erros: 0, habilidades: new Map() };
      alunos.set(r.aluno_id, aluno);
    }

    (av.questoes || []).forEach((q) => {
      if (q.anulada) return;
      const codigos = codigosDaQuestao(q);
      if (!codigos.length) return;

      // O resumo geral conta a RESPOSTA uma vez; só a estatística por habilidade
      // repete o resultado para cada código vinculado à questão.
      const chaveQuestao = `${r.avaliacao_id}|${r.aluno_id}|${q.numero}`;
      if (questoesContadas.has(chaveQuestao)) return;
      questoesContadas.add(chaveQuestao);

      const marcada = respostas[q.numero];
      const acertou = marcada != null && marcada !== '' && marcada === q.gabarito;
      if (acertou) aluno.acertos += 1;
      else aluno.erros += 1;

      codigos.forEach((codigo) => {
        const chave = `${r.avaliacao_id}|${r.aluno_id}|${q.numero}|${codigo}`;
        if (contados.has(chave)) return;
        contados.add(chave);

        const h = garantirHabilidade(codigo);
        let doAluno = aluno.habilidades.get(codigo);
        if (!doAluno) {
          doAluno = { acertos: 0, erros: 0 };
          aluno.habilidades.set(codigo, doAluno);
        }

        if (acertou) {
          h.acertos += 1;
          doAluno.acertos += 1;
        } else {
          h.erros += 1;
          doAluno.erros += 1;
        }
        h.alunos.add(r.aluno_id);
      });
    });
  });

  const montarHabilidade = (codigo, dadosHabilidade) => {
    const info = catalogo.get(codigo) || {};
    const pct = percentualDe(dadosHabilidade.acertos, dadosHabilidade.erros);
    return {
      codigo,
      descricao: info.descricao || '',
      temas: info.temas || [],
      acertos: dadosHabilidade.acertos,
      erros: dadosHabilidade.erros,
      total: dadosHabilidade.acertos + dadosHabilidade.erros,
      percentual: pct,
      faixa: faixaDe(pct),
      dominio: pct != null && pct >= FAIXAS.dominio,
      precisaReforco: pct != null && pct < FAIXAS.atencao,
    };
  };

  const listaHabilidades = [...habilidades.values()]
    .map((h) => ({
      ...montarHabilidade(h.codigo, h),
      questoes: h.questoes.size,
      alunos: h.alunos.size,
    }))
    .sort((a, b) => {
      const pa = a.percentual == null ? 101 : a.percentual;
      const pb = b.percentual == null ? 101 : b.percentual;
      return pa - pb || a.codigo.localeCompare(b.codigo, 'pt-BR');
    });

  const listaAlunos = [...alunos.values()].map((a) => {
    const avaliadas = [...a.habilidades.entries()]
      .map(([codigo, s]) => montarHabilidade(codigo, s))
      .sort((x, y) => {
        const px = x.percentual == null ? 101 : x.percentual;
        const py = y.percentual == null ? 101 : y.percentual;
        return px - py || x.codigo.localeCompare(y.codigo, 'pt-BR');
      });
    const dificuldades = avaliadas.filter((h) => h.percentual != null && h.percentual < FAIXAS.atencao);
    return {
      aluno_id: a.aluno_id,
      acertos: a.acertos,
      erros: a.erros,
      total: a.acertos + a.erros,
      percentual: percentualDe(a.acertos, a.erros),
      habilidades: avaliadas,
      dificuldades,
      maiorDificuldade: dificuldades[0]?.codigo || null,
    };
  });

  const acertos = listaAlunos.reduce((s, a) => s + a.acertos, 0);
  const erros = listaAlunos.reduce((s, a) => s + a.erros, 0);
  const questoesComHabilidade = new Set();
  [...habilidades.values()].forEach((h) => h.questoes.forEach((k) => questoesComHabilidade.add(k)));

  return {
    avaliacoes: avaliacoesEscopo.map((a) => a.id),
    habilidades: listaHabilidades,
    alunos: listaAlunos,
    resumo: {
      alunosAvaliados: listaAlunos.length,
      habilidadesAvaliadas: listaHabilidades.length,
      questoesComHabilidade: questoesComHabilidade.size,
      acertos,
      erros,
      percentual: percentualDe(acertos, erros),
      emRevisao,
      foraDoCalculo,
    },
  };
}

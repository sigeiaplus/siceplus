import * as store from '../store.js';
import { calcular, codigosDaQuestao, faixaDe, FAIXAS } from '../desempenho.js';
import {
  el, esc, icon, badge, barraDesempenho, fmtNota, iniciais, reagirEnquantoVisivel,
} from '../ui.js';

/**
 * Desempenho por habilidade.
 *
 * Fluxo igual ao de Resultados: primeiro escolhe a avaliação e a turma, só então aparece o
 * relatório. O relatório usa apenas as habilidades vinculadas às questões DA PROVA escolhida.
 *
 * Tudo é calculado localmente com o que já está no app (nuvem ou cópia do aparelho), então
 * funciona offline e nada aqui grava na nuvem.
 *
 * Desempenho de tela: o cálculo roda uma vez por escolha (avaliação/turma) ou quando a
 * sincronização muda os dados. Trocar de aba, filtrar, buscar e abrir aluno só redesenha a
 * parte afetada, sem recalcular nem refazer o cabeçalho.
 */

// A escolha vale enquanto o app estiver aberto (sobrevive a sair e voltar da tela).
// Recarregar a página é sessão nova e pergunta de novo; "Alterar" também.
let escolhaSessao = null;   // { avaliacaoId, turmaId: 'todas' | id }

const NIVEIS = [
  { id: 'todas', rotulo: 'Todas' },
  { id: 'reforco', rotulo: 'Reforço' },
  { id: 'meio', rotulo: 'Em desenvolvimento' },
  { id: 'dominio', rotulo: 'Domínio' },
  { id: 'sem', rotulo: 'Sem resultados' },
];

const ORDENS = [
  { id: 'menor', rotulo: 'Menor aproveitamento' },
  { id: 'maior', rotulo: 'Maior aproveitamento' },
  { id: 'nome', rotulo: 'Nome (A–Z)' },
];

const nivelDe = (h) => {
  if (h.percentual == null) return 'sem';
  if (h.precisaReforco) return 'reforco';
  if (h.dominio) return 'dominio';
  return 'meio';
};

const corDaFaixa = (faixa) => (
  faixa === 'verde' ? 'var(--ok)' : faixa === 'amarelo' ? 'var(--warn)' : faixa === 'vermelho' ? 'var(--err)' : 'var(--ink-3)'
);

const pctTexto = (p) => (p == null ? '—' : `${fmtNota(p)}%`);

/** Códigos distintos de habilidade vinculados às questões (não anuladas) de uma avaliação. */
function habilidadesDaProva(av) {
  const codigos = new Set();
  (av?.questoes || []).forEach((q) => {
    if (q.anulada) return;
    codigosDaQuestao(q).forEach((c) => codigos.add(c));
  });
  return codigos;
}

export default function desempenho() {
  const root = el('<div class="des-root"></div>');

  const st = {
    avaliacaoId: escolhaSessao?.avaliacaoId || null,   // null = ainda não escolheu
    turmaId: escolhaSessao?.turmaId || 'todas',
    rascunho: { avaliacaoId: '', turmaId: 'todas' },
    modo: 'habilidades',   // 'habilidades' | 'alunos'
    nivel: 'todas',        // filtro da aba de habilidades
    busca: '',             // busca da aba de alunos
    ordem: 'menor',
    aberto: null,          // aluno expandido
  };

  let rel = null;          // relatório calculado (null = precisa recalcular)

  const nomeAluno = (id) => store.aluno(id)?.nome_completo || '—';

  function relatorio() {
    if (!rel) rel = calcular(store.get(), { avaliacaoId: st.avaliacaoId, turmaId: st.turmaId });
    return rel;
  }

  /* ---------------- Peças ---------------- */

  function rotuloNivel(h) {
    const n = nivelDe(h);
    if (n === 'sem') return badge('Sem resultados', 'warn');
    if (n === 'dominio') return badge('Domínio', 'ok');
    if (n === 'reforco') return badge('Precisa de reforço', 'err');
    return badge('Em desenvolvimento', 'warn');
  }

  /** Cartão de uma habilidade (visão da turma ou de um aluno). */
  function cartaoHabilidade(h, extra = {}) {
    const meta = [
      extra.questoes != null ? `${extra.questoes} questão(ões)` : null,
      extra.alunos != null ? `${extra.alunos} aluno(s)` : null,
      h.temas.length ? h.temas.join(' · ') : null,
    ].filter(Boolean).join(' · ');

    return `
      <article class="des-hab ${nivelDe(h)}">
        <div class="des-hab-top">
          <span class="des-cod">${esc(h.codigo)}</span>
          ${rotuloNivel(h)}
          ${extra.maiorDificuldade ? badge('Maior dificuldade', 'err') : ''}
          <strong class="des-hab-pct" style="color:${corDaFaixa(h.faixa)}">${pctTexto(h.percentual)}</strong>
        </div>
        <p class="des-desc">${esc(h.descricao || 'Descrição não encontrada no planejamento.')}</p>
        ${h.percentual == null ? '' : barraDesempenho(h.percentual, h.faixa)}
        <div class="des-hab-foot">
          <span><strong>${h.acertos}</strong> acerto(s)</span>
          <span><strong>${h.erros}</strong> erro(s)</span>
          ${meta ? `<span class="des-meta">${esc(meta)}</span>` : ''}
        </div>
      </article>`;
  }

  /* ---------------- Escolha inicial: avaliação e turma ---------------- */

  function pintarEscolha() {
    const avs = store.avaliacoes();
    const av = avs.find((a) => a.id === st.rascunho.avaliacaoId) || null;
    const turmasDaAv = (av?.aplicacoes || [])
      .map((a) => store.turma(a.turma_id)).filter(Boolean)
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    const qtdHab = av ? habilidadesDaProva(av).size : 0;

    root.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">Desempenho</span>
        <h1>Habilidades: domínio e dificuldades</h1>
        <p>Escolha a avaliação e a turma para ver o desempenho por habilidade. Notas individuais em <a href="#/resultados">Resultados</a>.</p>
      </div>

      ${avs.length ? `
        <div class="card stack">
          <div class="field" style="margin:0">
            <label class="label" for="d-av">Avaliação</label>
            <select id="d-av" class="select" data-d-av>
              <option value="">Selecione a avaliação</option>
              ${avs.map((a) => `<option value="${esc(a.id)}" ${a.id === st.rascunho.avaliacaoId ? 'selected' : ''}>${esc(a.titulo)}</option>`).join('')}
            </select>
            ${av ? `<p class="hint">${qtdHab
              ? `${qtdHab} habilidade${qtdHab === 1 ? '' : 's'} vinculada${qtdHab === 1 ? '' : 's'} às questões desta prova.`
              : 'Nenhuma habilidade vinculada às questões desta prova ainda.'}</p>` : ''}
          </div>

          <div class="field" style="margin:0">
            <label class="label" for="d-turma">Turma</label>
            <select id="d-turma" class="select" data-d-turma ${av ? '' : 'disabled'}>
              <option value="todas">Todas as turmas</option>
              ${turmasDaAv.map((t) => `<option value="${esc(t.id)}" ${t.id === st.rascunho.turmaId ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}
            </select>
          </div>

          <button class="btn btn-primary" type="button" data-ver ${av ? '' : 'disabled'}>Ver desempenho</button>
        </div>` : `
        <div class="empty">
          <div class="ei">${icon('target', 20)}</div>
          <h3>Sem avaliações</h3>
          <p>Crie uma avaliação, vincule as habilidades às questões e corrija os cartões para ver o desempenho.</p>
          <a class="btn btn-primary" href="#/avaliacoes/nova">Nova avaliação</a>
        </div>`}
    `;

    root.querySelector('[data-d-av]')?.addEventListener('change', (e) => {
      st.rascunho.avaliacaoId = e.target.value;
      st.rascunho.turmaId = 'todas';
      pintarEscolha();
    });
    root.querySelector('[data-d-turma]')?.addEventListener('change', (e) => { st.rascunho.turmaId = e.target.value; });
    root.querySelector('[data-ver]')?.addEventListener('click', () => {
      if (!st.rascunho.avaliacaoId) return;
      st.avaliacaoId = st.rascunho.avaliacaoId;
      st.turmaId = st.rascunho.turmaId;
      escolhaSessao = { avaliacaoId: st.avaliacaoId, turmaId: st.turmaId };
      st.modo = 'habilidades';
      st.nivel = 'todas';
      st.busca = '';
      st.aberto = null;
      rel = null;
      pintar();
    });
  }

  function alterarEscolha() {
    escolhaSessao = null;
    st.rascunho = { avaliacaoId: st.avaliacaoId || '', turmaId: st.turmaId || 'todas' };
    st.avaliacaoId = null;
    st.turmaId = 'todas';
    rel = null;
    pintar();
  }

  /* ---------------- Aba: por habilidade ---------------- */

  function corpoHabilidades(r) {
    const contagem = { todas: r.habilidades.length, reforco: 0, meio: 0, dominio: 0, sem: 0 };
    r.habilidades.forEach((h) => { contagem[nivelDe(h)] += 1; });
    if (st.nivel !== 'todas' && !contagem[st.nivel]) st.nivel = 'todas';

    const lista = st.nivel === 'todas' ? r.habilidades : r.habilidades.filter((h) => nivelDe(h) === st.nivel);

    return `
      <div class="chips" role="tablist" aria-label="Filtrar habilidades">
        ${NIVEIS.filter((n) => n.id === 'todas' || contagem[n.id]).map((n) => `
          <button class="chip ${st.nivel === n.id ? 'on' : ''}" type="button" data-nivel="${n.id}">
            ${n.rotulo} <span class="des-chip-n">${contagem[n.id]}</span>
          </button>`).join('')}
      </div>
      <div class="des-grid">
        ${lista.map((h) => cartaoHabilidade(h, { questoes: h.questoes, alunos: h.alunos })).join('')}
      </div>
      <p class="xs muted">Dificuldades primeiro. Questão com mais de uma habilidade conta para cada uma delas.</p>`;
  }

  /* ---------------- Aba: por aluno ---------------- */

  function alunosVisiveis(r) {
    const termo = st.busca.trim().toLowerCase();
    const lista = r.alunos.filter((a) => !termo || nomeAluno(a.aluno_id).toLowerCase().includes(termo));
    const porNome = (a, b) => nomeAluno(a.aluno_id).localeCompare(nomeAluno(b.aluno_id), 'pt-BR');
    const pct = (a, vazio) => (a.percentual == null ? vazio : a.percentual);

    if (st.ordem === 'nome') return lista.sort(porNome);
    if (st.ordem === 'maior') return lista.sort((a, b) => pct(b, -1) - pct(a, -1) || porNome(a, b));
    return lista.sort((a, b) => pct(a, 101) - pct(b, 101) || porNome(a, b));
  }

  function linhaAluno(a) {
    const nome = nomeAluno(a.aluno_id);
    const turma = store.turma(store.aluno(a.aluno_id)?.turma_id);
    const faixa = faixaDe(a.percentual);
    const aberto = st.aberto === a.aluno_id;
    const dificuldade = a.habilidades.find((h) => h.codigo === a.maiorDificuldade) || null;

    return `
      <article class="des-aluno ${aberto ? 'aberto' : ''}">
        <button class="des-aluno-head" type="button" data-abrir="${esc(a.aluno_id)}" aria-expanded="${aberto}">
          <span class="avatar sm">${esc(iniciais(nome))}</span>
          <span class="des-aluno-nome">
            <strong>${esc(nome)}</strong>
            <span class="xs muted">${esc([turma?.nome, `${a.acertos} acerto(s)`, `${a.erros} erro(s)`].filter(Boolean).join(' · '))}</span>
          </span>
          <span class="des-aluno-pct">
            <strong style="color:${corDaFaixa(faixa)}">${pctTexto(a.percentual)}</strong>
            ${a.percentual == null ? '' : barraDesempenho(a.percentual, faixa)}
          </span>
          <span class="des-chevron" aria-hidden="true">${icon('chevron', 16)}</span>
        </button>

        ${aberto ? `
          <div class="des-aluno-corpo">
            ${dificuldade ? `
              <div class="alert err des-destaque">
                ${icon('alert', 17)}
                <span>
                  <span class="strong">Maior dificuldade: ${esc(dificuldade.codigo)} · ${pctTexto(dificuldade.percentual)}</span>
                  ${esc(dificuldade.descricao || '')} — ${dificuldade.erros} erro(s) em ${dificuldade.total} questão(ões).
                </span>
              </div>` : `
              <div class="alert ok des-destaque">
                ${icon('check', 17)}
                <span><span class="strong">Nenhuma habilidade abaixo de ${FAIXAS.atencao}%.</span> Bom desempenho no conjunto avaliado.</span>
              </div>`}
            <div class="stack" style="gap:10px">
              ${a.habilidades.length
                ? a.habilidades.map((h) => cartaoHabilidade(h, { maiorDificuldade: h.codigo === a.maiorDificuldade })).join('')
                : '<p class="xs muted">Este aluno não tem respostas em questões com habilidade nesta prova.</p>'}
            </div>
          </div>` : ''}
      </article>`;
  }

  function corpoAlunos(r) {
    if (!r.alunos.length) {
      return `
        <div class="empty">
          <div class="ei">${icon('user', 20)}</div>
          <h3>Nenhum aluno com resultado confirmado</h3>
          <p>Corrija os cartões e confirme a revisão para ver o desempenho individual.</p>
          <a class="btn btn-primary" href="#/resultados">Ir para Resultados</a>
        </div>`;
    }

    return `
      <div class="card des-alunos-filtros">
        <div class="field" style="margin:0">
          <label class="label" for="d-busca">Buscar aluno</label>
          <div class="search-box">
            ${icon('search', 16)}
            <input id="d-busca" class="input" type="search" placeholder="Nome do aluno" value="${esc(st.busca)}" data-busca />
          </div>
        </div>
        <div class="field" style="margin:0">
          <label class="label" for="d-ordem">Ordenar por</label>
          <select id="d-ordem" class="select" data-ordem>
            ${ORDENS.map((o) => `<option value="${o.id}" ${o.id === st.ordem ? 'selected' : ''}>${o.rotulo}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="stack" style="gap:8px" data-lista-alunos></div>`;
  }

  function pintarListaAlunos() {
    const alvo = root.querySelector('[data-lista-alunos]');
    if (!alvo) return;
    const lista = alunosVisiveis(relatorio());

    alvo.innerHTML = lista.length
      ? lista.map(linhaAluno).join('')
      : '<p class="xs muted">Nenhum aluno com esse nome.</p>';

    alvo.querySelectorAll('[data-abrir]').forEach((b) => {
      b.addEventListener('click', () => {
        st.aberto = st.aberto === b.dataset.abrir ? null : b.dataset.abrir;
        pintarListaAlunos();
      });
    });
  }

  /* ---------------- Corpo (troca de aba/filtros sem refazer o cabeçalho) ---------------- */

  function pintarCorpo() {
    const corpo = root.querySelector('[data-corpo]');
    if (!corpo) return;
    const r = relatorio();

    root.querySelectorAll('[data-modo]').forEach((b) => {
      const ativo = b.dataset.modo === st.modo;
      b.classList.toggle('on', ativo);
      b.setAttribute('aria-selected', String(ativo));
    });

    if (st.modo === 'alunos') {
      corpo.innerHTML = corpoAlunos(r);

      const busca = corpo.querySelector('[data-busca]');
      busca?.addEventListener('input', () => { st.busca = busca.value; pintarListaAlunos(); });
      corpo.querySelector('[data-ordem]')?.addEventListener('change', (e) => {
        st.ordem = e.target.value;
        pintarListaAlunos();
      });
      pintarListaAlunos();
      return;
    }

    corpo.innerHTML = corpoHabilidades(r);
    corpo.querySelectorAll('[data-nivel]').forEach((b) => {
      b.addEventListener('click', () => { st.nivel = b.dataset.nivel; pintarCorpo(); });
    });
  }

  /* ---------------- Render ---------------- */

  function pintar() {
    // Avaliação escolhida que deixou de existir (excluída): pergunta de novo.
    if (st.avaliacaoId && !store.avaliacao(st.avaliacaoId)) {
      escolhaSessao = null;
      st.avaliacaoId = null;
      rel = null;
    }
    if (!st.avaliacaoId) { pintarEscolha(); return; }

    const av = store.avaliacao(st.avaliacaoId);
    const turmaSel = st.turmaId !== 'todas' ? store.turma(st.turmaId) : null;
    const r = relatorio();
    const s = r.resumo;
    const reforco = r.habilidades.filter((h) => nivelDe(h) === 'reforco').length;
    const faixaGeral = faixaDe(s.percentual);

    const cabecalho = `
      <div class="page-head">
        <span class="eyebrow">Desempenho</span>
        <h1>Habilidades: domínio e dificuldades</h1>
      </div>

      <div class="card des-contexto">
        <div class="grow" style="min-width:0">
          <strong>${esc(av.titulo)}</strong>
          <span class="xs muted" style="display:block">
            ${esc([turmaSel ? turmaSel.nome : 'Todas as turmas', av.trimestre ? `${av.trimestre}º trimestre` : null].filter(Boolean).join(' · '))}
          </span>
        </div>
        <button class="btn btn-outline btn-sm" type="button" data-alterar>Alterar</button>
      </div>

      ${store.erroDeHabilidades() ? `
        <div class="alert warn">
          ${icon('alert', 16)}
          <span>As habilidades do planejamento não puderam ser atualizadas agora. As descrições podem estar incompletas; os vínculos das questões foram mantidos.</span>
        </div>` : ''}`;

    if (!r.habilidades.length) {
      root.innerHTML = `
        ${cabecalho}
        <div class="empty">
          <div class="ei">${icon('target', 20)}</div>
          <h3>Nenhuma habilidade vinculada a esta prova</h3>
          <p>As questões desta avaliação não têm habilidade do planejamento. Edite a avaliação e vincule as habilidades na etapa <strong>Questões</strong>.</p>
          <a class="btn btn-primary" href="#/avaliacoes/editar/${esc(av.id)}">Editar avaliação</a>
        </div>`;
      root.querySelector('[data-alterar]').addEventListener('click', alterarEscolha);
      return;
    }

    const dist = [
      { n: reforco, classe: 'err', rotulo: 'reforço' },
      { n: r.habilidades.filter((h) => nivelDe(h) === 'meio').length, classe: 'warn', rotulo: 'em desenvolvimento' },
      { n: r.habilidades.filter((h) => nivelDe(h) === 'dominio').length, classe: 'ok', rotulo: 'domínio' },
      { n: r.habilidades.filter((h) => nivelDe(h) === 'sem').length, classe: 'none', rotulo: 'sem resultados' },
    ].filter((d) => d.n > 0);

    root.innerHTML = `
      ${cabecalho}

      <div class="des-kpis">
        <div class="kpi"><div class="kv" style="color:${corDaFaixa(faixaGeral)}">${pctTexto(s.percentual)}</div><div class="kl">Aproveitamento geral</div></div>
        <div class="kpi"><div class="kv">${s.alunosAvaliados}</div><div class="kl">Alunos avaliados</div></div>
        <div class="kpi"><div class="kv">${s.habilidadesAvaliadas}</div><div class="kl">Habilidades da prova</div></div>
        <div class="kpi"><div class="kv" style="color:${reforco ? 'var(--err)' : 'var(--ink)'}">${reforco}</div><div class="kl">Precisam de reforço</div></div>
      </div>

      <div class="card stack" style="gap:8px">
        <div class="des-dist" role="img" aria-label="Distribuição das habilidades por nível de desempenho">
          ${dist.map((d) => `<span class="${d.classe}" style="flex:${d.n}"></span>`).join('')}
        </div>
        <div class="des-legenda">
          ${dist.map((d) => `<span><i class="${d.classe}"></i><strong>${d.n}</strong> ${d.rotulo}</span>`).join('')}
        </div>
        <span class="xs muted">${s.acertos} acerto(s) · ${s.erros} erro(s) em ${s.questoesComHabilidade} questão(ões) com habilidade</span>
      </div>

      ${s.emRevisao || s.foraDoCalculo ? `
        <div class="alert warn">
          ${icon('info', 16)}
          <span>
            ${s.emRevisao ? `${s.emRevisao} resultado(s) ainda não confirmado(s)` : ''}
            ${s.emRevisao && s.foraDoCalculo ? ' e ' : ''}
            ${s.foraDoCalculo ? `${s.foraDoCalculo} fora da situação “Corrigido”` : ''}
            ficaram fora do cálculo. Confirme a revisão em <a href="#/resultados">Resultados</a>.
          </span>
        </div>` : ''}

      <div class="des-abas" role="tablist" aria-label="Tipo de relatório">
        <button class="des-aba" type="button" role="tab" data-modo="habilidades">Por habilidade</button>
        <button class="des-aba" type="button" role="tab" data-modo="alunos">Por aluno <span class="des-chip-n">${s.alunosAvaliados}</span></button>
      </div>

      <div class="des-corpo" data-corpo></div>

      <p class="xs muted">
        Questões anuladas não entram no cálculo e respostas em branco contam como erro, como na correção da nota.
        Só entram resultados com revisão confirmada.
      </p>
    `;

    root.querySelector('[data-alterar]').addEventListener('click', alterarEscolha);
    root.querySelectorAll('[data-modo]').forEach((b) => {
      b.addEventListener('click', () => {
        if (st.modo === b.dataset.modo) return;
        st.modo = b.dataset.modo;
        pintarCorpo();
      });
    });
    pintarCorpo();
  }

  // Dados mudaram em segundo plano (sincronização): recalcula uma vez e redesenha.
  reagirEnquantoVisivel(root, store.aoMudarSincronizacao, () => { rel = null; pintar(); });

  pintar();
  return { node: root, destroy: () => {} };
}

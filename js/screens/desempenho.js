import * as store from '../store.js';
import { calcular, FAIXAS } from '../desempenho.js';
import {
  el, esc, icon, badge, barraDesempenho, fmtNota,
} from '../ui.js';

/**
 * Desempenho por habilidade (Etapa 4C).
 *
 * Relatório montado somente com dados já carregados no app (nuvem ou cópia local):
 * - Por turma: acertos/erros/percentual de cada habilidade vinculada às questões.
 * - Por aluno: as mesmas habilidades, com a maior dificuldade destacada.
 * Nada aqui grava na nuvem: leitura e cálculo são locais, então funciona offline.
 */
export default function desempenho() {
  const root = el('<div class="stack"></div>');
  const sessao = store.sessao();

  const st = {
    avaliacaoId: 'todas',
    turmaId: 'todas',
    trimestre: 'todos',
    modo: 'turma',
    alunoId: '',
  };

  const filtro = () => ({
    avaliacaoId: st.avaliacaoId,
    turmaId: st.turmaId,
    trimestre: st.trimestre,
  });

  const nomeAluno = (id) => store.aluno(id)?.nome_completo || '—';

  const corDaFaixa = (faixa) => (
    faixa === 'verde' ? 'var(--ok)' : faixa === 'amarelo' ? 'var(--warn)' : faixa === 'vermelho' ? 'var(--err)' : 'var(--ink-3)'
  );

  function rotuloHabilidade(h) {
    if (h.percentual == null) return badge('Sem resultados', 'warn');
    if (h.dominio) return badge('Domínio', 'ok');
    if (h.precisaReforco) return badge('Precisa de reforço', 'err');
    return badge('Em desenvolvimento', 'warn');
  }

  /** Linha de uma habilidade (turma ou aluno). */
  function linhaHabilidade(h, extra = {}) {
    const classe = h.percentual == null ? '' : h.precisaReforco ? 'reforco' : h.dominio ? 'dominio' : '';
    const pct = h.percentual == null ? '—' : `${fmtNota(h.percentual)}%`;
    return `
      <article class="des-hab ${classe}">
        <div class="des-info">
          <div class="row wrap" style="gap:6px;align-items:center">
            <span class="des-cod">${esc(h.codigo)}</span>
            ${rotuloHabilidade(h)}
            ${extra.maiorDificuldade ? badge('Maior dificuldade', 'err') : ''}
          </div>
          <p class="des-desc">${esc(h.descricao || 'Descrição não encontrada no planejamento.')}</p>
          <span class="xs muted">
            ${extra.questoes != null ? `${extra.questoes} questão(ões) · ` : ''}
            ${extra.alunos != null ? `${extra.alunos} aluno(s) · ` : ''}
            ${h.temas.length ? esc(h.temas.join(' · ')) : 'Sem temas cadastrados'}
          </span>
        </div>

        <div class="des-nums">
          <span><strong>${h.acertos}</strong> acertos</span>
          <span><strong>${h.erros}</strong> erros</span>
        </div>

        <div class="des-pct">
          <strong style="color:${corDaFaixa(h.faixa)}">${pct}</strong>
          ${h.percentual == null ? '' : barraDesempenho(h.percentual, h.faixa)}
        </div>
      </article>`;
  }

  function opcoesTurmas(avaliacoes) {
    const ids = new Set();
    avaliacoes.forEach((a) => (a.aplicacoes || []).forEach((x) => ids.add(x.turma_id)));
    return [...ids]
      .map((id) => store.turma(id))
      .filter(Boolean)
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  }

  function pintarFiltros(avaliacoes) {
    const avSel = st.avaliacaoId === 'todas' ? null : store.avaliacao(st.avaliacaoId);
    const turmas = opcoesTurmas(avSel ? [avSel] : avaliacoes);
    if (st.turmaId !== 'todas' && !turmas.some((t) => t.id === st.turmaId)) st.turmaId = 'todas';

    return `
      <div class="card des-filtros">
        <div class="field" style="margin:0">
          <label class="label" for="d-av">Avaliação</label>
          <select id="d-av" class="select" data-d-av>
            <option value="todas">Todas as avaliações</option>
            ${avaliacoes.map((a) => `<option value="${esc(a.id)}" ${a.id === st.avaliacaoId ? 'selected' : ''}>${esc(a.titulo)}</option>`).join('')}
          </select>
        </div>

        <div class="field" style="margin:0">
          <label class="label" for="d-turma">Turma</label>
          <select id="d-turma" class="select" data-d-turma>
            <option value="todas">Todas as turmas</option>
            ${turmas.map((t) => `<option value="${esc(t.id)}" ${t.id === st.turmaId ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}
          </select>
        </div>

        <div class="field" style="margin:0">
          <label class="label" for="d-tri">Trimestre</label>
          <select id="d-tri" class="select" data-d-tri>
            <option value="todos" ${st.trimestre === 'todos' ? 'selected' : ''}>Todos</option>
            ${[1, 2, 3].map((n) => `<option value="${n}" ${String(st.trimestre) === String(n) ? 'selected' : ''}>${n}º trimestre</option>`).join('')}
          </select>
        </div>
      </div>`;
  }

  function pintarRelatorioTurma(rel) {
    const r = rel.resumo;

    if (!rel.habilidades.length) {
      return `
        <div class="empty">
          <div class="ei">${icon('chart', 20)}</div>
          <h3>Nenhuma habilidade vinculada</h3>
          <p>Nenhuma questão das avaliações deste filtro tem habilidade do planejamento. Edite a avaliação e vincule as habilidades na etapa <strong>Questões</strong>.</p>
          <a class="btn btn-outline" href="#/avaliacoes">Ver avaliações</a>
        </div>`;
    }

    return `
      <div class="res-kpis">
        <div class="kpi"><div class="kv">${r.alunosAvaliados}</div><div class="kl">Alunos avaliados</div></div>
        <div class="kpi"><div class="kv">${r.habilidadesAvaliadas}</div><div class="kl">Habilidades avaliadas</div></div>
        <div class="kpi"><div class="kv">${r.percentual == null ? '—' : fmtNota(r.percentual) + '%'}</div><div class="kl">Aproveitamento geral</div></div>
      </div>

      <div class="card row between wrap" style="gap:10px;align-items:center">
        <span class="xs muted">${r.acertos} acerto(s) · ${r.erros} erro(s) em ${r.questoesComHabilidade} questão(ões) com habilidade</span>
        <span class="badge ${r.percentual == null ? '' : r.percentual >= FAIXAS.dominio ? 'ok' : r.percentual >= FAIXAS.atencao ? 'warn' : 'err'}">
          ${r.percentual == null ? 'Sem resultados confirmados' : `Média ${fmtNota(r.percentual)}%`}
        </span>
      </div>

      ${r.emRevisao || r.foraDoCalculo ? `
        <div class="alert warn">
          ${icon('info', 16)}
          <span>
            ${r.emRevisao ? `${r.emRevisao} resultado(s) ainda não confirmado(s)` : ''}
            ${r.emRevisao && r.foraDoCalculo ? ' e ' : ''}
            ${r.foraDoCalculo ? `${r.foraDoCalculo} fora da situação “Corrigido”` : ''}
            ficaram fora do cálculo. Confirme a revisão em <a href="#/resultados">Resultados</a>.
          </span>
        </div>` : ''}

      <section class="card stack" style="gap:10px">
        <div class="card-head" style="margin:0">
          <h2>Desempenho por habilidade</h2>
          <span class="xs muted">Dificuldades primeiro</span>
        </div>
        ${rel.habilidades.map((h) => linhaHabilidade(h, { questoes: h.questoes, alunos: h.alunos })).join('')}
      </section>`;
  }

  function pintarRelatorioAluno(rel) {
    if (!rel.alunos.length) {
      return `
        <div class="empty">
          <div class="ei">${icon('user', 20)}</div>
          <h3>Nenhum aluno com resultado confirmado</h3>
          <p>Corrija os cartões e confirme a revisão para ver o desempenho individual.</p>
          <a class="btn btn-primary" href="#/resultados">Ir para Resultados</a>
        </div>`;
    }

    const ordenados = [...rel.alunos].sort((a, b) => nomeAluno(a.aluno_id).localeCompare(nomeAluno(b.aluno_id), 'pt-BR'));
    if (!st.alunoId || !ordenados.some((a) => a.aluno_id === st.alunoId)) st.alunoId = ordenados[0].aluno_id;

    const aluno = ordenados.find((a) => a.aluno_id === st.alunoId);
    const faixa = aluno.percentual == null ? null : aluno.percentual >= FAIXAS.dominio ? 'verde' : aluno.percentual >= FAIXAS.atencao ? 'amarelo' : 'vermelho';
    const dificuldade = aluno.habilidades.find((h) => h.codigo === aluno.maiorDificuldade) || null;

    return `
      <div class="card">
        <div class="field" style="margin:0">
          <label class="label" for="d-aluno">Aluno</label>
          <select id="d-aluno" class="select" data-d-aluno>
            ${ordenados.map((a) => `<option value="${esc(a.aluno_id)}" ${a.aluno_id === st.alunoId ? 'selected' : ''}>${esc(nomeAluno(a.aluno_id))}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="res-kpis">
        <div class="kpi"><div class="kv" style="color:var(--ok)">${aluno.acertos}</div><div class="kl">Acertos</div></div>
        <div class="kpi"><div class="kv" style="color:var(--err)">${aluno.erros}</div><div class="kl">Erros</div></div>
        <div class="kpi">
          <div class="kv" style="color:${corDaFaixa(faixa)}">${aluno.percentual == null ? '—' : fmtNota(aluno.percentual) + '%'}</div>
          <div class="kl">Aproveitamento</div>
        </div>
      </div>

      ${dificuldade ? `
        <div class="alert err des-destaque">
          ${icon('alert', 17)}
          <span>
            <span class="strong">Maior dificuldade: ${esc(dificuldade.codigo)} · ${fmtNota(dificuldade.percentual)}%</span>
            ${esc(dificuldade.descricao || '')} — ${dificuldade.erros} erro(s) em ${dificuldade.total} questão(ões).
          </span>
        </div>` : `
        <div class="alert ok des-destaque">
          ${icon('check', 17)}
          <span><span class="strong">Nenhuma habilidade abaixo de ${FAIXAS.atencao}%.</span> Bom desempenho no conjunto avaliado.</span>
        </div>`}

      <section class="card stack" style="gap:10px">
        <div class="card-head" style="margin:0">
          <h2>Habilidades avaliadas</h2>
          <span class="xs muted">Dificuldades primeiro</span>
        </div>
        ${aluno.habilidades.length
          ? aluno.habilidades.map((h) => linhaHabilidade(h, { maiorDificuldade: h.codigo === aluno.maiorDificuldade })).join('')
          : '<p class="xs muted">Este aluno não tem respostas em questões com habilidade neste filtro.</p>'}
      </section>`;
  }

  function pintar() {
    const dados = store.get();
    const avaliacoes = store.avaliacoes();
    const rel = calcular(dados, filtro());

    root.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">Desempenho</span>
        <h1>Habilidades: domínio e dificuldades</h1>
        <p>Calculado com as respostas confirmadas das avaliações e as habilidades vinculadas às questões.</p>
      </div>

      ${pintarFiltros(avaliacoes)}

      ${store.erroDeHabilidades() ? `
        <div class="alert warn">
          ${icon('alert', 16)}
          <span>As habilidades do planejamento não puderam ser atualizadas agora. As descrições podem estar incompletas; os vínculos das questões foram mantidos.</span>
        </div>` : ''}

      <div class="chips" role="tablist" aria-label="Tipo de relatório">
        <button class="chip ${st.modo === 'turma' ? 'on' : ''}" type="button" data-modo="turma">Por turma</button>
        <button class="chip ${st.modo === 'aluno' ? 'on' : ''}" type="button" data-modo="aluno">Por aluno</button>
      </div>

      ${st.modo === 'turma' ? pintarRelatorioTurma(rel) : pintarRelatorioAluno(rel)}

      <p class="xs muted">
        Questões anuladas não entram no cálculo e respostas em branco contam como erro,
        como na correção da nota. Questões com várias habilidades contam para cada uma delas.
        ${st.trimestre !== 'todos' ? ` Filtro: ${st.trimestre}º trimestre (avaliações sem trimestre ficam de fora).` : ''}
      </p>
    `;

    root.querySelector('[data-d-av]')?.addEventListener('change', (e) => {
      st.avaliacaoId = e.target.value;
      st.turmaId = 'todas';
      st.alunoId = '';
      pintar();
    });
    root.querySelector('[data-d-turma]')?.addEventListener('change', (e) => {
      st.turmaId = e.target.value;
      st.alunoId = '';
      pintar();
    });
    root.querySelector('[data-d-tri]')?.addEventListener('change', (e) => {
      st.trimestre = e.target.value;
      st.alunoId = '';
      pintar();
    });
    root.querySelectorAll('[data-modo]').forEach((b) => {
      b.addEventListener('click', () => {
        st.modo = b.dataset.modo;
        pintar();
      });
    });
    root.querySelector('[data-d-aluno]')?.addEventListener('change', (e) => {
      st.alunoId = e.target.value;
      pintar();
    });
  }

  pintar();
  return { node: root, destroy: () => {} };
}

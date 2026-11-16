import * as store from '../store.js';
import {
  el, esc, icon, fmtNota, fmtData, iniciais, statusResultado,
  toast, situacaoBadge, barraDesempenho, desempenhoTexto, badge,
} from '../ui.js';

export default function resultados() {
  const root = el('<div class="stack"></div>');
  let filtro = 'todos';
  let avFiltro = 'todas';

  function pintar() {
    const resumo = store.resumo();
    const avs = store.avaliacoes();

    const lista = store.resultados().filter((r) => {
      if (filtro === 'confirmados' && r.status !== 'confirmado') return false;
      if (filtro === 'revisao' && r.status === 'confirmado') return false;
      if (avFiltro !== 'todas' && r.avaliacao_id !== avFiltro) return false;
      return true;
    });

    root.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">Resultados</span>
        <h1>Notas e desempenho</h1>
        <p>Cada resultado pertence a uma turma, uma disciplina e um aluno.</p>
      </div>

      <div class="kpis">
        <div class="kpi"><div class="kv">${fmtNota(resumo.media)}</div><div class="kl">Média confirmada</div></div>
        <div class="kpi"><div class="kv">${resumo.confirmados}</div><div class="kl">Confirmadas</div></div>
        <div class="kpi"><div class="kv">${resumo.pendentes}</div><div class="kl">Em revisão</div></div>
      </div>

      <div class="field">
        <label class="label" for="f-av">Avaliação</label>
        <select id="f-av" class="select" data-av>
          <option value="todas">Todas as avaliações</option>
          ${avs.map((a) => `<option value="${esc(a.id)}" ${a.id === avFiltro ? 'selected' : ''}>${esc(a.titulo)}</option>`).join('')}
        </select>
      </div>

      <div class="chips" role="tablist">
        <button class="chip ${filtro === 'todos' ? 'on' : ''}" data-f="todos">Todos</button>
        <button class="chip ${filtro === 'confirmados' ? 'on' : ''}" data-f="confirmados">Confirmados</button>
        <button class="chip ${filtro === 'revisao' ? 'on' : ''}" data-f="revisao">Revisão</button>
      </div>

      ${lista.length ? `
        <div class="card">
          <div class="list">
            ${lista.map((r) => {
              const aluno = store.aluno(r.aluno_id);
              const av = store.avaliacao(r.avaliacao_id);
              const turma = store.turma(r.turma_id);
              const disc = store.disciplina(r.disciplina_id);
              const faixa = store.faixaDe(av, r.percentual || 0);
              return `
                <div class="list-item" style="cursor:default;align-items:flex-start">
                  <span class="avatar">${esc(iniciais(aluno?.nome_completo))}</span>
                  <span class="grow">
                    <span class="li-title">${esc(aluno?.nome_completo || '—')}</span>
                    <span class="li-sub">${esc(av?.titulo || '—')}</span>
                    <span class="li-sub">${esc(turma?.nome || '')} · ${esc(disc?.nome || '')} · ${fmtData(r.criado_em)}</span>
                    <span style="display:block;margin-top:6px">${r.percentual == null ? '' : barraDesempenho(r.percentual, faixa)}</span>
                  </span>
                  <span style="text-align:right;min-width:96px">
                    <span class="strong" style="display:block">${r.nota == null ? '—' : fmtNota(r.nota)}<span class="xs muted"> / ${fmtNota(av?.valor_total || 0)}</span></span>
                    <span style="display:block;margin-top:4px">${r.percentual == null ? badge('Sem nota', 'warn') : desempenhoTexto(r.percentual, faixa)}</span>
                    <span style="display:block;margin-top:4px">${situacaoBadge(r.situacao)} ${statusResultado(r.status)}</span>
                  </span>
                </div>
                ${r.status !== 'confirmado' ? `
                  <div class="row" style="padding:0 0 10px 48px;gap:8px">
                    <button class="btn btn-outline btn-sm" type="button" data-confirmar="${esc(r.id)}">
                      ${icon('check', 14)} Confirmar nota
                    </button>
                    <a class="btn btn-ghost btn-sm" href="#/leitura">Refazer leitura</a>
                  </div>` : ''}
              `;
            }).join('')}
          </div>
        </div>` : `
        <div class="empty">
          <div class="ei">${icon('chart', 20)}</div>
          <h3>Sem resultados</h3>
          <p>Corrija os cartões para gerar as notas.</p>
          <a class="btn btn-primary" href="#/leitura">Corrigir cartões</a>
        </div>`}
    `;

    root.querySelector('[data-av]').addEventListener('change', (e) => { avFiltro = e.target.value; pintar(); });

    root.querySelectorAll('[data-f]').forEach((b) => {
      b.addEventListener('click', () => { filtro = b.dataset.f; pintar(); });
    });

    root.querySelectorAll('[data-confirmar]').forEach((b) => {
      b.addEventListener('click', async () => {
        const r = await store.confirmarResultado(b.dataset.confirmar);
        if (!r.ok) { toast(r.erro, 'err'); return; }
        toast('Nota confirmada.', 'ok');
        pintar();
      });
    });
  }

  pintar();
  return root;
}

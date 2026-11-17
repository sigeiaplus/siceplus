import * as store from '../store.js';
import {
  el, esc, icon, fmtData, fmtNota, statusAvaliacao,
  iniciais, prazoChip, badge, toast,
} from '../ui.js';

export default function avaliacaoDetalhe(params) {
  const av = store.avaliacao(params[0]);

  if (!av) {
    return el(`
      <div class="empty">
        <div class="ei">${icon('alert', 20)}</div>
        <h3>Avaliação não encontrada</h3>
        <p>Talvez ela tenha sido removida.</p>
        <a class="btn btn-primary" href="#/avaliacoes">Voltar às avaliações</a>
      </div>`);
  }

  const root = el('<div class="stack"></div>');

  function blocoTurma(apl) {
    const t = store.turma(apl.turma_id);
    const disc = store.disciplina(apl.disciplina_id);
    const prof = store.professor(apl.professor_id);
    const feitos = store.resultadosDaAvaliacao(av.id, apl.turma_id);
    const prog = store.progresso(av, apl.turma_id);

    const pendentes = feitos.filter((r) => r.status !== 'confirmado');
    const confirmados = feitos.filter((r) => r.status === 'confirmado' && r.nota != null);
    const notas = confirmados.map((r) => Number(r.nota) || 0);
    const media = notas.length ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
    const abaixo = confirmados.filter((r) => (r.percentual ?? 0) < (av.faixas?.amarelo ?? 60)).length;

    return `
      <section class="card">
        <div class="card-head">
          <div>
            <h2>${esc(t?.nome || 'Turma')}</h2>
            <p class="xs muted">${esc(disc?.nome || '')} · Prof. ${esc(prof?.nome || '—')}</p>
          </div>
          <span class="badge y">${prog.registrados}/${prog.total}</span>
        </div>

        <div class="progress" style="margin-bottom:12px">
          <span style="width:${prog.total ? Math.round((prog.registrados / prog.total) * 100) : 0}%"></span>
        </div>

        <div class="kv-list">
          <div><span class="k">Alunos</span><span class="v">${prog.total}</span></div>
          <div><span class="k">Corrigidos</span><span class="v">${prog.registrados} de ${prog.total}</span></div>
          <div><span class="k">Confirmados</span><span class="v">${prog.confirmados}</span></div>
          <div><span class="k">Média da turma</span><span class="v">${media == null ? '—' : fmtNota(media)}</span></div>
          <div><span class="k">Abaixo da faixa amarela</span><span class="v">${abaixo}</span></div>
        </div>

        ${pendentes.length ? `
          <div class="row wrap" style="margin-top:12px;gap:8px">
            <a class="btn btn-outline btn-sm" href="#/resultados">
              ${icon('check', 14)} Revisar ${pendentes.length} pendente(s) em Resultados
            </a>
          </div>` : ''}

        ${av.lancar_sided ? `
          <div class="row wrap" style="margin-top:14px;gap:8px;align-items:flex-end">
            <div class="field" style="max-width:130px">
              <label class="label" for="tri-${esc(t.id)}">Trimestre</label>
              <select class="select" id="tri-${esc(t.id)}" data-tri="${esc(t.id)}">
                <option value="1">1º</option><option value="2">2º</option><option value="3">3º</option>
              </select>
            </div>
            <button class="btn btn-outline btn-sm" type="button" data-sided="${esc(t.id)}"
                    ${confirmados.length ? '' : 'disabled'}>
              ${icon('cloud', 14)} Enviar ${confirmados.length} nota(s) revisada(s) ao SIDED+
            </button>
          </div>` : ''}

        <p class="xs muted" style="margin-top:12px">
          O detalhe aluno por aluno fica em <a href="#/resultados">Resultados</a>.
        </p>
      </section>`;
  }

  function pintar() {
    const prazo = store.prazoDe(av);

    root.innerHTML = `
      <a class="row small muted" href="#/avaliacoes" style="text-decoration:none">
        ${icon('left', 15)} Avaliações
      </a>

      <div class="page-head">
        <span class="eyebrow">${esc(store.nomeDisciplina(av))}</span>
        <h1>${esc(av.titulo)}</h1>
        <div class="row wrap" style="gap:8px;margin-top:4px">
          ${statusAvaliacao(av.status)}
          ${prazoChip(prazo)}
          ${av.lancar_sided ? '<span class="badge y">Integra SIDED+</span>' : '<span class="badge">Somente SICEP+</span>'}
        </div>
      </div>

      <div class="btn-group">
        <a class="btn btn-primary" href="#/cartoes/${esc(av.id)}">${icon('cards', 17)} Cartões</a>
        <a class="btn btn-outline" href="#/leitura">${icon('camera', 17)} Corrigir</a>
      </div>

      <section class="card">
        <div class="card-head"><h2>Dados da avaliação</h2></div>
        <div class="kv-list">
          <div><span class="k">Turmas</span><span class="v">${av.aplicacoes.map((a) => esc(store.turma(a.turma_id)?.nome || '')).join(' · ')}</span></div>
          <div><span class="k">Disciplina</span><span class="v">${esc(store.nomeDisciplina(av))}</span></div>
          <div><span class="k">Aplicação</span><span class="v">${fmtData(av.data_aplicacao)}</span></div>
          <div><span class="k">Prazo de correção</span><span class="v">${esc(prazo.texto)}</span></div>
          <div><span class="k">Valor total</span><span class="v">${fmtNota(av.valor_total)} pontos</span></div>
          <div><span class="k">Questões</span><span class="v">${av.questoes.length} · ${av.layout?.num_alternativas || 5} alternativas</span></div>
          <div><span class="k">Faixas</span><span class="v">verde ≥ ${av.faixas.verde}% · amarelo ≥ ${av.faixas.amarelo}%</span></div>
          <div><span class="k">Código do caderno</span><span class="v mono">${esc(av.layout?.codigo_caderno || 'SICEP-A')}</span></div>
        </div>
        ${av.descricao ? `<p class="small muted" style="margin-top:10px">${esc(av.descricao)}</p>` : ''}

        <div class="row wrap" style="margin-top:14px;gap:8px">
          <a class="btn btn-outline btn-sm" href="#/avaliacoes/editar/${esc(av.id)}">${icon('edit', 14)} Editar avaliação</a>
          <button class="btn btn-ghost btn-sm" type="button" data-excluir>${icon('trash', 14)} Excluir</button>
        </div>
      </section>

      ${av.aplicacoes.map(blocoTurma).join('')}

      <section class="card">
        <div class="card-head">
          <h2>Gabarito</h2>
          ${badge(`${av.questoes.length} questões`)}
        </div>
        <div style="overflow-x:auto">
          <table class="gab-table">
            <thead><tr><th>Nº</th><th>Valor</th><th>Gabarito</th></tr></thead>
            <tbody>
              ${av.questoes.map((q) => `
                <tr>
                  <td>${q.numero}</td>
                  <td>${q.anulada ? '—' : fmtNota(q.valor)}</td>
                  <td class="g">${q.anulada ? 'anulada' : esc(q.gabarito)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="xs muted" style="margin-top:10px">Questões anuladas são creditadas a todos os alunos.</p>
      </section>
    `;

    root.querySelectorAll('[data-sided]').forEach((b) => {
      b.addEventListener('click', async () => {
        const turmaId = b.dataset.sided;
        const tri = root.querySelector(`[data-tri="${turmaId}"]`)?.value || '1';
        b.disabled = true;
        const r = await store.enviarAoSided(av.id, turmaId, Number(tri));
        b.disabled = false;
        if (!r.ok) { toast(r.erro, 'err'); return; }
        toast(`${r.enviados} nota(s) enviadas ao SIDED+.`, 'ok');
        pintar();
      });
    });

    root.querySelector('[data-excluir]').addEventListener('click', async (ev) => {
      const total = store.resultadosDaAvaliacao(av.id).length;
      const aviso = total
        ? `Excluir "${av.titulo}"?\n\nIsso apaga também ${total} resultado(s) já corrigido(s). Não há como desfazer.`
        : `Excluir "${av.titulo}"?\n\nNão há como desfazer.`;
      if (!confirm(aviso)) return;

      const b = ev.currentTarget;
      b.disabled = true;
      const r = await store.excluirAvaliacao(av.id);
      if (!r.ok) { b.disabled = false; toast(r.erro, 'err'); return; }
      toast('Avaliação excluída.', 'ok');
      location.hash = '#/avaliacoes';
    });
  }

  pintar();
  return root;
}

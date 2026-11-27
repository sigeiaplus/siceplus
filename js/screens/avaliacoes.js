import * as store from '../store.js';
import { el, esc, icon, fmtData, fmtNota, statusAvaliacao, prazoChip, syncAvaliacaoBadge, reagirEnquantoVisivel } from '../ui.js';

export default function avaliacoes() {
  const root = el('<div class="stack"></div>');
  let filtro = 'todas';

  function cartao(av) {
    const turmas = av.aplicacoes.map((a) => store.turma(a.turma_id)?.nome).filter(Boolean);
    const totalAlunos = av.aplicacoes.reduce((s, a) => s + store.alunosDaTurma(a.turma_id).length, 0);
    const corrigidos = av.aplicacoes.reduce(
      (s, a) => s + store.resultadosDaAvaliacao(av.id, a.turma_id).length, 0
    );

    return `
      <article class="card av-card">
        <div class="row between" style="align-items:flex-start">
          <div class="grow">
            <div class="av-title">${esc(av.titulo)}</div>
            <div class="av-meta" style="margin-top:4px">
              <span>${esc(store.nomeDisciplina(av))}</span>
              <span class="av-dot"></span>
              <span>${turmas.length} turma${turmas.length > 1 ? 's' : ''}: ${esc(turmas.join(', '))}</span>
            </div>
          </div>
          ${statusAvaliacao(av.status)}
        </div>

        <div class="av-meta">
          <span>${fmtData(av.data_aplicacao)}</span>
          <span class="av-dot"></span>
          <span>${av.questoes.length} questões</span>
          <span class="av-dot"></span>
          <span>${fmtNota(av.valor_total)} pontos</span>
          <span class="av-dot"></span>
          <span>${corrigidos}/${totalAlunos} corrigidos</span>
        </div>

        <div class="row wrap" style="gap:6px">
          ${syncAvaliacaoBadge(av.sync)}
          ${prazoChip(store.prazoDe(av))}
          ${av.lancar_sided ? '<span class="badge y">SIDED+</span>' : '<span class="badge">Somente SIGEIA AVALIAÇÕES</span>'}
        </div>

        <div class="av-foot">
          <span class="xs muted">${av.questoes.filter((q) => q.anulada).length ? `${av.questoes.filter((q) => q.anulada).length} questão(ões) anulada(s)` : ''}</span>
          <span class="row" style="gap:6px">
            <a class="btn btn-outline btn-sm" href="#/avaliacoes/chamada/${esc(av.id)}">${icon('users', 14)} Chamada</a>
            <a class="btn btn-outline btn-sm" href="#/avaliacoes/${esc(av.id)}">Abrir ${icon('chevron', 14)}</a>
          </span>
        </div>
      </article>`;
  }

  function pintar() {
    const todas = store.avaliacoes();
    const lista = todas.filter((a) => filtro === 'todas' || a.status === filtro);

    root.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">Avaliações</span>
        <h1>Minhas avaliações</h1>
        <p>Uma avaliação pode ser aplicada a várias turmas, com o mesmo gabarito.</p>
      </div>

      <div class="chips" role="tablist">
        <button class="chip ${filtro === 'todas' ? 'on' : ''}" data-f="todas">Todas (${todas.length})</button>
        <button class="chip ${filtro === 'pronta' ? 'on' : ''}" data-f="pronta">Prontas</button>
        <button class="chip ${filtro === 'rascunho' ? 'on' : ''}" data-f="rascunho">Rascunhos</button>
      </div>

      <a class="btn btn-primary btn-block btn-nova" href="#/avaliacoes/nova">${icon('plus', 18)} Nova avaliação</a>

      ${lista.length
        ? `<div class="stack">${lista.map(cartao).join('')}</div>`
        : `<div class="empty">
             <div class="ei">${icon('list', 20)}</div>
             <h3>Nada por aqui</h3>
             <p>Nenhuma avaliação neste filtro.</p>
             <a class="btn btn-outline" href="#/avaliacoes/nova">Criar avaliação</a>
           </div>`}
    `;

    root.querySelectorAll('[data-f]').forEach((b) => {
      b.addEventListener('click', () => { filtro = b.dataset.f; pintar(); });
    });
  }

  pintar();
  reagirEnquantoVisivel(root, store.aoMudarSincronizacao, pintar);
  return root;
}

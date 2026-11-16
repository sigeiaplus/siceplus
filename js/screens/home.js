import * as store from '../store.js';
import { el, esc, icon, fmtData, primeiroNome, badge, prazoChip } from '../ui.js';

export default function home() {
  const sessao = store.sessao();
  const resumo = store.resumo();
  const lista = store.avaliacoes();
  const turmas = store.turmasDoProfessor(sessao.professor_id);

  const atrasadas = lista.filter((a) => a.status === 'pronta' && store.prazoDe(a).status === 'atrasado');

  const recentes = lista.slice(0, 3).map((av) => {
    const nomes = av.aplicacoes.map((x) => store.turma(x.turma_id)?.nome).filter(Boolean);
    return `
      <a class="list-item" href="#/avaliacoes/${esc(av.id)}">
        <span class="avatar">${icon('doc', 17)}</span>
        <span class="grow">
          <span class="li-title">${esc(av.titulo)}</span>
          <span class="li-sub">${esc(nomes.join(' · ') || '—')}</span>
        </span>
        <span class="muted small nowrap">${fmtData(av.data_aplicacao)}</span>
      </a>`;
  }).join('');

  return el(`
    <div class="stack">
      <div class="page-head">
        <span class="eyebrow">Painel do professor</span>
        <h1>Olá, ${esc(primeiroNome(sessao.nome))}</h1>
        <p>${esc(sessao.escola)} · ${turmas.length} turma(s) vinculada(s)</p>
      </div>

      <div class="kpis">
        <div class="kpi"><div class="kv">${lista.length}</div><div class="kl">Avaliações</div></div>
        <div class="kpi"><div class="kv">${resumo.confirmados}</div><div class="kl">Corrigidas</div></div>
        <div class="kpi"><div class="kv">${resumo.pendentes}</div><div class="kl">A revisar</div></div>
      </div>

      ${atrasadas.length ? `
        <a class="alert err" href="#/avaliacoes" style="text-decoration:none">
          ${icon('alert', 17)}
          <span><span class="strong">${atrasadas.length} avaliação(ões) com prazo de correção vencido.</span>
          ${esc(atrasadas[0].titulo)}${atrasadas.length > 1 ? ' e outras' : ''}.</span>
        </a>` : ''}

      ${resumo.pendentes ? `
        <a class="alert warn" href="#/resultados" style="text-decoration:none">
          ${icon('alert', 17)}
          <span><span class="strong">${resumo.pendentes} correção(ões) aguardando revisão.</span>
          Confirme antes de enviar a nota ao SIDED+.</span>
        </a>` : ''}

      <div class="quick">
        <a href="#/avaliacoes/nova">
          <span class="qi">${icon('plus', 18)}</span>
          <span class="qt">Nova avaliação</span>
          <span class="qs">Uma ou várias turmas</span>
        </a>
        <a href="#/cartoes">
          <span class="qi">${icon('cards', 18)}</span>
          <span class="qt">Cartões de respostas</span>
          <span class="qs">Gerar e imprimir</span>
        </a>
        <a href="#/leitura">
          <span class="qi">${icon('camera', 18)}</span>
          <span class="qt">Corrigir cartões</span>
          <span class="qs">Turma → aluno → caderno</span>
        </a>
        <a href="#/resultados">
          <span class="qi">${icon('chart', 18)}</span>
          <span class="qt">Resultados</span>
          <span class="qs">Notas e desempenho</span>
        </a>
      </div>

      <div class="home-grid">
      <section class="card">
        <div class="card-head">
          <h2>Avaliações recentes</h2>
          <a class="small" href="#/avaliacoes">Ver todas</a>
        </div>
        ${recentes ? `<div class="list">${recentes}</div>` : `
          <div class="empty">
            <div class="ei">${icon('list', 20)}</div>
            <h3>Nenhuma avaliação</h3>
            <p>Crie a primeira avaliação para gerar os cartões.</p>
            <a class="btn btn-primary" href="#/avaliacoes/nova">Nova avaliação</a>
          </div>`}
      </section>

      <section class="card soft">
        <div class="row between wrap">
          <div class="row">
            <span class="mark">${icon('school', 16)}</span>
            <div>
              <div class="strong small">${esc(sessao.escola)}</div>
              <div class="xs muted">${turmas.length} turma(s) · ${store.avaliacoes().length} avaliação(ões)</div>
            </div>
          </div>
          ${badge('Sincronização na nuvem', 'y')}
        </div>
      </section>
      </div>
    </div>
  `);
}

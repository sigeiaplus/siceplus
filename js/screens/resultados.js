import * as store from '../store.js';
import {
  el, esc, icon, fmtNota, fmtData, iniciais,
  toast, situacaoBadge, barraDesempenho, desempenhoTexto, badge, syncResultadoBadge,
} from '../ui.js';

/**
 * Resultados — cada nota nasce em revisão.
 *
 * Regras que valem aqui:
 * - O professor seleciona alunos, abre a revisão e confirma CADA resultado.
 * - O ENVIO ao SIDED+ NÃO é feito aqui: fica somente na tela da Avaliação
 *   (que usa o trimestre definido na criação). Aqui só se consulta o estado.
 * - Reler volta ao fluxo da câmera (QR do caderno → cartão) sem duplicar registro.
 * - Excluir pede confirmação e não apaga a nota já lançada no SIDED+.
 */
// Avaliação e turma escolhidas valem enquanto o app estiver aberto (sobrevivem a ir e voltar da
// releitura). Recarregar a página é sessão nova e pergunta de novo; "Redefinir filtro" também.
let escolhaSessao = null;   // { avaliacaoId, turmaId: 'todas' | id }

export default function resultados() {
  const root = el('<div class="res-root"></div>');

  let modalAberto = null;

  const st = {
    filtro: 'todos',
    avFiltro: escolhaSessao?.avaliacaoId || null,   // null = ainda não escolheu
    turmaFiltro: escolhaSessao?.turmaId || 'todas',
    rascunho: { avaliacaoId: '', turmaId: 'todas' },
    busca: '',
    sel: new Set(),
  };

  const confirmado = (r) => r.status === 'confirmado';

  const visiveis = () => {
    const termo = st.busca.trim().toLowerCase();
    return store.resultados().filter((r) => {
      if (st.filtro === 'confirmados' && !confirmado(r)) return false;
      if (st.filtro === 'revisao' && confirmado(r)) return false;
      if (st.filtro === 'enviados' && !r.enviado_em) return false;
      if (r.avaliacao_id !== st.avFiltro) return false;
      if (st.turmaFiltro !== 'todas' && r.turma_id !== st.turmaFiltro) return false;
      if (termo) {
        const aluno = store.aluno(r.aluno_id);
        const av = store.avaliacao(r.avaliacao_id);
        const texto = [aluno?.nome_completo, av?.titulo].filter(Boolean).join(' ').toLowerCase();
        if (!texto.includes(termo)) return false;
      }
      return true;
    });
  };

  const selecionados = () => store.resultados().filter((r) => st.sel.has(r.id));

  /* ---------------- Linha da lista ---------------- */

  function linhaHTML(r) {
    const aluno = store.aluno(r.aluno_id);
    const av = store.avaliacao(r.avaliacao_id);
    const turma = store.turma(r.turma_id);
    const disc = store.disciplina(r.disciplina_id);
    const faixa = store.faixaDe(av, r.percentual || 0);
    const ok = confirmado(r);
    const marcado = st.sel.has(r.id);
    const nome = aluno?.nome_completo || '—';

    return `
      <div class="res-row ${ok ? 'ok' : 'pend'} ${marcado ? 'sel' : ''}" data-linha="${esc(r.id)}">
        <label class="res-check">
          <input type="checkbox" data-sel="${esc(r.id)}" ${marcado ? 'checked' : ''} aria-label="Selecionar ${esc(nome)}" />
        </label>

        <div class="res-aluno">
          <span class="res-nome"><span class="avatar sm">${esc(iniciais(nome))}</span>${esc(nome)}</span>
          <span class="res-meta">${esc([turma?.nome, disc?.nome, fmtData(r.criado_em)].filter(Boolean).join(' · '))}</span>
          <span class="res-badges">
            ${ok ? badge('Revisado', 'ok') : badge('A confirmar', 'warn')}
            ${r.enviado_em ? badge('Enviado ao SIDED+', 'y') : ''}
            ${syncResultadoBadge(r.sync)}
            ${situacaoBadge(r.situacao)}
          </span>
        </div>

        <div class="res-nota">
          <span class="res-valor">${r.nota == null ? '—' : fmtNota(r.nota)}<span class="xs muted"> / ${fmtNota(av?.valor_total || 0)}</span></span>
          ${r.percentual == null ? '' : barraDesempenho(r.percentual, faixa)}
          <span class="xs muted res-perc">${r.percentual == null ? '' : desempenhoTexto(r.percentual, faixa)}</span>
        </div>

      </div>`;
  }

  /* ---------------- Modal de revisão ---------------- */

  function cartaoRevisaoHTML(r) {
    const aluno = store.aluno(r.aluno_id);
    const av = store.avaliacao(r.avaliacao_id);
    const turma = store.turma(r.turma_id);
    const ok = confirmado(r);
    const respostas = r.respostas || {};
    const questoes = av?.questoes || [];

    const celulas = questoes.map((q) => {
      const assinalada = respostas[q.numero] || null;
      const classe = q.anulada ? 'anu' : (!assinalada ? 'branco' : (assinalada === q.gabarito ? 'ok' : 'err'));
      return `<span class="rev-q ${classe}" title="Questão ${q.numero}: ${esc(assinalada || 'em branco')}${q.anulada ? ' (anulada)' : ''}">
        ${q.numero}<b>${esc(assinalada || '—')}</b>
      </span>`;
    }).join('');

    return `
      <article class="rev-card ${ok ? 'ok' : 'pend'}">
        <div class="rev-card-head">
          <span class="avatar">${esc(iniciais(aluno?.nome_completo))}</span>
          <div class="grow" style="min-width:0">
            <strong class="rev-nome">${esc(aluno?.nome_completo || '—')}</strong>
            <span class="xs muted">${esc([av?.titulo, turma?.nome].filter(Boolean).join(' · '))}</span>
          </div>
          <div class="rev-nota">
            <strong>${r.nota == null ? '—' : fmtNota(r.nota)}</strong>
            <span class="xs muted"> / ${fmtNota(av?.valor_total || 0)}</span>
          </div>
        </div>

        <div class="rev-answers" aria-label="Respostas de ${esc(aluno?.nome_completo || '')}">
          ${celulas || '<span class="xs muted">Sem questões nesta avaliação.</span>'}
        </div>

        <div class="row between wrap" style="gap:10px">
          <span class="xs muted">
            ${r.acertos != null ? `${r.acertos} acerto(s)` : 'Nota registrada'}${r.enviado_em ? ' · já enviado ao SIDED+' : ''}
          </span>
          ${ok
            ? `<span class="row" style="gap:6px">${badge('Revisado e confirmado', 'ok')}</span>`
            : `<button class="btn btn-primary btn-sm" type="button" data-confirmar-rev="${esc(r.id)}">
                 ${icon('check', 14)} Confirmar revisão
               </button>`}
        </div>
      </article>`;
  }

  function abrirRevisao(ids) {
    const alvo = ids.filter((id) => store.resultados().some((r) => r.id === id));
    if (!alvo.length) {
      toast('Selecione pelo menos um aluno para revisar.', 'err');
      return;
    }

    if (modalAberto) modalAberto.remove();
    const back = el('<div class="modal-back" data-modal><div class="modal res-modal" role="dialog" aria-modal="true" aria-label="Revisar resultados"></div></div>');
    const caixa = back.querySelector('.modal');
    document.body.append(back);
    modalAberto = back;

    const fechar = () => { back.remove(); if (modalAberto === back) modalAberto = null; };

    function desenhar() {
      const itens = alvo.map((id) => store.resultados().find((x) => x.id === id)).filter(Boolean);
      const revisados = itens.filter(confirmado).length;

      caixa.innerHTML = `
        <div class="row between" style="align-items:flex-start">
          <div>
            <h2 style="margin:0">Revisar resultados</h2>
            <p class="xs muted" style="margin:2px 0 0">${revisados} de ${itens.length} conferido(s). Cada aluno é confirmado individualmente.</p>
          </div>
          <button class="cf-btn dark" type="button" data-fechar aria-label="Fechar">${icon('close', 18)}</button>
        </div>

        <div class="rev-lista">
          ${itens.map(cartaoRevisaoHTML).join('')}
        </div>

        <div class="btn-group">
          <button class="btn btn-outline" type="button" data-fechar>Fechar</button>
          <button class="btn btn-primary" type="button" data-voltar-lista>Voltar à lista</button>
        </div>`;

      caixa.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', fechar));
      caixa.querySelector('[data-voltar-lista]').addEventListener('click', fechar);

      caixa.querySelectorAll('[data-confirmar-rev]').forEach((b) => {
        b.addEventListener('click', async () => {
          b.disabled = true;
          const res = await store.confirmarResultado(b.dataset.confirmarRev);
          if (!res.ok) { b.disabled = false; toast(res.erro, 'err'); return; }
          toast('Revisão confirmada.', 'ok');
          desenhar();
          pintar();
        });
      });
    }

    back.addEventListener('click', (e) => { if (e.target === back) fechar(); });
    desenhar();
  }

  /* ---------------- Ações da seleção (mini card inferior) ---------------- */

  function desenharAcoes() {
    const alvo = root.querySelector('[data-acoes-wrap]');
    if (!alvo) return;
    const n = st.sel.size;
    if (!n) { alvo.innerHTML = ''; return; }
    const um = n === 1;
    alvo.innerHTML = `
      <div class="res-enviar res-acoes-topo on" role="region" aria-label="Ações para os alunos selecionados">
        <div class="re-txt">
          <strong>${n} selecionado${n === 1 ? '' : 's'}</strong>
          <span class="xs muted">${um ? 'Escolha o que fazer com este resultado.' : 'RELER vale para um aluno por vez.'}</span>
        </div>
        <div class="row wrap" style="gap:8px">
          <button class="btn btn-primary btn-sm" type="button" data-acao-revisar>${icon('check', 14)} REVISAR</button>
          <button class="btn btn-outline btn-sm" type="button" data-acao-reler ${um ? '' : 'disabled'}>${icon('camera', 14)} RELER</button>
          <button class="btn btn-outline btn-sm" type="button" data-acao-excluir>${icon('trash', 14)} EXCLUIR</button>
          <button class="btn btn-ghost btn-sm" type="button" data-acao-limpar>Limpar</button>
        </div>
      </div>`;

    alvo.querySelector('[data-acao-revisar]').addEventListener('click', () => abrirRevisao([...st.sel]));
    alvo.querySelector('[data-acao-limpar]').addEventListener('click', () => { st.sel.clear(); pintar(); });

    alvo.querySelector('[data-acao-reler]').addEventListener('click', () => {
      const r = store.resultados().find((x) => x.id === [...st.sel][0]);
      if (!r) return;
      if (r.enviado_em && !window.confirm(
        'Esta nota já foi enviada ao SIDED+.\n\nA nova leitura altera só o resultado no SICEP+; a nota no SIDED+ não será modificada.\n\nReler o cartão?'
      )) return;
      location.hash = `#/leitura/${r.avaliacao_id}/${r.aluno_id}`;
    });

    alvo.querySelector('[data-acao-excluir]').addEventListener('click', async (ev) => {
      const alvos = store.resultados().filter((r) => st.sel.has(r.id));
      if (!alvos.length) return;
      const enviadas = alvos.filter((r) => r.enviado_em).length;
      const nomes = alvos.slice(0, 5).map((r) => `• ${store.aluno(r.aluno_id)?.nome_completo || '—'}`).join('\n')
        + (alvos.length > 5 ? `\n• e mais ${alvos.length - 5}` : '');
      const aviso = [
        alvos.length === 1 ? 'Excluir este resultado?' : `Excluir ${alvos.length} resultados?`,
        '',
        nomes,
        '',
        enviadas
          ? `${enviadas === alvos.length ? 'Estas notas já foram' : `${enviadas} já foram`} enviada(s) ao SIDED+. A exclusão aqui NÃO apaga a nota lançada lá.`
          : 'Os cartões precisarão ser lidos novamente para gerar outras notas.',
        'Não há como desfazer.',
      ].join('\n');
      if (!window.confirm(aviso)) return;

      ev.currentTarget.disabled = true;
      let feitos = 0;
      const erros = [];
      for (const r of alvos) {
        const res = await store.excluirResultado(r.id);
        if (res.ok) { feitos += 1; st.sel.delete(r.id); } else erros.push(res.erro);
      }
      pintar();
      if (erros.length) toast(`${feitos} excluído(s). Falhou em ${erros.length}: ${erros[0]}`, 'err');
      else toast(feitos === 1 ? 'Resultado excluído.' : `${feitos} resultados excluídos.`, 'ok');
    });
  }

  /* ---------------- Escolha inicial: avaliação e turma ---------------- */

  function pintarEscolha() {
    const avs = store.avaliacoes();
    const av = avs.find((a) => a.id === st.rascunho.avaliacaoId) || null;
    const turmasDaAv = (av?.aplicacoes || [])
      .map((a) => store.turma(a.turma_id)).filter(Boolean)
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    root.innerHTML = `
      <div class="page-head res-head-page">
        <span class="eyebrow">Resultados</span>
        <h1>Notas e desempenho</h1>
        <p>Escolha a avaliação e a turma para ver os resultados. Análise por habilidade em <a href="#/desempenho">Desempenho</a>.</p>
      </div>

      ${avs.length ? `
        <div class="card stack">
          <div class="field" style="margin:0">
            <label class="label" for="e-av">Avaliação</label>
            <select id="e-av" class="select" data-e-av>
              <option value="">Selecione a avaliação</option>
              ${avs.map((a) => `<option value="${esc(a.id)}" ${a.id === st.rascunho.avaliacaoId ? 'selected' : ''}>${esc(a.titulo)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="margin:0">
            <label class="label" for="e-turma">Turma</label>
            <select id="e-turma" class="select" data-e-turma ${av ? '' : 'disabled'}>
              <option value="todas">Todas as turmas</option>
              ${turmasDaAv.map((t) => `<option value="${esc(t.id)}" ${t.id === st.rascunho.turmaId ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary" type="button" data-ver ${av ? '' : 'disabled'}>Ver resultados</button>
        </div>` : `
        <div class="empty">
          <div class="ei">${icon('chart', 20)}</div>
          <h3>Sem avaliações</h3>
          <p>Crie uma avaliação e corrija os cartões para gerar as notas.</p>
          <a class="btn btn-primary" href="#/avaliacoes/nova">Nova avaliação</a>
        </div>`}
    `;

    root.querySelector('[data-e-av]')?.addEventListener('change', (e) => {
      st.rascunho.avaliacaoId = e.target.value;
      st.rascunho.turmaId = 'todas';
      pintarEscolha();
    });
    root.querySelector('[data-e-turma]')?.addEventListener('change', (e) => { st.rascunho.turmaId = e.target.value; });
    root.querySelector('[data-ver]')?.addEventListener('click', () => {
      if (!st.rascunho.avaliacaoId) return;
      st.avFiltro = st.rascunho.avaliacaoId;
      st.turmaFiltro = st.rascunho.turmaId;
      escolhaSessao = { avaliacaoId: st.avFiltro, turmaId: st.turmaFiltro };
      st.sel.clear();
      pintar();
    });
  }

  function redefinirFiltro() {
    escolhaSessao = null;
    st.avFiltro = null;
    st.turmaFiltro = 'todas';
    st.rascunho = { avaliacaoId: '', turmaId: 'todas' };
    st.filtro = 'todos';
    st.busca = '';
    st.sel.clear();
    pintar();
  }

  /* ---------------- Render ---------------- */

  function pintar() {
    // Avaliação escolhida que deixou de existir (excluída): pergunta de novo.
    if (st.avFiltro && !store.avaliacao(st.avFiltro)) { escolhaSessao = null; st.avFiltro = null; }
    if (!st.avFiltro) { pintarEscolha(); return; }

    const av = store.avaliacao(st.avFiltro);
    const turmaSel = st.turmaFiltro !== 'todas' ? store.turma(st.turmaFiltro) : null;
    const escopo = store.resultados().filter((r) =>
      r.avaliacao_id === st.avFiltro && (st.turmaFiltro === 'todas' || r.turma_id === st.turmaFiltro));
    const conf = escopo.filter((r) => confirmado(r) && r.nota != null && r.situacao === 'normal');
    const media = conf.length ? conf.reduce((t, r) => t + Number(r.nota || 0), 0) / conf.length : 0;
    const pendentesEscopo = escopo.filter((r) => !confirmado(r)).length;

    const lista = visiveis();
    // Só descarta da seleção o que deixou de existir (exclusão/recarregamento).
    [...st.sel].forEach((id) => { if (!store.resultados().some((r) => r.id === id)) st.sel.delete(id); });
    const todosMarcados = lista.length > 0 && lista.every((r) => st.sel.has(r.id));
    const filtrado = st.busca || st.filtro !== 'todos';

    root.innerHTML = `
      <div class="page-head res-head-page">
        <span class="eyebrow">Resultados</span>
        <h1>Notas e desempenho</h1>
        <p>Selecione os alunos para revisar, reler ou excluir. O envio ao SIDED+ é feito na tela da <a href="#/avaliacoes">Avaliação</a>. Veja também o <a href="#/desempenho">desempenho por habilidade</a>.</p>
      </div>

      <div class="card row between wrap" style="gap:10px;align-items:center">
        <div class="grow" style="min-width:0">
          <strong>${esc(av.titulo)}</strong>
          <span class="xs muted" style="display:block">${esc(turmaSel ? turmaSel.nome : 'Todas as turmas')}</span>
        </div>
        <button class="btn btn-outline btn-sm" type="button" data-redefinir>Redefinir filtro</button>
      </div>

      <div class="res-kpis">
        <div class="kpi"><div class="kv">${fmtNota(media)}</div><div class="kl">Média revisada</div></div>
        <div class="kpi"><div class="kv">${conf.length}</div><div class="kl">Revisadas</div></div>
        <div class="kpi"><div class="kv">${pendentesEscopo}</div><div class="kl">A revisar</div></div>
      </div>

      <div class="card res-filtros">
        <div class="field" style="margin:0">
          <label class="label" for="f-busca">Buscar aluno</label>
          <div class="search-box">
            ${icon('search', 16)}
            <input id="f-busca" class="input" type="search" placeholder="Nome do aluno" value="${esc(st.busca)}" data-busca />
          </div>
        </div>
      </div>

      <div class="res-barra">
        <div class="chips" role="tablist" aria-label="Filtrar resultados">
          <button class="chip ${st.filtro === 'todos' ? 'on' : ''}" type="button" data-f="todos">Todos</button>
          <button class="chip ${st.filtro === 'confirmados' ? 'on' : ''}" type="button" data-f="confirmados">Revisados</button>
          <button class="chip ${st.filtro === 'revisao' ? 'on' : ''}" type="button" data-f="revisao">Pendentes</button>
          <button class="chip ${st.filtro === 'enviados' ? 'on' : ''}" type="button" data-f="enviados">Enviados</button>
        </div>
        <div class="res-sel-tools">
          <button class="btn btn-ghost btn-sm" type="button" data-marcar ${lista.length ? '' : 'disabled'}>
            ${todosMarcados ? 'Desmarcar' : 'Selecionar'} ${lista.length} visível(is)
          </button>
        </div>
      </div>

      <div data-acoes-wrap></div>

      ${lista.length ? `
        <div class="card res-lista">
          <div class="res-lista-topo">
            <label class="res-check">
              <input type="checkbox" data-sel-todos ${todosMarcados ? 'checked' : ''} aria-label="Selecionar todos os resultados visíveis" />
            </label>
            <span>Aluno</span>
            <span class="res-col-nota">Nota</span>
          </div>
          <div class="res-linhas">${lista.map(linhaHTML).join('')}</div>
        </div>` : `
        <div class="empty">
          <div class="ei">${icon('chart', 20)}</div>
          <h3>${filtrado ? 'Nenhum resultado neste filtro' : 'Sem resultados'}</h3>
          <p>${filtrado ? 'Ajuste os filtros para ver as notas.' : 'Nenhum cartão desta avaliação foi corrigido ainda.'}</p>
          ${filtrado ? '' : '<a class="btn btn-primary" href="#/leitura">Corrigir cartões</a>'}
        </div>`}
    `;

    /* ---- eventos ---- */

    root.querySelector('[data-redefinir]').addEventListener('click', redefinirFiltro);

    const busca = root.querySelector('[data-busca]');
    busca.addEventListener('input', () => {
      st.busca = busca.value;
      const pos = busca.selectionStart;
      pintar();
      const novo = root.querySelector('[data-busca]');
      if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
    });

    root.querySelectorAll('[data-f]').forEach((b) => {
      b.addEventListener('click', () => { st.filtro = b.dataset.f; pintar(); });
    });

    root.querySelector('[data-marcar]')?.addEventListener('click', () => {
      if (todosMarcados) lista.forEach((r) => st.sel.delete(r.id));
      else lista.forEach((r) => st.sel.add(r.id));
      pintar();
    });

    root.querySelector('[data-sel-todos]')?.addEventListener('change', (e) => {
      if (e.target.checked) lista.forEach((r) => st.sel.add(r.id));
      else lista.forEach((r) => st.sel.delete(r.id));
      pintar();
    });

    // Marca/desmarca sem redesenhar a lista (mantém a posição de rolagem).
    function alternar(id, marcado) {
      if (marcado) st.sel.add(id); else st.sel.delete(id);
      const linha = root.querySelector(`[data-linha="${CSS.escape(id)}"]`);
      if (linha) {
        linha.classList.toggle('sel', marcado);
        const c = linha.querySelector('[data-sel]');
        if (c) c.checked = marcado;
      }
      desenharAcoes();
    }
    root.querySelectorAll('[data-sel]').forEach((c) => {
      c.addEventListener('change', () => alternar(c.dataset.sel, c.checked));
    });
    // Tocar na linha também seleciona (mais fácil no celular).
    root.querySelectorAll('[data-linha]').forEach((linha) => {
      linha.addEventListener('click', (e) => {
        if (e.target.closest('input, label, a, button')) return;
        alternar(linha.dataset.linha, !st.sel.has(linha.dataset.linha));
      });
    });

    desenharAcoes();
  }

  pintar();
  return {
    node: root,
    destroy: () => {
      if (modalAberto) { modalAberto.remove(); modalAberto = null; }
    },
  };
}

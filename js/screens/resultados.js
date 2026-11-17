import * as store from '../store.js';
import {
  el, esc, icon, fmtNota, fmtData, iniciais,
  toast, situacaoBadge, barraDesempenho, desempenhoTexto, badge,
} from '../ui.js';

/**
 * Resultados — cada nota nasce em revisão.
 *
 * Regras que valem aqui:
 * - O professor seleciona alunos, abre a revisão e confirma CADA resultado.
 * - Só resultado confirmado (e de avaliação marcada para o SIDED+) entra na conta
 *   do botão "ENVIAR X NOTAS AO SIDED+".
 * - Reler volta ao fluxo da câmera (QR do caderno → cartão) sem duplicar registro.
 * - Excluir pede confirmação e não apaga a nota já lançada no SIDED+.
 */
export default function resultados() {
  const root = el('<div class="res-root"></div>');

  let modalAberto = null;

  const st = {
    filtro: 'todos',
    avFiltro: 'todas',
    turmaFiltro: 'todas',
    busca: '',
    sel: new Set(),
    trimestre: '1',
    enviando: false,
  };

  const confirmado = (r) => r.status === 'confirmado';

  const visiveis = () => {
    const termo = st.busca.trim().toLowerCase();
    return store.resultados().filter((r) => {
      if (st.filtro === 'confirmados' && !confirmado(r)) return false;
      if (st.filtro === 'revisao' && confirmado(r)) return false;
      if (st.filtro === 'enviados' && !r.enviado_em) return false;
      if (st.avFiltro !== 'todas' && r.avaliacao_id !== st.avFiltro) return false;
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

  /** Um grupo de envio = uma avaliação em uma turma (o SIDED+ tem uma avaliação por turma). */
  function gruposParaEnvio() {
    const mapa = new Map();
    st.sel.forEach((id) => {
      const r = store.resultados().find((x) => x.id === id);
      if (!r || !confirmado(r) || r.nota == null) return;
      const av = store.avaliacao(r.avaliacao_id);
      if (!av || !av.lancar_sided) return;
      if (!store.aplicacaoDe(av, r.turma_id)) return;
      const chave = `${r.avaliacao_id}:${r.turma_id}`;
      if (!mapa.has(chave)) {
        mapa.set(chave, { avaliacaoId: r.avaliacao_id, turmaId: r.turma_id, ids: [], av, turma: store.turma(r.turma_id) });
      }
      mapa.get(chave).ids.push(r.id);
    });
    return [...mapa.values()];
  }

  const selecionados = () => store.resultados().filter((r) => st.sel.has(r.id));
  const pendentesSel = () => selecionados().filter((r) => !confirmado(r));
  const semIntegracaoSel = () => selecionados().filter((r) => {
    const av = store.avaliacao(r.avaliacao_id);
    return !av?.lancar_sided;
  });

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
          <span class="res-meta">${esc(av?.titulo || '—')}</span>
          <span class="res-meta">${esc([turma?.nome, disc?.nome, fmtData(r.criado_em)].filter(Boolean).join(' · '))}</span>
          <span class="res-badges">
            ${ok ? badge('Revisado', 'ok') : badge('A confirmar', 'warn')}
            ${r.enviado_em ? badge('Enviado ao SIDED+', 'y') : ''}
            ${situacaoBadge(r.situacao)}
          </span>
        </div>

        <div class="res-nota">
          <span class="res-valor">${r.nota == null ? '—' : fmtNota(r.nota)}<span class="xs muted"> / ${fmtNota(av?.valor_total || 0)}</span></span>
          ${r.percentual == null ? '' : barraDesempenho(r.percentual, faixa)}
          <span class="xs muted res-perc">${r.percentual == null ? '' : desempenhoTexto(r.percentual, faixa)}</span>
        </div>

        <div class="res-acts">
          <button class="btn btn-outline btn-sm" type="button" data-revisar="${esc(r.id)}">
            ${icon('check', 14)} Revisar
          </button>
          <a class="btn btn-ghost btn-sm" href="#/leitura/${esc(r.avaliacao_id)}/${esc(r.aluno_id)}" title="Reler o cartão deste aluno">
            ${icon('camera', 14)} Reler
          </a>
          <button class="btn btn-ghost btn-sm" type="button" data-excluir="${esc(r.id)}" aria-label="Excluir resultado de ${esc(nome)}">
            ${icon('trash', 14)}
          </button>
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

  /* ---------------- Envio ---------------- */

  async function enviar() {
    const grupos = gruposParaEnvio();
    const total = grupos.reduce((s, g) => s + g.ids.length, 0);
    if (!total) return;

    const descricao = grupos
      .map((g) => `• ${g.av.titulo} — ${g.turma?.nome || 'turma'}: ${g.ids.length} nota(s)`)
      .join('\n');
    const confirmar = window.confirm(
      `Enviar ${total} nota(s) revisada(s) ao SIDED+?\n\n${descricao}\n\nTrimestre: ${st.trimestre}º\n\n` +
      'Alunos ainda sem revisão confirmada NÃO serão enviados.'
    );
    if (!confirmar) return;

    st.enviando = true;
    pintar();

    let enviados = 0;
    const erros = [];
    for (const g of grupos) {
      const r = await store.enviarAoSided(g.avaliacaoId, g.turmaId, Number(st.trimestre), g.ids);
      if (r.ok) enviados += r.enviados;
      else erros.push(`${g.turma?.nome || 'Turma'}: ${r.erro}`);
    }

    st.enviando = false;
    st.sel.clear();
    pintar();

    if (erros.length) toast(`${enviados} nota(s) enviadas. Falhou em ${erros.length} turma(s): ${erros[0]}`, 'err');
    else toast(`${enviados} nota(s) revisadas enviadas ao SIDED+.`, 'ok');
  }

  /* ---------------- Render ---------------- */

  function pintar() {
    const resumo = store.resumo();
    const lista = visiveis();
    // Só descarta da seleção o que deixou de existir (exclusão/recarregamento).
    [...st.sel].forEach((id) => { if (!store.resultados().some((r) => r.id === id)) st.sel.delete(id); });

    const todosMarcados = lista.length > 0 && lista.every((r) => st.sel.has(r.id));
    const avs = store.avaliacoes();
    const turmas = store.turmasDoProfessor(store.sessao()?.professor_id).slice()
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

    const confirmadasSel = selecionados().filter((r) => confirmado(r) && r.nota != null).length;
    const grupos = gruposParaEnvio();
    const paraEnviar = grupos.reduce((s, g) => s + g.ids.length, 0);
    const pendentes = pendentesSel().length;
    const foraIntegracao = semIntegracaoSel().length;

    root.innerHTML = `
      <div class="page-head res-head-page">
        <span class="eyebrow">Resultados</span>
        <h1>Notas e desempenho</h1>
        <p>Revise aluno por aluno. Só o que você confirmar é enviado ao SIDED+.</p>
      </div>

      <div class="res-kpis">
        <div class="kpi"><div class="kv">${fmtNota(resumo.media)}</div><div class="kl">Média revisada</div></div>
        <div class="kpi"><div class="kv">${resumo.confirmados}</div><div class="kl">Revisadas</div></div>
        <div class="kpi"><div class="kv">${resumo.pendentes}</div><div class="kl">A revisar</div></div>
      </div>

      <div class="card res-filtros">
        <div class="field" style="margin:0">
          <label class="label" for="f-av">Avaliação</label>
          <select id="f-av" class="select" data-av>
            <option value="todas">Todas as avaliações</option>
            ${avs.map((a) => `<option value="${esc(a.id)}" ${a.id === st.avFiltro ? 'selected' : ''}>${esc(a.titulo)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin:0">
          <label class="label" for="f-turma">Turma</label>
          <select id="f-turma" class="select" data-turma>
            <option value="todas">Todas as turmas</option>
            ${turmas.map((t) => `<option value="${esc(t.id)}" ${t.id === st.turmaFiltro ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}
          </select>
        </div>
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
          ${st.sel.size ? `<button class="btn btn-ghost btn-sm" type="button" data-limpar>Limpar seleção (${st.sel.size})</button>` : ''}
          <button class="btn btn-outline btn-sm" type="button" data-revisar-sel ${st.sel.size ? '' : 'disabled'}>
            ${icon('check', 14)} Revisar selecionados
          </button>
        </div>
      </div>

      ${lista.length ? `
        <div class="card res-lista">
          <div class="res-lista-topo">
            <label class="res-check">
              <input type="checkbox" data-sel-todos ${todosMarcados ? 'checked' : ''} aria-label="Selecionar todos os resultados visíveis" />
            </label>
            <span>Aluno · avaliação</span>
            <span class="res-col-nota">Nota</span>
            <span class="res-col-acoes">Ações</span>
          </div>
          <div class="res-linhas">${lista.map(linhaHTML).join('')}</div>
        </div>` : `
        <div class="empty">
          <div class="ei">${icon('chart', 20)}</div>
          <h3>${st.busca || st.avFiltro !== 'todas' || st.turmaFiltro !== 'todas' || st.filtro !== 'todos'
            ? 'Nenhum resultado neste filtro'
            : 'Sem resultados'}</h3>
          <p>${st.busca || st.avFiltro !== 'todas' || st.turmaFiltro !== 'todas' || st.filtro !== 'todos'
            ? 'Ajuste os filtros para ver as notas.'
            : 'Corrija os cartões para gerar as notas.'}</p>
          <a class="btn btn-primary" href="#/leitura">Corrigir cartões</a>
        </div>`}

      <div class="res-enviar ${paraEnviar ? 'on' : ''}">
        <div class="re-txt">
          <strong>${paraEnviar} nota(s) revisada(s) pronta(s) para envio</strong>
          <span class="xs muted">
            ${st.sel.size === 0
              ? 'Selecione os alunos e confirme a revisão de cada um.'
              : `${pendentes} selecionada(s) ainda sem confirmação${foraIntegracao ? ` · ${foraIntegracao} sem integração SIDED+` : ''}`}
          </span>
        </div>
        <label class="re-tri">
          <span class="xs muted">Trimestre</span>
          <select class="select" data-tri>
            ${[1, 2, 3].map((t) => `<option value="${t}" ${String(t) === st.trimestre ? 'selected' : ''}>${t}º</option>`).join('')}
          </select>
        </label>
        <button class="btn btn-primary res-enviar-btn" type="button" data-enviar ${paraEnviar && !st.enviando ? '' : 'disabled'}>
          ${icon('cloud', 16)} ${st.enviando ? 'Enviando…' : `ENVIAR ${paraEnviar} NOTA${paraEnviar === 1 ? '' : 'S'} AO SIDED+`}
        </button>
      </div>
    `;

    /* ---- eventos ---- */

    root.querySelector('[data-av]').addEventListener('change', (e) => {
      st.avFiltro = e.target.value;
      pintar();
    });
    root.querySelector('[data-turma]').addEventListener('change', (e) => {
      st.turmaFiltro = e.target.value;
      pintar();
    });

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
    root.querySelector('[data-limpar]')?.addEventListener('click', () => { st.sel.clear(); pintar(); });

    root.querySelector('[data-sel-todos]')?.addEventListener('change', (e) => {
      if (e.target.checked) lista.forEach((r) => st.sel.add(r.id));
      else lista.forEach((r) => st.sel.delete(r.id));
      pintar();
    });

    root.querySelectorAll('[data-sel]').forEach((c) => {
      c.addEventListener('change', () => {
        const id = c.dataset.sel;
        if (c.checked) st.sel.add(id); else st.sel.delete(id);
        const linha = c.closest('.res-row');
        if (linha) linha.classList.toggle('sel', c.checked);
        // Atualiza somente a barra de envio (evita perder a posição da lista).
        atualizarBarra();
      });
    });

    root.querySelector('[data-revisar-sel]')?.addEventListener('click', () => abrirRevisao([...st.sel]));
    root.querySelectorAll('[data-revisar]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.revisar;
        const r = store.resultados().find((x) => x.id === id);
        if (r && !confirmado(r)) st.sel.add(id);
        abrirRevisao([id]);
      });
    });

    root.querySelectorAll('[data-excluir]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.dataset.excluir;
        const r = store.resultados().find((x) => x.id === id);
        if (!r) return;
        const aluno = store.aluno(r.aluno_id);
        const av = store.avaliacao(r.avaliacao_id);
        const aviso = [
          `Excluir o resultado de ${aluno?.nome_completo || '—'} em "${av?.titulo || '—'}"?`,
          '',
          r.enviado_em
            ? 'Esta nota já foi enviada ao SIDED+. A exclusão aqui NÃO apaga a nota lançada lá.'
            : 'O cartão precisará ser lido novamente para gerar outra nota.',
          'Não há como desfazer.',
        ].join('\n');
        if (!window.confirm(aviso)) return;

        b.disabled = true;
        const res = await store.excluirResultado(id);
        if (!res.ok) { b.disabled = false; toast(res.erro, 'err'); return; }
        st.sel.delete(id);
        toast(res.enviado ? 'Resultado excluído. A nota do SIDED+ foi mantida.' : 'Resultado excluído.', 'ok');
        pintar();
      });
    });

    root.querySelector('[data-tri]').addEventListener('change', (e) => {
      st.trimestre = e.target.value;
      pintar();
    });
    root.querySelector('[data-enviar]').addEventListener('click', enviar);
  }

  /** Barra de envio recalculada sem redesenhar a lista inteira. */
  function atualizarBarra() {
    const barra = root.querySelector('.res-enviar');
    if (!barra) return;
    const grupos = gruposParaEnvio();
    const paraEnviar = grupos.reduce((s, g) => s + g.ids.length, 0);
    const pendentes = pendentesSel().length;
    const fora = semIntegracaoSel().length;

    barra.classList.toggle('on', paraEnviar > 0);
    barra.querySelector('.re-txt strong').textContent = `${paraEnviar} nota(s) revisada(s) pronta(s) para envio`;
    barra.querySelector('.re-txt span').textContent = st.sel.size === 0
      ? 'Selecione os alunos e confirme a revisão de cada um.'
      : `${pendentes} selecionada(s) ainda sem confirmação${fora ? ` · ${fora} sem integração SIDED+` : ''}`;

    const b = barra.querySelector('[data-enviar]');
    b.disabled = !paraEnviar || st.enviando;
    b.innerHTML = `${icon('cloud', 16)} ${st.enviando ? 'Enviando…' : `ENVIAR ${paraEnviar} NOTA${paraEnviar === 1 ? '' : 'S'} AO SIDED+`}`;
  }

  pintar();
  return {
    node: root,
    destroy: () => {
      if (modalAberto) { modalAberto.remove(); modalAberto = null; }
    },
  };
}

import * as store from '../store.js';
import {
  calcular, codigosDaQuestao, faixaDe, faixaHabilidade, nivelAprendizagem, resumoPorTurma, FAIXAS,
} from '../desempenho.js';
import {
  el, esc, icon, badge, barraDesempenho, fmtNota, fmtDataHora, iniciais, reagirEnquantoVisivel,
} from '../ui.js';

/**
 * Painel de desempenho.
 *
 * De cima para baixo: filtros → participação → nível de aprendizagem → acerto por habilidade
 * (blocos coloridos) → visão detalhada (tabela por turma, matriz de habilidades, por aluno).
 *
 * Tudo é calculado localmente com o que já está no app (nuvem ou cópia do aparelho), então
 * funciona offline e nada aqui grava na nuvem.
 *
 * Desempenho de tela: o cálculo roda uma vez por escolha (avaliação/turma) ou quando a
 * sincronização muda os dados. Trocar de aba, filtrar, buscar e abrir aluno só redesenha a
 * parte afetada.
 */

// A escolha vale enquanto o app estiver aberto (sobrevive a sair e voltar da tela).
let escolhaSessao = null;   // { avaliacaoId, turmaId: 'todas' | id }

const NIVEIS_APR = [
  { id: 'defasagem', rotulo: 'Defasagem' },
  { id: 'intermediario', rotulo: 'Aprendizado intermediário' },
  { id: 'adequado', rotulo: 'Aprendizado adequado' },
];

const FAIXAS_HAB = [
  { id: 'f1', rotulo: 'Até 40%' },
  { id: 'f2', rotulo: 'De 41 até 60%' },
  { id: 'f3', rotulo: 'De 61 até 80%' },
  { id: 'f4', rotulo: 'Acima de 80%' },
];

const ABAS = [
  { id: 'participacao', rotulo: 'Participação e desempenho' },
  { id: 'habilidades', rotulo: 'Acerto por habilidade' },
  { id: 'alunos', rotulo: 'Por aluno' },
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
const pctInteiro = (n, total) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '—');
const porCodigo = (a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true });

export default function desempenho() {
  const root = el('<div class="des-root"></div>');

  const avs0 = store.avaliacoes();
  const inicial = avs0.find((a) => a.id === escolhaSessao?.avaliacaoId) || avs0[0] || null;

  const st = {
    avaliacaoId: inicial?.id || null,
    turmaId: inicial && inicial.id === escolhaSessao?.avaliacaoId ? (escolhaSessao.turmaId || 'todas') : 'todas',
    aba: 'participacao',
    faixa: 'todas',        // filtro dos blocos de habilidade
    busca: '',             // busca da aba de alunos
    ordem: 'menor',
    aberto: null,          // aluno expandido
  };

  let rel = null;          // relatório calculado (null = precisa recalcular)
  let porTurma = null;     // participação e níveis por turma

  const nomeAluno = (id) => store.aluno(id)?.nome_completo || '—';

  function turmasDaAvaliacao(av) {
    return (av?.aplicacoes || [])
      .map((a) => store.turma(a.turma_id)).filter(Boolean)
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  }

  function turmasEmEscopo(av) {
    const todas = turmasDaAvaliacao(av);
    return st.turmaId === 'todas' ? todas : todas.filter((t) => t.id === st.turmaId);
  }

  function relatorio() {
    if (!rel) rel = calcular(store.get(), { avaliacaoId: st.avaliacaoId, turmaId: st.turmaId });
    return rel;
  }

  function resumoTurmas() {
    if (!porTurma) {
      const av = store.avaliacao(st.avaliacaoId);
      const turmas = turmasEmEscopo(av).map((t) => ({
        id: t.id, nome: t.nome, previstos: store.alunosDaTurma(t.id).length,
      }));
      porTurma = resumoPorTurma(store.get(), st.avaliacaoId, turmas);
    }
    return porTurma;
  }

  /* ---------------- Dica (tooltip) dos blocos de habilidade ---------------- */

  const dica = el('<div class="des-dica" role="tooltip" hidden></div>');

  function mostrarDica(alvo) {
    const r = relatorio();
    const h = r.habilidades.find((x) => x.codigo === alvo.dataset.cod);
    if (!h) return;
    dica.innerHTML = `
      <span class="des-dica-eyebrow">${esc(alvo.dataset.rotulo)} (${esc(h.codigo)})</span>
      <strong>É o percentual de acerto nesta habilidade</strong>
      <span class="des-dica-desc">${esc(h.descricao || 'Descrição não encontrada no planejamento.')}</span>
      <span class="des-dica-meta">${h.acertos} acerto(s) · ${h.erros} erro(s) · ${h.alunos} aluno(s)</span>`;
    dica.hidden = false;

    const rc = alvo.getBoundingClientRect();
    const dw = dica.offsetWidth;
    const dh = dica.offsetHeight;
    const margem = 8;
    let left = rc.left + rc.width / 2 - dw / 2;
    left = Math.max(margem, Math.min(left, window.innerWidth - dw - margem));
    let top = rc.top - dh - margem;
    if (top < margem) top = rc.bottom + margem;
    dica.style.left = `${left}px`;
    dica.style.top = `${top}px`;
  }

  function esconderDica() { dica.hidden = true; }

  const aoClicarFora = (e) => {
    if (!e.target.closest?.('.des-tile')) esconderDica();
  };
  document.addEventListener('click', aoClicarFora);

  /* ---------------- Peças ---------------- */

  /** Cartão de uma habilidade na visão de um aluno. */
  function cartaoHabilidade(h, extra = {}) {
    const rotuloNivel = (() => {
      const n = nivelDe(h);
      if (n === 'sem') return badge('Sem resultados', 'warn');
      if (n === 'dominio') return badge('Domínio', 'ok');
      if (n === 'reforco') return badge('Precisa de reforço', 'err');
      return badge('Em desenvolvimento', 'warn');
    })();

    return `
      <article class="des-hab ${nivelDe(h)}">
        <div class="des-hab-top">
          <span class="des-cod">${esc(h.codigo)}</span>
          ${rotuloNivel}
          ${extra.maiorDificuldade ? badge('Maior dificuldade', 'err') : ''}
          <strong class="des-hab-pct" style="color:${corDaFaixa(h.faixa)}">${pctTexto(h.percentual)}</strong>
        </div>
        <p class="des-desc">${esc(h.descricao || 'Descrição não encontrada no planejamento.')}</p>
        ${h.percentual == null ? '' : barraDesempenho(h.percentual, h.faixa)}
        <div class="des-hab-foot">
          <span><strong>${h.acertos}</strong> acerto(s)</span>
          <span><strong>${h.erros}</strong> erro(s)</span>
        </div>
      </article>`;
  }

  const legendaFaixas = () => `
    <div class="des-legenda">
      ${FAIXAS_HAB.map((f) => `<span><i class="${f.id}"></i>${f.rotulo}</span>`).join('')}
    </div>`;

  /* ---------------- Seções do topo ---------------- */

  function secaoFiltros(av, avs) {
    const turmas = turmasDaAvaliacao(av);
    const quando = store.dadosEmCache() && store.cacheAtualizadoEm()
      ? fmtDataHora(store.cacheAtualizadoEm())
      : fmtDataHora(new Date().toISOString());
    return `
      <p class="des-atualizado">Dados atualizados em ${esc(quando)}${store.dadosEmCache() ? ' (cópia do aparelho)' : ''}</p>
      <div class="des-filtros">
        <div class="field" style="margin:0">
          <label class="label" for="d-av">Avaliação</label>
          <select id="d-av" class="select" data-d-av>
            ${avs.map((a) => `<option value="${esc(a.id)}" ${a.id === st.avaliacaoId ? 'selected' : ''}>${esc(a.titulo)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin:0">
          <label class="label" for="d-turma">Turma</label>
          <select id="d-turma" class="select" data-d-turma>
            <option value="todas">Todas as turmas</option>
            ${turmas.map((t) => `<option value="${esc(t.id)}" ${t.id === st.turmaId ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}
          </select>
        </div>
      </div>`;
  }

  function secaoParticipacao(av, t) {
    const pct = t.participacao;
    return `
      <section class="card des-sec" aria-labelledby="d-t-part">
        <div class="des-sec-head">
          <h2 id="d-t-part">Participação</h2>
          <button class="btn btn-outline btn-sm" type="button" data-ver-mais="participacao">Ver mais</button>
        </div>
        <div class="des-sec-sub">${esc(av.titulo)}</div>
        <div class="des-grande-rotulo">Estudantes avaliados</div>
        <div class="des-grande">${pct == null ? '—' : `${Math.round(pct)}%`}</div>
        <div class="des-dist" role="img" aria-label="Participação: ${t.avaliados} de ${t.previstos} estudantes">
          ${t.avaliados ? `<span class="apr" style="flex:${t.avaliados}"></span>` : ''}
          ${t.previstos - t.avaliados > 0 ? `<span class="vazio" style="flex:${t.previstos - t.avaliados}"></span>` : ''}
        </div>
        <div class="des-linhas">
          <div class="des-linha"><span><i class="apr"></i><strong>Avaliados</strong><small>${t.avaliados} estudante(s)</small></span><b>${pctInteiro(t.avaliados, t.previstos)}</b></div>
          <div class="des-linha"><span><i class="vazio"></i><strong>Previstos</strong><small>${t.previstos} estudante(s)</small></span><b>${t.previstos}</b></div>
        </div>
      </section>`;
  }

  function secaoAprendizagem(av, t) {
    const base = t.classificados;
    const adequado = t.niveis.adequado;
    return `
      <section class="card des-sec" aria-labelledby="d-t-apr">
        <div class="des-sec-head"><h2 id="d-t-apr">Nível de aprendizagem</h2></div>
        <div class="des-sec-sub">${esc(av.titulo)}</div>
        <div class="des-grande-rotulo">Estudantes com <strong>aprendizagem adequada</strong></div>
        <div class="des-grande">${pctInteiro(adequado, base)}</div>
        <div class="des-grande-rotulo">Distribuição dos estudantes por níveis de aprendizagem</div>
        <div class="des-dist" role="img" aria-label="Distribuição dos estudantes por nível de aprendizagem">
          ${NIVEIS_APR.map((n) => (t.niveis[n.id] ? `<span class="${n.id}" style="flex:${t.niveis[n.id]}"></span>` : '')).join('')}
        </div>
        <div class="des-linhas">
          ${NIVEIS_APR.map((n) => `
            <div class="des-linha">
              <span><i class="${n.id}"></i><strong>${n.rotulo}</strong><small>${t.niveis[n.id]} estudante(s)</small></span>
              <b>${pctInteiro(t.niveis[n.id], base)}</b>
            </div>`).join('')}
        </div>
        <p class="xs muted">Defasagem: até 50% de acerto · Intermediário: 51% a 74% · Adequado: 75% ou mais.</p>
      </section>`;
  }

  /* ---------------- Acerto por habilidade (blocos) ---------------- */

  function corpoBlocos() {
    const r = relatorio();
    const ordenadas = [...r.habilidades].sort(porCodigo);
    const itens = ordenadas
      .map((h, i) => ({ h, rotulo: `H ${String(i + 1).padStart(2, '0')}`, faixa: faixaHabilidade(h.percentual) }))
      .filter((x) => st.faixa === 'todas' || x.faixa === st.faixa);

    if (!itens.length) return '<p class="xs muted">Nenhuma habilidade nesta faixa.</p>';

    return `
      <div class="des-tiles">
        ${itens.map(({ h, rotulo, faixa }) => `
          <button class="des-tile ${faixa || 'sem'}" type="button" data-cod="${esc(h.codigo)}" data-rotulo="${esc(rotulo)}"
                  aria-label="${esc(`${rotulo}, ${h.codigo}: ${pctTexto(h.percentual)} de acerto`)}">
            <span class="des-tile-h">${esc(rotulo)}</span>
            <span class="des-tile-c">(${esc(h.codigo)})</span>
            <strong>${h.percentual == null ? '—' : `${Math.round(h.percentual)}%`}</strong>
          </button>`).join('')}
      </div>`;
  }

  function pintarBlocos() {
    const alvo = root.querySelector('[data-blocos]');
    if (!alvo) return;
    esconderDica();
    alvo.innerHTML = corpoBlocos();
    alvo.querySelectorAll('.des-tile').forEach((b) => {
      b.addEventListener('mouseenter', () => mostrarDica(b));
      b.addEventListener('mouseleave', esconderDica);
      b.addEventListener('focus', () => mostrarDica(b));
      b.addEventListener('blur', esconderDica);
      b.addEventListener('click', () => mostrarDica(b));
    });
  }

  function secaoHabilidades(r) {
    return `
      <section class="card des-sec" aria-labelledby="d-t-hab">
        <div class="des-sec-head">
          <h2 id="d-t-hab">Percentual de acerto por habilidade</h2>
          <button class="btn btn-outline btn-sm" type="button" data-ver-mais="habilidades">Ver mais</button>
        </div>
        ${r.habilidades.length ? `
          <div class="field des-faixa-campo" style="margin:0">
            <label class="label" for="d-faixa">Acerto por habilidade</label>
            <select id="d-faixa" class="select" data-faixa>
              <option value="todas">Todos</option>
              ${FAIXAS_HAB.map((f) => `<option value="${f.id}" ${st.faixa === f.id ? 'selected' : ''}>${f.rotulo}</option>`).join('')}
            </select>
          </div>
          <div data-blocos></div>
          ${legendaFaixas()}` : `
          <div class="empty">
            <div class="ei">${icon('target', 20)}</div>
            <h3>Nenhuma habilidade vinculada a esta prova</h3>
            <p>As questões desta avaliação não têm habilidade do planejamento. Edite a avaliação e vincule as habilidades na etapa <strong>Questões</strong>.</p>
            <a class="btn btn-primary" href="#/avaliacoes/editar/${esc(st.avaliacaoId)}">Editar avaliação</a>
          </div>`}
      </section>`;
  }

  /* ---------------- Visão detalhada ---------------- */

  function abaParticipacao() {
    const { linhas, total } = resumoTurmas();
    if (!linhas.length) return '<p class="xs muted">Nenhuma turma vinculada a esta avaliação.</p>';

    const celulaNivel = (l, id) => `<td><span class="des-ponto"><i class="${id}"></i>${pctInteiro(l.niveis[id], l.classificados)}</span></td>`;
    const linha = (l, destaque = false) => `
      <tr class="${destaque ? 'des-total' : ''}">
        <th scope="row">${esc(l.nome)}</th>
        <td>${l.previstos}</td>
        <td>${l.avaliados}</td>
        <td>${l.participacao == null ? '—' : `${Math.round(l.participacao)}%`}</td>
        ${NIVEIS_APR.map((n) => celulaNivel(l, n.id)).join('')}
      </tr>`;

    return `
      <div class="des-tabela-wrap">
        <table class="des-tabela">
          <thead>
            <tr>
              <th scope="col">Turma</th>
              <th scope="col">Previstos</th>
              <th scope="col">Avaliados</th>
              <th scope="col">% Participação</th>
              ${NIVEIS_APR.map((n) => `<th scope="col">${n.rotulo}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${linhas.map((l) => linha(l)).join('')}
            ${linhas.length > 1 ? linha({ ...total, nome: 'Total' }, true) : ''}
          </tbody>
        </table>
      </div>
      <p class="xs muted">Os percentuais de nível consideram só os estudantes avaliados.</p>`;
  }

  function abaHabilidades() {
    const r = relatorio();
    const { linhas } = resumoTurmas();
    if (!r.habilidades.length) return '<p class="xs muted">Nenhuma habilidade com resultado nesta prova.</p>';

    const ordenadas = [...r.habilidades].sort(porCodigo);
    const celula = (p) => {
      const f = faixaHabilidade(p);
      return `<td><span class="des-celula ${f || 'sem'}">${p == null ? '—' : `${Math.round(p)}%`}</span></td>`;
    };

    return `
      <div class="des-tabela-wrap">
        <table class="des-tabela des-matriz">
          <thead>
            <tr>
              <th scope="col">Habilidade</th>
              ${linhas.map((l) => `<th scope="col">${esc(l.nome)}</th>`).join('')}
              ${linhas.length > 1 ? '<th scope="col">Geral</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${ordenadas.map((h, i) => `
              <tr>
                <th scope="row" title="${esc(h.descricao || '')}">
                  <span class="des-matriz-h">H ${String(i + 1).padStart(2, '0')}</span> <span class="muted">(${esc(h.codigo)})</span>
                </th>
                ${linhas.map((l) => celula(l.habilidades.get(h.codigo) ?? null)).join('')}
                ${linhas.length > 1 ? celula(h.percentual) : ''}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${legendaFaixas()}`;
  }

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

  function abaAlunos(r) {
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

  function pintarCorpo() {
    const corpo = root.querySelector('[data-corpo]');
    if (!corpo) return;
    esconderDica();

    root.querySelectorAll('[data-aba]').forEach((b) => {
      const ativo = b.dataset.aba === st.aba;
      b.classList.toggle('on', ativo);
      b.setAttribute('aria-selected', String(ativo));
    });

    if (st.aba === 'alunos') {
      corpo.innerHTML = abaAlunos(relatorio());
      const busca = corpo.querySelector('[data-busca]');
      busca?.addEventListener('input', () => { st.busca = busca.value; pintarListaAlunos(); });
      corpo.querySelector('[data-ordem]')?.addEventListener('change', (e) => {
        st.ordem = e.target.value;
        pintarListaAlunos();
      });
      pintarListaAlunos();
      return;
    }

    corpo.innerHTML = st.aba === 'habilidades' ? abaHabilidades() : abaParticipacao();
  }

  function irParaDetalhe(aba) {
    st.aba = aba;
    pintarCorpo();
    root.querySelector('[data-detalhe]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- Render ---------------- */

  function pintar() {
    esconderDica();
    const avs = store.avaliacoes();

    if (!avs.length) {
      root.innerHTML = `
        <div class="page-head">
          <span class="eyebrow">Desempenho</span>
          <h1>Desempenho</h1>
        </div>
        <div class="empty">
          <div class="ei">${icon('target', 20)}</div>
          <h3>Sem avaliações</h3>
          <p>Crie uma avaliação, vincule as habilidades às questões e corrija os cartões para ver o desempenho.</p>
          <a class="btn btn-primary" href="#/avaliacoes/nova">Nova avaliação</a>
        </div>`;
      root.append(dica);
      return;
    }

    // Avaliação escolhida que deixou de existir (excluída): volta para a primeira.
    if (!st.avaliacaoId || !store.avaliacao(st.avaliacaoId)) {
      st.avaliacaoId = avs[0].id;
      st.turmaId = 'todas';
      rel = null; porTurma = null;
    }
    if (st.turmaId !== 'todas' && !turmasDaAvaliacao(store.avaliacao(st.avaliacaoId)).some((t) => t.id === st.turmaId)) {
      st.turmaId = 'todas';
      rel = null; porTurma = null;
    }
    escolhaSessao = { avaliacaoId: st.avaliacaoId, turmaId: st.turmaId };

    const av = store.avaliacao(st.avaliacaoId);
    const r = relatorio();
    const { total } = resumoTurmas();
    const s = r.resumo;

    root.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">Desempenho</span>
        <h1>Painel de desempenho</h1>
        <p>Notas individuais em <a href="#/resultados">Resultados</a>.</p>
      </div>

      ${secaoFiltros(av, avs)}

      ${store.erroDeHabilidades() ? `
        <div class="alert warn">
          ${icon('alert', 16)}
          <span>As habilidades do planejamento não puderam ser atualizadas agora. As descrições podem estar incompletas; os vínculos das questões foram mantidos.</span>
        </div>` : ''}

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

      <div class="des-topo">
        ${secaoParticipacao(av, total)}
        ${secaoAprendizagem(av, total)}
      </div>

      ${secaoHabilidades(r)}

      <section class="card des-sec" data-detalhe aria-labelledby="d-t-det">
        <div class="des-sec-head"><h2 id="d-t-det">Visão detalhada dos resultados</h2></div>
        <div class="des-abas" role="tablist" aria-label="Tipo de relatório">
          ${ABAS.map((a) => `<button class="des-aba" type="button" role="tab" data-aba="${a.id}">${a.rotulo}${a.id === 'alunos' ? ` <span class="des-chip-n">${s.alunosAvaliados}</span>` : ''}</button>`).join('')}
        </div>
        <div class="des-corpo" data-corpo></div>
      </section>

      <p class="xs muted">
        Questões anuladas não entram no cálculo e respostas em branco contam como erro, como na correção da nota.
        Só entram resultados com revisão confirmada.
      </p>
    `;
    root.append(dica);

    root.querySelector('[data-d-av]').addEventListener('change', (e) => {
      st.avaliacaoId = e.target.value;
      st.turmaId = 'todas';
      st.faixa = 'todas';
      st.busca = '';
      st.aberto = null;
      rel = null; porTurma = null;
      pintar();
    });
    root.querySelector('[data-d-turma]').addEventListener('change', (e) => {
      st.turmaId = e.target.value;
      st.aberto = null;
      rel = null; porTurma = null;
      pintar();
    });
    root.querySelector('[data-faixa]')?.addEventListener('change', (e) => {
      st.faixa = e.target.value;
      pintarBlocos();
    });
    root.querySelectorAll('[data-ver-mais]').forEach((b) => {
      b.addEventListener('click', () => irParaDetalhe(b.dataset.verMais));
    });
    root.querySelectorAll('[data-aba]').forEach((b) => {
      b.addEventListener('click', () => {
        if (st.aba === b.dataset.aba) return;
        st.aba = b.dataset.aba;
        pintarCorpo();
      });
    });

    pintarBlocos();
    pintarCorpo();
  }

  // Dados mudaram em segundo plano (sincronização): recalcula uma vez e redesenha.
  reagirEnquantoVisivel(root, store.aoMudarSincronizacao, () => { rel = null; porTurma = null; pintar(); });

  pintar();
  return { node: root, destroy: () => { document.removeEventListener('click', aoClicarFora); } };
}

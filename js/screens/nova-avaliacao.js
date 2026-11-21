import * as store from '../store.js';
import { el, esc, icon, toast, fmtData, fmtNota, fmtDataHora } from '../ui.js';

const ETAPAS = ['Turmas', 'Disciplinas', 'Professor', 'Dados', 'Questões', 'Revisão'];

export default function novaAvaliacao(params) {
  const sessao = store.sessao();
  const avEdicao = params?.[0] ? store.avaliacao(params[0]) : null;
  const root = el('<div class="stack"></div>');

  const st = {
    etapa: 0,
    turmasSel: [],
    vinculos: {},
    titulo: '',
    descricao: '',
    data_aplicacao: new Date().toISOString().slice(0, 10),
    prazo_correcao: '',
    trimestre: '',
    valor_total: '10',
    num_questoes: '10',
    num_alternativas: '5',
    integra_sided: true,
    faixa_verde: '80',
    faixa_amarelo: '60',
    codigo_caderno: '',
    questoes: null,
    salvando: false,
  };

  if (avEdicao) {
    st.turmasSel = avEdicao.aplicacoes.map((a) => a.turma_id);
    st.vinculos = {};
    avEdicao.aplicacoes.forEach((a) => {
      if (a.turma_disciplina_id) st.vinculos[a.turma_id] = a.turma_disciplina_id;
    });
    st.titulo = avEdicao.titulo || '';
    st.descricao = avEdicao.descricao || '';
    st.data_aplicacao = avEdicao.data_aplicacao || st.data_aplicacao;
    st.prazo_correcao = avEdicao.prazo_correcao ? String(avEdicao.prazo_correcao).slice(0, 16) : '';
    st.trimestre = avEdicao.trimestre ? String(avEdicao.trimestre) : '';
    st.valor_total = String(avEdicao.valor_total ?? 10);
    st.num_questoes = String(avEdicao.questoes.length || 10);
    st.num_alternativas = String(avEdicao.layout?.num_alternativas || avEdicao.questoes[0]?.num_alternativas || 5);
    st.integra_sided = !!avEdicao.lancar_sided;
    st.faixa_verde = String(avEdicao.faixas?.verde ?? 80);
    st.faixa_amarelo = String(avEdicao.faixas?.amarelo ?? 60);
    st.codigo_caderno = avEdicao.layout?.codigo_caderno || '';
    st.questoes = avEdicao.questoes.map((q) => ({
      numero: q.numero,
      enunciado: q.enunciado || '',
      valor: Number(q.valor) || 0,
      gabarito: q.gabarito,
      anulada: !!q.anulada,
      // Etapa 4B: códigos guardados em habilidade_bncc (separados por vírgula).
      habilidades: store.codigosDeHabilidade(q.habilidade_bncc),
      // Se a coluna não veio na leitura, não sobrescrever o que está na nuvem.
      tocaHabilidade: Object.prototype.hasOwnProperty.call(q, 'habilidade_bncc'),
    }));
  }

  const turmasDisponiveis = store.turmasDoProfessor(sessao.professor_id);
  const letras = () => store.ALTERNATIVAS.slice(0, Number(st.num_alternativas));

  /* ---------------- Questões ---------------- */

  function habilidadesJaEscolhidas(numero) {
    const naLista = (st.questoes || []).find((q) => Number(q.numero) === Number(numero));
    if (naLista) return [...(naLista.habilidades || [])];
    return [...((st.habilidadesPorNumero || {})[numero] || [])];
  }

  function questoesPadrao() {
    const n = Math.max(1, Math.min(store.MAX_QUESTOES, Number(st.num_questoes) || 1));
    const valor = Math.round(((Number(st.valor_total) || 10) / n) * 100) / 100;
    return Array.from({ length: n }, (_, i) => ({
      numero: i + 1, valor, enunciado: '', gabarito: null, anulada: false,
      // Mudar a quantidade de questões não perde as habilidades já escolhidas dos mesmos números.
      habilidades: habilidadesJaEscolhidas(i + 1),
      tocaHabilidade: true,
    }));
  }

  function garantirQuestoes() {
    const n = Math.max(1, Math.min(store.MAX_QUESTOES, Number(st.num_questoes) || 1));
    const q = st.questoes;
    if (!q || q.length !== n || q[0].alternativas !== undefined) st.questoes = questoesPadrao();
  }

  function somaQuestoes() {
    return Math.round(
      (st.questoes || []).filter((q) => !q.anulada).reduce((s, q) => s + (Number(q.valor) || 0), 0) * 100
    ) / 100;
  }

  function erroEtapa() {
    const i = st.etapa;
    if (i === 0 && !st.turmasSel.length) return 'Selecione ao menos uma turma.';
    if (i === 1) {
      const faltando = st.turmasSel.filter((t) => !st.vinculos[t]);
      if (faltando.length) return 'Escolha a disciplina de cada turma selecionada.';
    }
    if (i === 3) {
      if (!st.titulo.trim()) return 'Informe o título da avaliação.';
      if (!st.data_aplicacao) return 'Informe a data de aplicação.';
      if (st.integra_sided && store.tem('trimestre') && !['1', '2', '3'].includes(String(st.trimestre))) {
        return 'Escolha o trimestre da avaliação: ele será usado no envio ao SIDED+.';
      }
      const v = Number(st.valor_total);
      if (!(v > 0)) return 'Informe um valor total maior que zero.';
      const n = Number(st.num_questoes);
      if (!(n >= 1 && n <= store.MAX_QUESTOES)) return `A quantidade de questões deve ficar entre 1 e ${store.MAX_QUESTOES}.`;
      if (!['4', '5'].includes(String(st.num_alternativas))) return 'Use 4 ou 5 alternativas (limite do layout de leitura).';
      if (store.tem('faixas')) {
        const verde = Number(st.faixa_verde);
        const amarelo = Number(st.faixa_amarelo);
        if (!(verde > amarelo) || amarelo < 0 || verde > 100) {
          return 'As faixas devem ter verde maior que amarelo, entre 0 e 100%.';
        }
      }
    }
    if (i === 4) {
      const semGabarito = st.questoes.filter((q) => !q.gabarito && !q.anulada).length;
      if (semGabarito) return `Defina o gabarito de ${semGabarito} questão(ões).`;
      const soma = somaQuestoes();
      if (soma <= 0) return 'A soma das questões válidas deve ser maior que zero.';
      if (soma > Number(st.valor_total) + 0.01) {
        return `A soma das questões (${fmtNota(soma)}) ultrapassa o valor total (${fmtNota(st.valor_total)}).`;
      }
    }
    return null;
  }

  /* ---------------- Etapas ---------------- */

  function etapaTurmas() {
    return `
      <div class="card stack">
        <div>
          <h2>Quais turmas farão esta avaliação?</h2>
          <p class="small muted">Você pode escolher mais de uma turma. As questões e o gabarito são compartilhados;
          cada turma recebe seus próprios resultados.</p>
        </div>
        ${turmasDisponiveis.length ? `<div class="option-list">
          ${turmasDisponiveis.map((t) => `
            <button type="button" class="option" data-turma="${esc(t.id)}" aria-pressed="${st.turmasSel.includes(t.id)}">
              <span class="grow">
                <span class="opt-title">${esc(t.nome)}</span>
                <span class="opt-sub">${esc(t.ano_serie || '')}${t.turno ? ' · ' + esc(t.turno) : ''}</span>
              </span>
              <span class="opt-mark"></span>
            </button>`).join('')}
        </div>` : `<div class="empty"><h3>Sem turmas vinculadas</h3><p>Fale com a secretaria da escola.</p></div>`}
      </div>`;
  }

  function etapaDisciplinas() {
    return `
      <div class="stack">
        <p class="small muted">As disciplinas abaixo vêm do vínculo turma × disciplina do professor.</p>
        ${st.turmasSel.map((turmaId) => {
          const t = store.turma(turmaId);
          const lista = store.disciplinasDaTurma(turmaId, sessao.professor_id);
          return `
            <div class="card stack tight">
              <div class="card-head">
                <h2>${esc(t?.nome || '')}</h2>
                <span class="xs muted">${lista.length} disciplina(s)</span>
              </div>
              ${lista.length ? `<div class="option-list">
                ${lista.map((x) => `
                  <button type="button" class="option" data-vinculo="${esc(x.vinculo.id)}" data-turma-v="${esc(turmaId)}"
                          aria-pressed="${st.vinculos[turmaId] === x.vinculo.id}">
                    <span class="grow">
                      <span class="opt-title">${esc(x.disciplina.nome)}</span>
                      <span class="opt-sub">Prof. ${esc(x.professor?.nome || 'não informado')}</span>
                    </span>
                    <span class="opt-mark"></span>
                  </button>`).join('')}
              </div>` : `<p class="small muted">Nenhuma disciplina vinculada a você nesta turma.</p>`}
            </div>`;
        }).join('')}
      </div>`;
  }

  function etapaProfessor() {
    return `
      <div class="stack">
        <p class="small muted">O professor responsável vem do vínculo turma × disciplina — não é escolhido manualmente.</p>
        ${st.turmasSel.map((turmaId) => {
          const v = store.vinculo(st.vinculos[turmaId]);
          const prof = v ? store.professor(v.professor_id) : null;
          const disc = v ? store.disciplina(v.disciplina_id) : null;
          const t = store.turma(turmaId);
          return `
            <div class="card stack tight">
              <div class="card-head">
                <h2>${esc(t?.nome || '')}</h2>
                <span class="badge y">${esc(disc?.nome || '—')}</span>
              </div>
              <div class="option selected" style="cursor:default">
                <span class="avatar">${icon('user', 17)}</span>
                <span class="grow">
                  <span class="opt-title">${esc(prof?.nome || '—')}</span>
                  <span class="opt-sub">Professor responsável pela disciplina</span>
                </span>
              </div>
            </div>`;
        }).join('')}
        <div class="saved-note">
          ${icon('info', 16)}
          <span>As notas serão registradas em cada turma, na disciplina e para o professor indicados acima.</span>
        </div>
      </div>`;
  }

  function etapaDados() {
    return `
      <div class="card stack">
        <div>
          <h2>Dados da avaliação</h2>
          <p class="small muted">Questões e gabarito na próxima etapa.</p>
        </div>
        <div class="form-grid">
          <div class="field">
            <label class="label" for="titulo">Título</label>
            <input id="titulo" class="input" data-campo="titulo" value="${esc(st.titulo)}"
                   placeholder="Ex.: Avaliação bimestral de Matemática" />
          </div>
          <div class="field">
            <label class="label" for="descricao">Descrição <span class="muted small">(opcional)</span></label>
            <input id="descricao" class="input" data-campo="descricao" value="${esc(st.descricao)}"
                   placeholder="Ex.: 4º bimestre · frações" />
          </div>
          <div class="field">
            <label class="label" for="cod-caderno">Código do caderno</label>
            <input id="cod-caderno" class="input mono" data-campo="codigo_caderno" maxlength="50"
                   value="${esc(st.codigo_caderno)}" placeholder="Ex.: P0M01-LP-2026"
                   autocapitalize="characters" spellcheck="false" />
            <span class="hint">Até 50 caracteres. Este é o conteúdo do QR Code impresso no cartão e a chave usada na leitura.</span>
          </div>
          <div class="form-grid two">
            <div class="field">
              <label class="label" for="data">Data de aplicação</label>
              <input id="data" class="input" type="date" data-campo="data_aplicacao" value="${esc(st.data_aplicacao)}" />
            </div>
            <div class="field">
              <label class="label" for="valor">Valor total</label>
              <input id="valor" class="input" type="number" min="0" step="0.5" inputmode="decimal"
                     data-campo="valor_total" value="${esc(st.valor_total)}" />
            </div>
          </div>
          <div class="form-grid two">
            <div class="field">
              <label class="label" for="nq">Quantidade de questões</label>
              <input id="nq" class="input" type="number" min="1" max="${store.MAX_QUESTOES}" inputmode="numeric"
                     data-campo="num_questoes" value="${esc(st.num_questoes)}" />
              <span class="hint">Até ${store.MAX_QUESTOES} questões.</span>
            </div>
            <div class="field">
              <label class="label" for="na">Alternativas por questão</label>
              <select id="na" class="select" data-campo="num_alternativas">
                ${[4, 5].map((n) => `<option value="${n}" ${Number(st.num_alternativas) === n ? 'selected' : ''}>${n} (${store.ALTERNATIVAS.slice(0, n).join(', ')})</option>`).join('')}
              </select>
            </div>
          </div>

          ${store.tem('trimestre') ? `
          <div class="field">
            <label class="label" for="trimestre">Trimestre${st.integra_sided ? '' : ' <span class="muted small">(opcional)</span>'}</label>
            <select id="trimestre" class="select" data-campo="trimestre" ${avEdicao && store.trimestreTravado(avEdicao) ? 'disabled' : ''}>
              <option value="" ${st.trimestre ? '' : 'selected'}>Selecione</option>
              ${[1, 2, 3].map((t) => `<option value="${t}" ${String(t) === String(st.trimestre) ? 'selected' : ''}>${t}º trimestre</option>`).join('')}
            </select>
            <span class="hint">${avEdicao && store.trimestreTravado(avEdicao)
              ? 'Já há notas enviadas ao SIDED+ desta avaliação; o trimestre não pode mais ser alterado.'
              : 'Usado no envio ao SIDED+. Você não precisará escolher de novo na hora de enviar.'}</span>
          </div>` : `
          <div class="alert y">${icon('info', 16)}
            <span>O trimestre depende da coluna <span class="mono xs">trimestre</span> em
            <span class="mono xs">sicep_avaliacoes</span>, que ainda não existe no banco. Sem ela não é possível enviar notas ao SIDED+.</span>
          </div>`}

          ${store.tem('prazo') ? `
          <div class="field">
            <label class="label" for="prazo">Prazo para correção <span class="muted small">(opcional)</span></label>
            <input id="prazo" class="input" type="datetime-local" data-campo="prazo_correcao" value="${esc(st.prazo_correcao)}" />
            <span class="hint">O sistema avisa quando o prazo vence ou já venceu.</span>
          </div>` : `
          <div class="alert y">${icon('info', 16)}
            <span>O prazo de correção depende da coluna <span class="mono xs">prazo_correcao</span> em
            <span class="mono xs">sicep_avaliacoes</span>, que ainda não existe no banco.</span>
          </div>`}

          ${store.tem('faixas') ? `
          <div class="form-grid two">
            <div class="field">
              <label class="label" for="fv">Faixa verde a partir de (%)</label>
              <input id="fv" class="input" type="number" min="1" max="100" inputmode="numeric"
                     data-campo="faixa_verde" value="${esc(st.faixa_verde)}" />
            </div>
            <div class="field">
              <label class="label" for="fa">Faixa amarela a partir de (%)</label>
              <input id="fa" class="input" type="number" min="0" max="99" inputmode="numeric"
                     data-campo="faixa_amarelo" value="${esc(st.faixa_amarelo)}" />
            </div>
          </div>
          <p class="hint">Abaixo da faixa amarela o desempenho aparece em vermelho.</p>` : `
          <p class="hint">Faixas fixas nesta versão: verde ≥ 80%, amarelo ≥ 60%. A configuração por avaliação
          depende de colunas que ainda não existem no banco.</p>`}

          <label class="row" style="gap:10px;padding:6px 0;cursor:pointer">
            <input type="checkbox" data-campo="integra_sided" ${st.integra_sided ? 'checked' : ''} style="width:18px;height:18px;accent-color:#F2B600" />
            <span>
              <span class="strong small">Registrar nota no SIDED+</span>
              <span class="xs muted" style="display:block">Depois da correção confirmada, a nota é enviada ao diário.</span>
            </span>
          </label>
        </div>
      </div>`;
  }

  function etapaQuestoes() {
    const alts = letras();
    const soma = somaQuestoes();
    return `
      <div class="card stack tight">
        <div class="row between wrap">
          <div>
            <h2>Questões e gabarito</h2>
            <p class="small muted">${st.questoes.length} questões · ${fmtNota(st.valor_total)} pontos</p>
          </div>
          <span class="badge ${Math.abs(soma - Number(st.valor_total)) > 0.05 ? 'warn' : 'ok'}">
            Soma: ${fmtNota(soma)}
          </span>
        </div>

        <div>
          ${avisoHabilidades()}
          ${st.questoes.map((q) => `
            <div class="q-row ${q.anulada ? 'anulada' : ''}">
              <span class="q-num">${q.numero}</span>
              <div class="q-body">
                <input class="input q-enunciado" data-enunciado="${q.numero}"
                       placeholder="Enunciado (opcional)" value="${esc(q.enunciado || '')}" />
                <div class="q-tools">
                  <label class="row small muted" style="gap:6px">
                    Valor
                    <input class="input valor-input" type="number" min="0" step="0.01" inputmode="decimal"
                           data-valor="${q.numero}" value="${q.valor}" ${q.anulada ? 'disabled' : ''} />
                  </label>
                  ${q.anulada ? `<span class="badge err">Anulada</span>` : `
                    <div class="row small muted" style="gap:6px">
                      Gabarito
                      <div class="seg" data-seg="${q.numero}" role="group" aria-label="Gabarito da questão ${q.numero}">
                        ${alts.map((a) => `
                          <button type="button" data-q="${q.numero}" data-alt="${a}"
                                  class="${q.gabarito === a ? 'on' : ''}">${a}</button>`).join('')}
                      </div>
                    </div>`}
                  ${store.tem('anulada') ? `
                  <button type="button" class="btn btn-ghost btn-sm" data-anular="${q.numero}">
                    ${q.anulada ? 'Reativar' : 'Anular'}
                  </button>` : ''}
                </div>
                ${blocoHabilidades(q)}
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function etapaRevisao() {
    return `
      <div class="card stack">
        <div>
          <h2>Confira antes de salvar</h2>
          <p class="small muted">A avaliação será criada pronta para gerar cartões.</p>
        </div>

        <div class="kv-list">
          <div><span class="k">Título</span><span class="v">${esc(st.titulo)}</span></div>
          <div><span class="k">Código do caderno</span><span class="v mono">${esc(st.codigo_caderno || 'SICEP-A')}</span></div>
          <div><span class="k">Turmas</span><span class="v">${st.turmasSel.map((t) => esc(store.turma(t)?.nome || '')).join(' · ')}</span></div>
          <div><span class="k">Disciplinas</span><span class="v">${st.turmasSel.map((t) => esc(store.disciplina(store.vinculo(st.vinculos[t])?.disciplina_id)?.nome || '')).join(' · ')}</span></div>
          <div><span class="k">Aplicação</span><span class="v">${fmtData(st.data_aplicacao)}</span></div>
          ${store.tem('trimestre') ? `<div><span class="k">Trimestre</span><span class="v">${st.trimestre ? st.trimestre + 'º' : 'não definido'}</span></div>` : ''}
          ${store.tem('prazo') ? `<div><span class="k">Prazo de correção</span><span class="v">${st.prazo_correcao ? fmtDataHora(st.prazo_correcao) : 'sem prazo'}</span></div>` : ''}
          <div><span class="k">Valor total</span><span class="v">${fmtNota(st.valor_total)} pontos</span></div>
          <div><span class="k">Questões</span><span class="v">${st.questoes.length} · ${st.num_alternativas} alternativas</span></div>
          <div><span class="k">Habilidades</span><span class="v">${st.questoes.filter((q) => (q.habilidades || []).length).length} questão(ões) com habilidade</span></div>
          ${store.tem('faixas') ? `<div><span class="k">Faixas</span><span class="v">verde ≥ ${st.faixa_verde}% · amarelo ≥ ${st.faixa_amarelo}%</span></div>` : ''}
          <div><span class="k">SIDED+</span><span class="v">${st.integra_sided ? 'Nota será registrada' : 'Não integra'}</span></div>
        </div>

        <div style="overflow-x:auto">
          <table class="gab-table">
            <thead><tr><th>Questão</th><th>Valor</th><th>Gabarito</th></tr></thead>
            <tbody>
              ${st.questoes.map((q) => `
                <tr>
                  <td>${q.numero}</td>
                  <td>${q.anulada ? '—' : fmtNota(q.valor)}</td>
                  <td class="g">${q.anulada ? 'anulada' : esc(q.gabarito || '—')}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  /* ---------------- Render ---------------- */

  /* ---------------- Habilidades (Etapa 4B) ---------------- */

  const acharQuestao = (numero) => (st.questoes || []).find((q) => Number(q.numero) === Number(numero)) || null;

  function vinculosSelecionados() {
    return [...new Set(st.turmasSel.map((t) => st.vinculos[t]).filter(Boolean))];
  }

  function trimestreDaAvaliacao() {
    const t = Number(st.trimestre);
    return [1, 2, 3].includes(t) ? t : null;
  }

  function blocoHabilidades(q) {
    const codigos = q.habilidades || [];
    const chips = codigos.length
      ? `<div class="chips">${codigos.map((cod) => {
        const info = store.habilidadePorCodigo(cod);
        const titulo = info?.descricao || 'Habilidade vinculada';
        return `<button type="button" class="chip on" data-hab-remover="${q.numero}" data-codigo="${esc(cod)}" title="${esc(titulo)}">${esc(cod)} ${icon('close', 13)}</button>`;
      }).join('')}</div>`
      : '<span class="xs muted">Sem habilidade vinculada</span>';
    return `
      <div class="row wrap" style="gap:8px;align-items:center">
        ${chips}
        <button type="button" class="btn btn-ghost btn-sm" data-hab-abrir="${q.numero}">
          ${icon('plus', 14)} Habilidades
        </button>
      </div>`;
  }

  function avisoHabilidades() {
    const erro = store.erroDeHabilidades();
    if (erro) {
      return `<div class="alert warn">${icon('info', 16)}<span><strong>Habilidades indisponíveis agora.</strong> ${esc(erro)} As habilidades já vinculadas foram mantidas.</span></div>`;
    }
    if (!store.tem('habilidades')) {
      return `<div class="alert y">${icon('info', 16)}<span>As habilidades do planejamento não estão disponíveis neste ambiente. As questões podem ser salvas sem habilidade.</span></div>`;
    }
    if (!store.habilidades().length) {
      return `<div class="alert y">${icon('info', 16)}<span>Nenhuma habilidade cadastrada no planejamento para as suas turmas/disciplinas. As questões podem ser salvas sem habilidade.</span></div>`;
    }
    return '';
  }

  function abrirSeletorHabilidades(numero) {
    const q = acharQuestao(numero);
    if (!q) return;
    if (!q.habilidades) q.habilidades = [];

    const antes = [...q.habilidades];
    const vinculos = vinculosSelecionados();
    const erro = store.erroDeHabilidades();
    let busca = '';

    const back = el('<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-label="Habilidades da questão"></div></div>');
    const caixa = back.querySelector('.modal');
    document.body.append(back);

    const listaAtual = () => store.habilidadesDoContexto(vinculos);

    function contextoDe(item) {
      const faltam = vinculos.filter((v) => !item.vinculos.includes(v));
      if (!faltam.length) return '';
      const nomes = [...new Set(faltam.map((v) => store.turma(store.vinculo(v)?.turma_id)?.nome).filter(Boolean))];
      return nomes.length ? `Só em ${nomes.join(', ')}` : '';
    }

    caixa.innerHTML = `
      <div class="row between" style="align-items:flex-start">
        <div>
          <h2 style="margin:0">Habilidades · Questão ${numero}</h2>
          <p class="xs muted" style="margin:2px 0 0">
            <span data-contador></span>
          </p>
        </div>
        <button class="cf-btn dark" type="button" data-hab-fechar aria-label="Fechar">${icon('close', 18)}</button>
      </div>
      ${erro ? `<div class="alert warn">${icon('info', 16)}<span>${esc(erro)} As habilidades já vinculadas foram mantidas.</span></div>` : ''}
      <div class="field">
        <label class="label" for="hab-busca">Pesquisar</label>
        <input id="hab-busca" class="input" type="search" placeholder="Código, descrição ou tema" data-hab-busca autocomplete="off" />
      </div>
      <div style="max-height:46dvh;overflow-y:auto" data-hab-lista></div>
      <div class="btn-group">
        <button class="btn btn-outline" type="button" data-hab-cancelar>Cancelar</button>
        <button class="btn btn-primary" type="button" data-hab-ok>Concluído</button>
      </div>`;

    const entrada = caixa.querySelector('[data-hab-busca]');
    const lista = caixa.querySelector('[data-hab-lista]');
    const contador = caixa.querySelector('[data-contador]');

    function desenharContador() {
      const n = q.habilidades.length;
      contador.textContent = n ? `${n} habilidade(s) nesta questão` : 'Nenhuma habilidade nesta questão';
    }

    function desenharLista() {
      const termo = busca.trim().toLowerCase();
      const todas = listaAtual();
      const itens = termo
        ? todas.filter((h) => h.codigo.toLowerCase().includes(termo)
          || h.descricao.toLowerCase().includes(termo)
          || h.temas.some((t) => t.toLowerCase().includes(termo)))
        : todas;

      desenharContador();

      if (!itens.length) {
        lista.innerHTML = `<p class="small muted" style="padding:10px 0">${
          todas.length ? 'Nenhuma habilidade corresponde à pesquisa.'
            : (erro ? 'Nenhuma habilidade carregada. Você pode salvar as questões sem habilidade.'
              : 'Nenhuma habilidade cadastrada para estas turmas/disciplinas.')
        }</p>`;
        return;
      }

      lista.innerHTML = itens.map((h) => {
        const sel = q.habilidades.includes(h.codigo);
        const ctx = contextoDe(h);
        const local = h.divisoes?.length
          ? h.divisoes.join(' · ')
          : (h.trimestre ? `${h.trimestre}º trimestre` : 'Trimestre não identificado');
        return `
          <button type="button" class="option" data-hab="${esc(h.codigo)}" aria-pressed="${sel}" style="margin-bottom:8px">
            <span class="grow">
              <span class="opt-title mono">${esc(h.codigo)}${sel ? ' ✓' : ''}</span>
              <span class="opt-sub" style="display:block">${esc(h.descricao || 'Sem descrição')}</span>
              <span class="xs muted" style="display:block;margin-top:2px">
                ${esc(local)}${h.temas.length ? ' · ' + esc(h.temas.join(', ')) : ''}${ctx ? ' · ' + esc(ctx) : ''}
              </span>
            </span>
            <span class="opt-mark"></span>
          </button>`;
      }).join('');

      lista.querySelectorAll('[data-hab]').forEach((b) => {
        b.addEventListener('click', () => {
          const codigo = b.dataset.hab;
          if (q.habilidades.includes(codigo)) q.habilidades = q.habilidades.filter((c) => c !== codigo);
          else q.habilidades.push(codigo);
          q.tocaHabilidade = true;
          desenharLista();
        });
      });
    }

    const fechar = (descartar = false) => {
      if (descartar) q.habilidades = antes;
      back.remove();
      pintar();
    };

    caixa.querySelector('[data-hab-fechar]').addEventListener('click', () => fechar(true));
    caixa.querySelector('[data-hab-cancelar]').addEventListener('click', () => fechar(true));
    caixa.querySelector('[data-hab-ok]').addEventListener('click', () => fechar(false));
    entrada.addEventListener('input', () => { busca = entrada.value; desenharLista(); });
    back.addEventListener('click', (ev) => { if (ev.target === back) fechar(true); });

    desenharLista();
  }

  /* ---------------- Render ---------------- */

  function pintar() {
    const pct = Math.round(((st.etapa + 1) / ETAPAS.length) * 100);
    const corpo = [etapaTurmas, etapaDisciplinas, etapaProfessor, etapaDados, etapaQuestoes, etapaRevisao][st.etapa]();

    root.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">Nova avaliação</span>
        <h1>${avEdicao ? 'Editar avaliação' : st.etapa === 0 ? 'Vamos começar' : 'Criar avaliação'}</h1>
      </div>

      <div class="wizard-head">
        <div class="step-meta">
          <span class="small strong">Etapa ${st.etapa + 1} de ${ETAPAS.length} · ${ETAPAS[st.etapa]}</span>
          <span class="xs muted">${pct}%</span>
        </div>
        <div class="progress"><span style="width:${pct}%"></span></div>
      </div>

      ${corpo}

      <div class="btn-group">
        ${st.etapa > 0 ? `<button class="btn btn-outline" type="button" data-voltar>${icon('left', 16)} Voltar</button>` : ''}
        <button class="btn btn-primary" type="button" data-avancar ${st.salvando ? 'disabled' : ''}>
          ${st.salvando ? 'Salvando…' : st.etapa === ETAPAS.length - 1 ? (avEdicao ? 'Salvar alterações' : 'Salvar avaliação') : 'Continuar'}
        </button>
      </div>
    `;

    ligarEventos();
  }

  function ligarEventos() {
    root.querySelectorAll('[data-turma]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.turma;
        if (st.turmasSel.includes(id)) {
          st.turmasSel = st.turmasSel.filter((x) => x !== id);
          delete st.vinculos[id];
        } else {
          st.turmasSel.push(id);
        }
        pintar();
      });
    });

    root.querySelectorAll('[data-vinculo]').forEach((b) => {
      b.addEventListener('click', () => {
        st.vinculos[b.dataset.turmaV] = b.dataset.vinculo;
        pintar();
      });
    });

    root.querySelectorAll('[data-campo]').forEach((campo) => {
      const nome = campo.dataset.campo;
      const ev = campo.type === 'checkbox' || campo.tagName === 'SELECT' ? 'change' : 'input';
      campo.addEventListener(ev, () => {
        if (campo.type === 'checkbox') st[nome] = campo.checked;
        else st[nome] = campo.value;
        if (['num_questoes', 'num_alternativas', 'valor_total'].includes(nome)) {
          // Guarda as habilidades por número antes de regenerar as questões.
          st.habilidadesPorNumero = {};
          (st.questoes || []).forEach((q) => { st.habilidadesPorNumero[q.numero] = [...(q.habilidades || [])]; });
          st.questoes = null;
        }
      });
    });

    root.querySelectorAll('[data-hab-abrir]').forEach((b) => {
      b.addEventListener('click', () => abrirSeletorHabilidades(Number(b.dataset.habAbrir)));
    });

    root.querySelectorAll('[data-hab-remover]').forEach((b) => {
      b.addEventListener('click', () => {
        const q = acharQuestao(Number(b.dataset.habRemover));
        if (!q) return;
        q.habilidades = (q.habilidades || []).filter((c) => c !== b.dataset.codigo);
        q.tocaHabilidade = true;
        pintar();
      });
    });

    root.querySelectorAll('[data-valor]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = st.questoes.find((x) => x.numero === Number(inp.dataset.valor));
        if (q) q.valor = Number(inp.value) || 0;
      });
    });

    root.querySelectorAll('[data-enunciado]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = st.questoes.find((x) => x.numero === Number(inp.dataset.enunciado));
        if (q) q.enunciado = inp.value;
      });
    });

    root.querySelectorAll('[data-q][data-alt]').forEach((b) => {
      b.addEventListener('click', () => {
        const numero = Number(b.dataset.q);
        const q = st.questoes.find((x) => x.numero === numero);
        if (!q) return;
        q.gabarito = b.dataset.alt;
        const seg = root.querySelector(`[data-seg="${numero}"]`);
        if (seg) seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.alt === q.gabarito));
      });
    });

    root.querySelectorAll('[data-anular]').forEach((b) => {
      b.addEventListener('click', () => {
        const q = st.questoes.find((x) => x.numero === Number(b.dataset.anular));
        if (!q) return;
        q.anulada = !q.anulada;
        if (q.anulada) q.gabarito = null;
        pintar();
      });
    });

    root.querySelector('[data-voltar]')?.addEventListener('click', () => {
      if (st.etapa > 0) { st.etapa -= 1; pintar(); }
    });

    root.querySelector('[data-avancar]').addEventListener('click', avancar);
  }

  async function avancar() {
    if (st.salvando) return;
    const erro = erroEtapa();
    if (erro) { toast(erro, 'err'); return; }

    if (st.etapa === 3) garantirQuestoes();

    if (st.etapa < ETAPAS.length - 1) {
      st.etapa += 1;
      pintar();
      return;
    }

    st.salvando = true;
    pintar();

    try {
      const idSalvo = await store.salvarAvaliacao({
        id: avEdicao?.id || null,
        codigo_caderno: st.codigo_caderno,
        titulo: st.titulo.trim(),
        descricao: st.descricao.trim(),
        data_aplicacao: st.data_aplicacao,
        prazo_correcao: st.prazo_correcao || null,
        trimestre: st.trimestre ? Number(st.trimestre) : null,
        valor_total: Number(st.valor_total),
        num_alternativas: Number(st.num_alternativas),
        lancar_sided: st.integra_sided,
        faixas: { verde: Number(st.faixa_verde), amarelo: Number(st.faixa_amarelo) },
        questoes: st.questoes.map((q) => {
          const codigos = [...new Set((q.habilidades || []).map((c) => String(c).trim()).filter(Boolean))];
          const item = {
            numero: q.numero,
            enunciado: q.enunciado || '',
            valor: Number(q.valor),
            gabarito: q.gabarito,
            anulada: !!q.anulada,
          };
          // Códigos separados por vírgula em sicep_questoes.habilidade_bncc.
          if (codigos.length) item.habilidade_bncc = codigos.join(',');
          else if (q.tocaHabilidade) item.habilidade_bncc = null; // desvinculou de propósito
          return item;
        }),
        aplicacoes: st.turmasSel.map((turmaId) => {
          const v = store.vinculo(st.vinculos[turmaId]);
          return {
            turma_id: turmaId,
            turma_disciplina_id: v.id,
            disciplina_id: v.disciplina_id,
            professor_id: v.professor_id,
          };
        }),
        disciplina: [...new Set(st.turmasSel.map((t) =>
          store.disciplina(store.vinculo(st.vinculos[t])?.disciplina_id)?.nome
        ).filter(Boolean))].join(', '),
      });

      const salva = store.avaliacao(idSalvo);
      const semRede = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (salva?.sync === 'conflito') {
        toast('A avaliação foi alterada na nuvem enquanto você editava. Resolva o conflito na avaliação.', 'err');
      } else if (salva?.sync === 'erro') {
        toast('A nuvem recusou o envio. Seus dados continuam guardados neste aparelho — veja os envios pendentes.', 'err');
      } else if (store.avaliacaoPendente(salva)) {
        toast(semRede
          ? (avEdicao ? 'Sem internet: alterações salvas neste aparelho. Serão enviadas quando a conexão voltar.' : 'Sem internet: avaliação salva neste aparelho. Será enviada quando a conexão voltar.')
          : 'Salvo neste aparelho. O envio à nuvem será refeito automaticamente.', 'ok');
      } else {
        toast(avEdicao ? 'Avaliação atualizada.' : 'Avaliação criada com sucesso.', 'ok');
      }
      location.hash = '#/avaliacoes/' + idSalvo;
    } catch (e) {
      st.salvando = false;
      pintar();
      toast('Não foi possível salvar: ' + e.message, 'err');
    }
  }

  pintar();
  return root;
}

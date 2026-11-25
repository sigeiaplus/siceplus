import * as store from '../store.js';
import {
  el, esc, icon, fmtData, fmtNota, statusAvaliacao,
  iniciais, prazoChip, badge, toast, syncAvaliacaoBadge, reagirEnquantoVisivel,
} from '../ui.js';

export default function avaliacaoDetalhe(params) {
  let av = store.avaliacao(params[0]);
  const avId = params[0];

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

  /* ---------------- Chamada (resumo; a marcação fica na tela própria) ---------------- */

  function blocoParticipacao(apl) {
    if (!store.participacaoDisponivel()) return '';
    const rs = store.resumoParticipacao(av, apl.turma_id);
    return `
      <div class="part-box">
        <div class="row between wrap" style="gap:8px;align-items:center">
          <h3 class="part-tit" style="margin:0">Chamada</h3>
          <a class="btn btn-outline btn-sm" href="#/avaliacoes/chamada/${esc(av.id)}/${esc(apl.turma_id)}">${icon('users', 14)} Fazer chamada</a>
        </div>
        <div class="part-sum" style="margin-top:8px">
          <span class="badge ok">Presentes <strong>${rs.presentes}</strong></span>
          <span class="badge err">Faltas <strong>${rs.ausentes}</strong></span>
          <span class="badge warn">Pendentes <strong>${rs.pendentes}</strong></span>
        </div>
        <p class="xs muted" style="margin:6px 0 0">Avaliações realizadas: ${rs.realizadas} de ${rs.total}</p>
      </div>`;
  }

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
    const aguardando = store.pendentesDeEnvio(av.id, apl.turma_id);
    const enviadas = store.jaEnviados(av.id, apl.turma_id);
    const triOk = [1, 2, 3].includes(Number(av.trimestre));

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

        ${blocoParticipacao(apl)}

        ${pendentes.length ? `
          <div class="row wrap" style="margin-top:12px;gap:8px">
            <a class="btn btn-outline btn-sm" href="#/resultados">
              ${icon('check', 14)} Revisar ${pendentes.length} pendente(s) em Resultados
            </a>
          </div>` : ''}

        ${av.lancar_sided ? `
          <div style="margin-top:16px">
            <h3 style="margin:0 0 6px;font-size:15px">Envio ao SIDED+</h3>
            <div class="kv-list">
              <div><span class="k">Avaliação</span><span class="v">${esc(av.titulo)}</span></div>
              <div><span class="k">Turma · Disciplina</span><span class="v">${esc(t?.nome || '—')} · ${esc(disc?.nome || '—')}</span></div>
              <div><span class="k">Trimestre</span><span class="v">${triOk ? `${av.trimestre}º` : 'não definido'}</span></div>
              <div><span class="k">Aguardando envio</span><span class="v">${aguardando.length}</span></div>
              <div><span class="k">Já enviadas</span><span class="v">${enviadas.length}</span></div>
              <div><span class="k">Pendentes de revisão</span><span class="v">${pendentes.length}</span></div>
            </div>
            ${triOk ? '' : `<div class="alert warn" style="margin-top:10px">${icon('info', 16)}<span>Defina o trimestre em “Dados da avaliação” para liberar o envio.</span></div>`}
            <div class="row wrap" style="margin-top:12px;gap:8px">
              <button class="btn btn-primary btn-sm" type="button" data-previa="${esc(apl.turma_id)}" ${aguardando.length && triOk ? '' : 'disabled'}>
                ${icon('cloud', 14)} Revisar e enviar ${aguardando.length} nota(s)
              </button>
            </div>
            ${!aguardando.length && !pendentes.length && !enviadas.length ? '<p class="xs muted" style="margin-top:8px">Nenhuma nota corrigida ainda.</p>' : ''}
            ${!aguardando.length && pendentes.length ? '<p class="xs muted" style="margin-top:8px">Confirme a revisão dos pendentes em Resultados para que entrem no envio.</p>' : ''}
          </div>` : ''}

        <p class="xs muted" style="margin-top:12px">
          O detalhe aluno por aluno fica em <a href="#/resultados">Resultados</a>.
        </p>
      </section>`;
  }

  /* ---------------- Prévia, envio e resultado ---------------- */

  const nomeAluno = (id) => store.aluno(id)?.nome_completo || '—';

  function abrirPrevia(turmaId) {
    const apl = store.aplicacaoDe(av, turmaId);
    if (!apl) return;
    const t = store.turma(turmaId);
    const disc = store.disciplina(apl.disciplina_id);

    const back = el('<div class="modal-back"><div class="modal res-modal" role="dialog" aria-modal="true" aria-label="Enviar notas ao SIDED+"></div></div>');
    const caixa = back.querySelector('.modal');
    document.body.append(back);

    const fechar = () => { back.remove(); pintar(); };
    let enviando = false;
    let totalEnviados = 0;
    let falhas = [];
    let aviso = null;
    let terminou = false;

    function cabecalho() {
      return `
        <div class="kv-list">
          <div><span class="k">Avaliação</span><span class="v">${esc(av.titulo)}</span></div>
          <div><span class="k">Turma</span><span class="v">${esc(t?.nome || '—')}</span></div>
          <div><span class="k">Disciplina</span><span class="v">${esc(disc?.nome || '—')}</span></div>
          <div><span class="k">Trimestre</span><span class="v">${av.trimestre ? `${av.trimestre}º` : '—'}</span></div>
        </div>`;
    }

    function desenhar() {
      if (terminou) return desenharResultado();
      const lista = store.pendentesDeEnvio(av.id, turmaId)
        .slice().sort((a, b) => nomeAluno(a.aluno_id).localeCompare(nomeAluno(b.aluno_id), 'pt-BR'));
      const n = lista.length;

      caixa.innerHTML = `
        <div class="row between" style="align-items:flex-start">
          <div>
            <h2 style="margin:0">Enviar notas ao SIDED+</h2>
            <p class="xs muted" style="margin:2px 0 0">Confira o que será enviado. Só entram notas revisadas, confirmadas e ainda não enviadas.</p>
          </div>
          <button class="cf-btn dark" type="button" data-fechar aria-label="Fechar" ${enviando ? 'disabled' : ''}>${icon('close', 18)}</button>
        </div>
        ${cabecalho()}
        <div style="overflow-x:auto;max-height:42dvh;overflow-y:auto">
          <table class="gab-table">
            <thead><tr><th style="text-align:left">Aluno</th><th>Nota</th></tr></thead>
            <tbody>
              ${lista.map((r) => `
                <tr>
                  <td style="text-align:left">${esc(nomeAluno(r.aluno_id))}${r.situacao && r.situacao !== 'normal' ? ` <span class="xs muted">(${esc(r.situacao)})</span>` : ''}</td>
                  <td>${fmtNota(r.nota)}</td>
                </tr>`).join('') || '<tr><td colspan="2" class="muted">Nenhuma nota para enviar.</td></tr>'}
            </tbody>
          </table>
        </div>
        <p class="small"><strong>${n}</strong> nota(s) serão enviadas.</p>
        <div class="btn-group">
          <button class="btn btn-outline" type="button" data-fechar ${enviando ? 'disabled' : ''}>Cancelar</button>
          <button class="btn btn-primary" type="button" data-enviar ${n && !enviando ? '' : 'disabled'}>
            ${icon('cloud', 16)} ${enviando ? 'Enviando…' : `ENVIAR ${n} NOTA${n === 1 ? '' : 'S'} AO SIDED+`}
          </button>
        </div>`;
      caixa.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', fechar));
      caixa.querySelector('[data-enviar]')?.addEventListener('click', () => executar(null));
    }

    function desenharResultado() {
      caixa.innerHTML = `
        <div class="row between" style="align-items:flex-start">
          <h2 style="margin:0">Resultado do envio</h2>
          <button class="cf-btn dark" type="button" data-fechar aria-label="Fechar" ${enviando ? 'disabled' : ''}>${icon('close', 18)}</button>
        </div>
        ${cabecalho()}
        <div class="kv-list">
          <div><span class="k">Enviadas com sucesso</span><span class="v">${totalEnviados}</span></div>
          <div><span class="k">Com falha</span><span class="v">${falhas.length}</span></div>
        </div>
        ${aviso ? `<div class="alert warn">${icon('info', 16)}<span>${esc(aviso)}</span></div>` : ''}
        ${falhas.length ? `
          <div class="alert err">${icon('alert', 16)}
            <span><strong>Precisam de atenção:</strong><br>
            ${falhas.map((f) => `${esc(nomeAluno(f.aluno_id))} — ${esc(f.erro)}`).join('<br>')}</span>
          </div>
          <p class="xs muted">As notas que falharam continuam aguardando envio. As que já foram enviadas não serão enviadas de novo.</p>` : `
          <div class="alert ok">${icon('check', 16)}<span>Todas as notas foram enviadas.</span></div>`}
        <div class="btn-group">
          <button class="btn btn-outline" type="button" data-fechar>Fechar</button>
          ${falhas.length ? `<button class="btn btn-primary" type="button" data-retentar ${enviando ? 'disabled' : ''}>${enviando ? 'Enviando…' : `Tentar de novo as ${falhas.length} que falharam`}</button>` : ''}
        </div>`;
      caixa.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', fechar));
      caixa.querySelector('[data-retentar]')?.addEventListener('click', () => executar(falhas.map((f) => f.resultado_id)));
    }

    async function executar(ids) {
      if (enviando) return;
      enviando = true;
      desenhar();
      const r = await store.enviarAoSided(av.id, turmaId, ids);
      enviando = false;
      if (r.erro && !Array.isArray(r.falhas)) {
        toast(r.erro, 'err');
        desenhar();
        return;
      }
      totalEnviados += r.enviados;
      falhas = r.falhas;
      aviso = r.aviso || aviso;
      terminou = true;
      desenhar();
    }

    back.addEventListener('click', (e) => { if (e.target === back && !enviando) fechar(); });
    desenhar();
  }

  function pintar() {
    const prazo = store.prazoDe(av);
    // Etapa 4B: só mostra a coluna quando há habilidade vinculada.
    const comHabilidades = av.questoes.some((q) => q.habilidade_bncc);

    root.innerHTML = `
      <a class="row small muted" href="#/avaliacoes" style="text-decoration:none">
        ${icon('left', 15)} Avaliações
      </a>

      <div class="page-head">
        <span class="eyebrow">${esc(store.nomeDisciplina(av))}</span>
        <h1>${esc(av.titulo)}</h1>
        <div class="row wrap" style="gap:8px;margin-top:4px">
          ${statusAvaliacao(av.status)}
          ${syncAvaliacaoBadge(av.sync)}
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
          <div><span class="k">Trimestre</span><span class="v">${av.trimestre ? `${av.trimestre}º` : 'não definido'}</span></div>
          <div><span class="k">Prazo de correção</span><span class="v">${esc(prazo.texto)}</span></div>
          <div><span class="k">Valor total</span><span class="v">${fmtNota(av.valor_total)} pontos</span></div>
          <div><span class="k">Questões</span><span class="v">${av.questoes.length} · ${av.layout?.num_alternativas || 5} alternativas</span></div>
          <div><span class="k">Faixas</span><span class="v">verde ≥ ${av.faixas.verde}% · amarelo ≥ ${av.faixas.amarelo}%</span></div>
          <div><span class="k">Código do caderno</span><span class="v mono">${esc(av.layout?.codigo_caderno || 'SICEP-A')}</span></div>
        </div>
        ${av.descricao ? `<p class="small muted" style="margin-top:10px">${esc(av.descricao)}</p>` : ''}

        ${av.lancar_sided && !av.trimestre ? (store.tem('trimestre') ? `
          <div class="alert warn" style="margin-top:12px">${icon('info', 16)}
            <span>Esta avaliação não tem trimestre registrado. Escolha o correto para liberar o envio ao SIDED+.</span>
          </div>
          <div class="row wrap" style="margin-top:8px;gap:8px;align-items:flex-end">
            <div class="field" style="max-width:150px">
              <label class="label" for="def-tri">Trimestre</label>
              <select class="select" id="def-tri" data-def-tri-sel>
                <option value="">Selecione</option>
                <option value="1">1º</option><option value="2">2º</option><option value="3">3º</option>
              </select>
            </div>
            <button class="btn btn-outline btn-sm" type="button" data-def-tri>Definir trimestre</button>
          </div>` : `
          <div class="alert warn" style="margin-top:12px">${icon('info', 16)}
            <span>O banco ainda não tem a coluna <span class="mono xs">trimestre</span> em <span class="mono xs">sicep_avaliacoes</span>. Execute a migração SQL para poder definir o trimestre e enviar notas.</span>
          </div>`) : ''}

        ${av.sync === 'conflito' ? `
          <div class="alert err" style="margin-top:12px">${icon('alert', 16)}
            <span><strong>Conflito de versões.</strong> Esta avaliação foi alterada na nuvem depois do início da sua edição.
            As duas versões estão guardadas: sua versão neste aparelho e a versão da nuvem. Escolha qual manter.
            Nenhuma nota já enviada ao SIDED+ será alterada.</span>
          </div>
          <div class="row wrap" style="margin-top:8px;gap:8px">
            <button class="btn btn-primary btn-sm" type="button" data-conflito-local>${icon('check', 14)} Manter minha versão</button>
            <button class="btn btn-outline btn-sm" type="button" data-conflito-nuvem>${icon('cloud', 14)} Manter versão da nuvem</button>
          </div>` : ''}
        ${store.avaliacaoSoLocal(av) && av.sync !== 'erro' ? `
          <div class="alert warn" style="margin-top:12px">${icon('info', 16)}
            <span>Esta avaliação foi criada neste aparelho e será enviada à nuvem quando houver conexão. Até lá, ela não pode ser editada nem excluída.</span>
          </div>` : (av.sync === 'pendente' && store.avaliacaoPendente(av) ? `
          <div class="alert warn" style="margin-top:12px">${icon('info', 16)}
            <span>Suas alterações estão salvas neste aparelho e serão enviadas à nuvem quando houver conexão.</span>
          </div>` : '')}
        ${av.sync === 'erro' ? `
          <div class="alert err" style="margin-top:12px">${icon('alert', 16)}
            <span>A nuvem recusou o último envio${av.erro_sync ? `: ${esc(av.erro_sync)}` : ''}. Os dados continuam guardados neste aparelho; tente novamente no painel de envios pendentes.</span>
          </div>` : ''}
        <div class="row wrap" style="margin-top:14px;gap:8px">
          ${store.avaliacaoSoLocal(av) || av.sync === 'conflito'
            ? `<button class="btn btn-outline btn-sm" type="button" disabled>${icon('edit', 14)} Editar avaliação</button>`
            : `<a class="btn btn-outline btn-sm" href="#/avaliacoes/editar/${esc(av.id)}">${icon('edit', 14)} Editar avaliação</a>`}
          <button class="btn btn-ghost btn-sm" type="button" data-excluir ${store.avaliacaoSoLocal(av) || av.sync === 'conflito' ? 'disabled' : ''}>${icon('trash', 14)} Excluir</button>
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
            <thead><tr><th>Nº</th><th>Valor</th><th>Gabarito</th>${comHabilidades ? '<th>Habilidades</th>' : ''}</tr></thead>
            <tbody>
              ${av.questoes.map((q) => `
                <tr>
                  <td>${q.numero}</td>
                  <td>${q.anulada ? '—' : fmtNota(q.valor)}</td>
                  <td class="g">${q.anulada ? 'anulada' : esc(q.gabarito)}</td>
                  ${comHabilidades ? `<td class="mono xs">${esc(q.habilidade_bncc || '—')}</td>` : ''}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="xs muted" style="margin-top:10px">Questões anuladas são creditadas a todos os alunos.</p>
      </section>
    `;

    root.querySelector('[data-def-tri]')?.addEventListener('click', async (ev) => {
      const tri = root.querySelector('[data-def-tri-sel]')?.value;
      if (!tri) { toast('Escolha o trimestre.', 'err'); return; }
      const b = ev.currentTarget;
      b.disabled = true;
      const r = await store.definirTrimestre(av.id, tri);
      if (!r.ok) { b.disabled = false; toast(r.erro, 'err'); return; }
      toast(`Trimestre definido: ${tri}º.`, 'ok');
      pintar();
    });

    root.querySelectorAll('[data-previa]').forEach((b) => {
      b.addEventListener('click', () => abrirPrevia(b.dataset.previa));
    });

    root.querySelectorAll('[data-conflito-local], [data-conflito-nuvem]').forEach((b) => {
      b.addEventListener('click', async () => {
        const manterLocal = b.hasAttribute('data-conflito-local');
        const aviso = manterLocal
          ? 'Manter a SUA versão?\n\nA versão da nuvem será substituída pela edição deste aparelho. Notas já enviadas ao SIDED+ não são alteradas.'
          : 'Manter a versão da NUVEM?\n\nA edição feita neste aparelho será descartada. A avaliação e as questões da nuvem continuam como estão.';
        if (!window.confirm(aviso)) return;
        b.disabled = true;
        const r = await store.resolverConflitoDaAvaliacao(av.id, manterLocal ? 'local' : 'nuvem');
        if (!r.ok) { b.disabled = false; toast(r.erro, 'err'); return; }
        toast(manterLocal ? 'Sua versão foi enviada à nuvem.' : 'Versão da nuvem mantida.', 'ok');
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
  reagirEnquantoVisivel(root, store.aoMudarSincronizacao, () => { av = store.avaliacao(avId) || av; pintar(); });
  return root;
}

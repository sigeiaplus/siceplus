/* ============================================================
   SICEP+ · Chamada da avaliação (presente / falta / pendente)

   Tela própria, aberta pelo botão "Chamada" em Avaliações.
   - Uma turma por vez: avaliação com várias turmas pede para escolher a turma.
   - Todos começam PENDENTES. Toque em Presente ou Falta; tocar de novo no
     botão ativo volta o aluno para Pendente.
   - Quem fica com Falta continua com Falta até alguém mudar.
   - Grava no aparelho primeiro (funciona sem internet) e sincroniza depois.
   ============================================================ */

import * as store from '../store.js';
import { el, esc, icon, toast, reagirEnquantoVisivel } from '../ui.js';

export default function chamada(params) {
  const avId = params[0];
  let turmaSel = params[1] || null;
  const root = el('<div class="stack"></div>');

  const av = () => store.avaliacao(avId);

  function vazio(titulo, texto) {
    return `
      <div class="empty">
        <div class="ei">${icon('alert', 20)}</div>
        <h3>${esc(titulo)}</h3>
        <p>${esc(texto)}</p>
        <a class="btn btn-primary" href="#/avaliacoes">Voltar às avaliações</a>
      </div>`;
  }

  const emblema = (rs) => `
    <span class="badge ok">Presentes <strong>${rs.presentes}</strong></span>
    <span class="badge err">Faltas <strong>${rs.ausentes}</strong></span>
    <span class="badge warn">Pendentes <strong>${rs.pendentes}</strong></span>`;

  function telaTurmas(a) {
    return `
      <a class="row small muted" href="#/avaliacoes" style="text-decoration:none">${icon('left', 15)} Avaliações</a>
      <div class="page-head">
        <span class="eyebrow">Chamada</span>
        <h1>${esc(a.titulo)}</h1>
        <p>Escolha a turma para marcar presença e falta.</p>
      </div>
      <div class="stack">
        ${a.aplicacoes.map((apl) => {
          const rs = store.resumoParticipacao(a, apl.turma_id);
          return `
            <button class="card cham-turma" type="button" data-turma="${esc(apl.turma_id)}">
              <div class="row between" style="align-items:center">
                <strong>${esc(store.turma(apl.turma_id)?.nome || 'Turma')}</strong>
                ${icon('chevron', 16)}
              </div>
              <div class="part-sum" style="margin-top:8px">${emblema(rs)}</div>
              <span class="xs muted">${rs.total} aluno(s)</span>
            </button>`;
        }).join('')}
      </div>`;
  }

  function linha(a, apl, aluno) {
    const tid = apl.turma_id;
    const p = store.participacaoDe(a.id, aluno.id, tid);
    const sit = p?.situacao || 'pendente';
    const corrigido = store.alunoTemCartaoCorrigido(a.id, aluno.id, tid);
    const aguardando = p?.sync && p.sync !== 'sincronizado';
    const botao = (v, rotulo, classe) => `
      <button type="button" class="${sit === v ? `on ${classe}` : ''}" aria-pressed="${sit === v}"
        data-marcar="${v}" data-aluno="${esc(aluno.id)}">${rotulo}</button>`;
    return `
      <div class="part-row" data-aluno-row="${esc(aluno.id)}">
        <div class="part-nome">
          <span class="small strong">${esc(aluno.nome_completo)}</span>
          <span class="part-tags">
            ${sit === 'pendente' ? '<span class="badge warn">Pendente</span>' : ''}
            ${corrigido ? '<span class="badge ok">Cartão corrigido</span>' : ''}
            ${corrigido && sit !== 'presente' ? '<span class="badge err">Inconsistente</span>' : ''}
            ${aguardando ? '<span class="badge y">Aguardando envio</span>' : ''}
            ${p?.substituida ? '<span class="badge y">Alterado em outro aparelho</span>' : ''}
          </span>
        </div>
        <div class="seg part-seg" role="group" aria-label="Chamada de ${esc(aluno.nome_completo)}">
          ${botao('presente', 'Presente', 'ok')}
          ${botao('ausente', 'Falta', 'err')}
        </div>
      </div>`;
  }

  function telaTurma(a, apl) {
    const tid = apl.turma_id;
    const t = store.turma(tid);
    const rs = store.resumoParticipacao(a, tid);
    const alunos = store.alunosDaTurma(tid);
    const aEnviar = store.ausenciasParaEnviar(a.id, tid);
    const enviadas = store.ausenciasEnviadas(a.id, tid);
    const triOk = [1, 2, 3].includes(Number(a.trimestre));
    const varias = a.aplicacoes.length > 1;
    const feitos = rs.presentes + rs.ausentes;

    return `
      ${varias
        ? `<button class="row small muted cham-voltar" type="button" data-turmas>${icon('left', 15)} Turmas</button>`
        : `<a class="row small muted" href="#/avaliacoes" style="text-decoration:none">${icon('left', 15)} Avaliações</a>`}
      <div class="page-head">
        <span class="eyebrow">Chamada · ${esc(store.nomeDisciplina(a))}</span>
        <h1>${esc(t?.nome || 'Turma')}</h1>
        <p>${esc(a.titulo)}</p>
      </div>

      ${store.participacaoDisponivel() ? '' : `
        <div class="alert warn">${icon('info', 16)}
          <span>O banco ainda não tem a tabela <span class="mono xs">sicep_participacao</span>. Execute a migração SQL para fazer a chamada.</span>
        </div>`}

      <section class="card">
        <div class="part-sum">${emblema(rs)}</div>
        <div class="progress" style="margin-top:10px">
          <span style="width:${rs.total ? Math.round((feitos / rs.total) * 100) : 0}%"></span>
        </div>
        <p class="xs muted" style="margin:6px 0 0">${feitos} de ${rs.total} com chamada feita · ${rs.realizadas} avaliação(ões) realizada(s)</p>
        ${rs.divergentes ? `<div class="alert warn" style="margin-top:8px">${icon('info', 16)}<span>${rs.divergentes} aluno(s) com cartão corrigido não estão como Presente. As respostas foram preservadas.</span></div>` : ''}
      </section>

      <div class="cham-list">
        ${alunos.map((al) => linha(a, apl, al)).join('') || '<p class="xs muted" style="padding:12px">Nenhum aluno vinculado a esta turma.</p>'}
      </div>
      <p class="xs muted">Toque em Presente ou Falta. Tocar de novo no botão marcado volta para Pendente. Marcar Presente não preenche respostas.</p>

      ${a.lancar_sided && (aEnviar.length || enviadas.length) ? `
        <section class="card">
          <h3 class="part-tit">Faltas no SIDED+</h3>
          <p class="xs muted" style="margin:0 0 8px">${aEnviar.length} aguardando envio · ${enviadas.length} enviada(s). Vão como AUSENTE e NÃO REALIZADO, sem nota.</p>
          <button class="btn btn-outline btn-sm" type="button" data-enviar ${aEnviar.length && triOk ? '' : 'disabled'}>
            ${icon('cloud', 14)} Enviar ${aEnviar.length} falta(s) ao SIDED+
          </button>
          ${triOk ? '' : '<p class="xs muted" style="margin-top:6px">Defina o trimestre da avaliação para liberar o envio.</p>'}
        </section>` : ''}`;
  }

  function pintar() {
    const a = av();
    if (!a) { root.innerHTML = vazio('Avaliação não encontrada', 'Talvez ela tenha sido removida.'); return; }
    if (!a.aplicacoes.length) { root.innerHTML = vazio('Sem turmas', 'Esta avaliação não tem turma vinculada.'); return; }

    if (!turmaSel && a.aplicacoes.length === 1) turmaSel = a.aplicacoes[0].turma_id;
    const apl = turmaSel ? store.aplicacaoDe(a, turmaSel) : null;
    root.innerHTML = apl ? telaTurma(a, apl) : telaTurmas(a);
  }

  root.addEventListener('click', async (ev) => {
    const a = av();
    if (!a) return;

    const escolha = ev.target.closest('[data-turma]');
    if (escolha) { turmaSel = escolha.dataset.turma; pintar(); window.scrollTo?.(0, 0); return; }
    if (ev.target.closest('[data-turmas]')) { turmaSel = null; pintar(); return; }

    const b = ev.target.closest('[data-marcar]');
    if (b && turmaSel) {
      const apl = store.aplicacaoDe(a, turmaSel);
      const alunoId = b.dataset.aluno;
      const atual = store.situacaoDoAluno(a.id, alunoId, turmaSel);
      // Tocar no botão já marcado desfaz: o aluno volta para Pendente.
      const situacao = atual === b.dataset.marcar ? 'pendente' : b.dataset.marcar;
      b.closest('[data-aluno-row]')?.querySelectorAll('button').forEach((x) => { x.disabled = true; });

      let r = await store.definirParticipacao({ avaliacao: a, aplicacao: apl, alunoId, situacao });
      if (r.precisaConfirmar) {
        if (window.confirm(r.motivo)) r = await store.definirParticipacao({ avaliacao: a, aplicacao: apl, alunoId, situacao, confirmado: true });
        else { pintar(); return; }
      }
      if (!r.ok) toast(r.erro, 'err');
      else if (r.pendente) toast(r.mensagem, 'ok');
      else if (r.substituida) toast('Outro aparelho tinha uma alteração mais recente; ela foi mantida.', 'err');
      pintar();
      return;
    }

    const e = ev.target.closest('[data-enviar]');
    if (e && turmaSel) {
      const n = store.ausenciasParaEnviar(a.id, turmaSel).length;
      if (!window.confirm(`Enviar ${n} falta(s) ao SIDED+?\n\nElas vão marcadas como AUSENTE e NÃO REALIZADO, sem nota. Nota já lançada no SIDED+ não é alterada.`)) return;
      e.disabled = true;
      const r = await store.enviarAusenciasAoSided(a.id, turmaSel);
      if (r.erro && !Array.isArray(r.falhas)) toast(r.erro, 'err');
      else if (r.falhas.length) toast(`${r.enviados} enviada(s). ${r.falhas.length} com problema: ${r.falhas[0].erro}`, 'err');
      else toast(r.aviso || `${r.enviados} falta(s) enviada(s) ao SIDED+.`, r.aviso ? 'err' : 'ok');
      pintar();
    }
  });

  pintar();
  reagirEnquantoVisivel(root, store.aoMudarSincronizacao, pintar);
  return root;
}

/* ============================================================
   SIGEIA AVALIAÇÕES · Painel da fila de sincronização (Etapa 6D)

   Mostra os resultados que ainda não chegaram à nuvem, o status de cada um
   (pendente, enviando, erro), e permite tentar de novo ou descartar um item
   que a nuvem recusou. Nada é apagado sem o usuário pedir.
   ============================================================ */

import * as store from '../store.js';
import { el, esc, icon, badge, toast, fmtDataHora } from '../ui.js';

const ROTULO = {
  pendente: ['Aguardando envio', 'warn'],
  sincronizando: ['Enviando…', 'warn'],
  erro: ['Erro no envio', 'err'],
  conflito: ['Conflito de versões', 'err'],
};

let aberto = null;

export function abrirPainelFila() {
  if (aberto) { aberto.fechar(); }

  const back = el('<div class="modal-back" data-modal><div class="modal" role="dialog" aria-modal="true" aria-label="Envios pendentes"></div></div>');
  const caixa = back.querySelector('.modal');
  document.body.append(back);

  let ocupado = false;
  let itens = [];
  const cancelar = store.aoMudarSincronizacao(() => { atualizar(); });
  const fechar = () => { cancelar(); back.remove(); if (aberto?.back === back) aberto = null; };
  aberto = { back, fechar };

  async function atualizar() {
    itens = await store.itensDaFila();
    desenhar();
  }

  function desenhar() {
    const offline = !navigator.onLine;
    caixa.innerHTML = `
      <div class="row between" style="align-items:flex-start">
        <div>
          <h2 style="margin:0">Envios pendentes</h2>
          <p class="xs muted" style="margin:2px 0 0">Avaliações e resultados salvos neste aparelho que ainda não chegaram à nuvem.</p>
        </div>
        <button class="cf-btn dark" type="button" data-fechar aria-label="Fechar">${icon('close', 18)}</button>
      </div>

      ${offline ? `<div class="alert warn">${icon('info', 16)}<span>Sem internet. Tudo continua salvo aqui e será enviado quando a conexão voltar.</span></div>` : ''}

      ${itens.length ? `
        <div class="stack" style="gap:8px">
          ${itens.map((i) => {
            const [rotulo, tipo] = ROTULO[i.status] || ROTULO.pendente;
            return `
            <div class="card" style="padding:10px 12px" data-item="${i.seq}">
              <div class="row between wrap" style="gap:8px">
                <strong class="small">${i.tipo === 'avaliacao' ? `Avaliação: ${esc(i.titulo)}` : i.tipo === 'edicao' ? `Edição: ${esc(i.titulo)}` : esc(i.aluno)}</strong>
                ${badge(rotulo, tipo)}
              </div>
              <div class="xs muted">${esc((i.tipo === 'avaliacao' || i.tipo === 'edicao' ? [i.turma, fmtDataHora(i.criado_em)] : [i.avaliacao, i.turma, fmtDataHora(i.criado_em)]).filter(Boolean).join(' · '))}</div>
              ${i.status === 'conflito' && i.conflito?.servidor ? `<div class="xs muted" style="margin-top:4px">
                Sua versão: ${esc(i.local?.titulo || '—')} (${i.local?.questoes || 0} questões) ·
                Nuvem: ${esc(i.conflito.servidor.titulo || '—')} (${(i.conflito.servidor.questoes || []).length} questões)
              </div>` : ''}
              ${i.erro ? `<div class="xs" style="margin-top:4px;color:var(--err)">${esc(i.erro)}${i.tentativas ? ` (${i.tentativas} tentativa${i.tentativas === 1 ? '' : 's'})` : ''}</div>` : ''}
              ${i.status === 'conflito' ? `
                <div class="row" style="margin-top:6px"><button class="btn btn-outline btn-sm" type="button" data-conflito="${i.seq}">${icon('alert', 14)} Resolver conflito</button></div>` : ''}
              ${i.status === 'erro' && i.permanente ? `
                <div class="row" style="margin-top:6px"><button class="btn btn-outline btn-sm" type="button" data-descartar="${i.seq}" data-tipo="${i.tipo}">${icon('trash', 14)} ${i.tipo === 'avaliacao' ? 'Descartar esta avaliação' : 'Descartar este envio'}</button></div>` : ''}
            </div>`;
          }).join('')}
        </div>` : `
        <div class="alert ok">${icon('check', 16)}<span>Nada pendente: tudo o que foi salvo já está na nuvem.</span></div>`}

      <div class="btn-group">
        <button class="btn btn-outline" type="button" data-fechar>Fechar</button>
        <button class="btn btn-primary" type="button" data-agora ${itens.length && !offline && !ocupado ? '' : 'disabled'}>
          ${icon('refresh', 16)} ${ocupado ? 'Enviando…' : 'Tentar agora'}
        </button>
      </div>`;

    caixa.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', fechar));

    caixa.querySelector('[data-agora]')?.addEventListener('click', async () => {
      ocupado = true;
      desenhar();
      try { await store.tentarSincronizarAgora(); } finally { ocupado = false; await atualizar(); }
    });

    caixa.querySelectorAll('[data-conflito]').forEach((b) => b.addEventListener('click', () => {
      const item = itens.find((x) => x.seq === Number(b.dataset.conflito));
      if (item) abrirResolvedor(item);
    }));

    caixa.querySelectorAll('[data-descartar]').forEach((b) => b.addEventListener('click', async () => {
      const eAvaliacao = b.dataset.tipo === 'avaliacao';
      if (!window.confirm(eAvaliacao
        ? 'Descartar esta avaliação?\n\nA avaliação e suas questões guardadas neste aparelho serão apagadas e NÃO chegarão à nuvem. Resultados já lidos para ela e ainda não enviados também serão descartados.'
        : 'Descartar este envio?\n\nO resultado guardado neste aparelho será apagado e NÃO chegará à nuvem. Será preciso ler o cartão de novo.')) return;
      b.disabled = true;
      await store.descartarItemDaFila(Number(b.dataset.descartar));
      toast('Envio descartado.', 'ok');
      await atualizar();
    }));
  }

  /** Compara a versão local com a da nuvem e deixa o professor escolher qual manter. */
  function abrirResolvedor(item) {
    const local = item.local || {};
    const serv = item.conflito?.servidor || {};
    const back2 = el('<div class="modal-back"><div class="modal res-modal" role="dialog" aria-modal="true" aria-label="Resolver conflito"></div></div>');
    const cx = back2.querySelector('.modal');
    document.body.append(back2);
    let ocupado = false;

    const linha = (rotulo, a, b) => `<tr><td style="text-align:left">${esc(rotulo)}</td><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;

    function desenhar() {
      cx.innerHTML = `
        <div class="row between" style="align-items:flex-start">
          <div>
            <h2 style="margin:0">Resolver conflito</h2>
            <p class="xs muted" style="margin:2px 0 0">Esta avaliação mudou na nuvem enquanto você editava neste aparelho. Nada foi sobrescrito.</p>
          </div>
          <button class="cf-btn dark" type="button" data-fechar aria-label="Fechar" ${ocupado ? 'disabled' : ''}>${icon('close', 18)}</button>
        </div>
        <div style="overflow-x:auto">
          <table class="gab-table">
            <thead><tr><th style="text-align:left">Campo</th><th>Seu aparelho</th><th>Nuvem</th></tr></thead>
            <tbody>
              ${linha('Título', local.titulo || '—', serv.titulo || '—')}
              ${linha('Valor total', local.valor_total ?? '—', serv.valor_total ?? '—')}
              ${linha('Aplicação', local.data_aplicacao || '—', serv.data_aplicacao || '—')}
              ${linha('Trimestre', local.trimestre ?? '—', serv.trimestre ?? '—')}
              ${linha('Questões', local.questoes ?? '—', (serv.questoes || []).length)}
            </tbody>
          </table>
        </div>
        <p class="xs muted">A versão que você não escolher será descartada. Notas já enviadas ao SIDED+ não são alteradas.</p>
        <div class="btn-group">
          <button class="btn btn-outline" type="button" data-fechar ${ocupado ? 'disabled' : ''}>Cancelar</button>
          <button class="btn btn-outline" type="button" data-nuvem ${ocupado ? 'disabled' : ''}>${icon('cloud', 15)} Manter da nuvem</button>
          <button class="btn btn-primary" type="button" data-local ${ocupado ? 'disabled' : ''}>${icon('check', 15)} Manter a minha</button>
        </div>`;
      cx.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => { if (!ocupado) back2.remove(); }));
      cx.querySelector('[data-local]')?.addEventListener('click', () => escolher('local'));
      cx.querySelector('[data-nuvem]')?.addEventListener('click', () => escolher('nuvem'));
    }

    async function escolher(qual) {
      if (ocupado) return;
      ocupado = true;
      desenhar();
      const r = await store.resolverConflitoDaAvaliacao(item.avaliacao_id, qual);
      ocupado = false;
      if (!r.ok) { desenhar(); toast(r.erro, 'err'); return; }
      back2.remove();
      toast(qual === 'local' ? 'Sua versão foi enviada à nuvem.' : 'Versão da nuvem mantida.', 'ok');
      await atualizar();
    }

    back2.addEventListener('click', (e) => { if (e.target === back2 && !ocupado) back2.remove(); });
    desenhar();
  }

  back.addEventListener('click', (e) => { if (e.target === back) fechar(); });
  atualizar();
}

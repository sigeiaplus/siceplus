/* ============================================================
   SICEP+ · Painel da fila de sincronização (Etapa 6D)

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
          <p class="xs muted" style="margin:2px 0 0">Resultados salvos neste aparelho que ainda não chegaram à nuvem.</p>
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
                <strong class="small">${esc(i.aluno)}</strong>
                ${badge(rotulo, tipo)}
              </div>
              <div class="xs muted">${esc([i.avaliacao, i.turma, fmtDataHora(i.criado_em)].filter(Boolean).join(' · '))}</div>
              ${i.erro ? `<div class="xs" style="margin-top:4px;color:var(--err)">${esc(i.erro)}${i.tentativas ? ` (${i.tentativas} tentativa${i.tentativas === 1 ? '' : 's'})` : ''}</div>` : ''}
              ${i.status === 'erro' && i.permanente ? `
                <div class="row" style="margin-top:6px"><button class="btn btn-outline btn-sm" type="button" data-descartar="${i.seq}">${icon('trash', 14)} Descartar este envio</button></div>` : ''}
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

    caixa.querySelectorAll('[data-descartar]').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm('Descartar este envio?\n\nO resultado guardado neste aparelho será apagado e NÃO chegará à nuvem. Será preciso ler o cartão de novo.')) return;
      b.disabled = true;
      await store.descartarItemDaFila(Number(b.dataset.descartar));
      toast('Envio descartado.', 'ok');
      await atualizar();
    }));
  }

  back.addEventListener('click', (e) => { if (e.target === back) fechar(); });
  atualizar();
}

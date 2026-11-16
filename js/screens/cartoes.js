import * as store from '../store.js';
import { el, esc, icon, fmtData, fmtNota, badge } from '../ui.js';

/** QR Code real (gerador local, MIT — js/lib/qrcode.js). */
function qrSvg(texto) {
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (e) {
    console.warn('[SICEP+] QR Code:', e);
    return `<span class="xs muted">QR indisponível</span>`;
  }
}

export default function cartoes(params) {
  const avaliacoes = store.avaliacoes();
  let avId = params?.[0] || avaliacoes[0]?.id || null;
  let turmaId = avId ? store.avaliacao(avId)?.aplicacoes[0]?.turma_id || null : null;
  let caderno = 'A';

  const root = el('<div class="stack"></div>');

  function folha(av) {
    const aplicacao = store.aplicacaoDe(av, turmaId);
    const ctx = store.contextoAplicacao(aplicacao);
    const totalAlts = av.layout?.num_alternativas || 5;
    const alts = store.ALTERNATIVAS.slice(0, totalAlts);
    const codigo = av.layout?.codigo_caderno || 'SICEP-A';
    const denso = av.questoes.length > 25;
    const compacto = av.questoes.length > 40;

    return `
      <div class="sheet ${denso ? 'denso' : ''} ${compacto ? 'compacto' : ''}">
        <span class="mk tl"></span><span class="mk tr"></span>
        <span class="mk bl"></span><span class="mk br"></span>

        <div class="sheet-top">
          <div>
            <div class="sheet-title">SICEP+</div>
            <div class="sheet-sub">Cartão de respostas</div>
          </div>
          <div class="sheet-qr">
            ${qrSvg(codigo)}
            <span class="sheet-qr-code">${esc(codigo)}</span>
          </div>
        </div>

        <div class="sheet-info">
          <div><b>Escola:</b> ${esc(store.sessao()?.escola || '')}</div>
          <div><b>Turma:</b> ${esc(ctx?.turma?.nome || '')}</div>
          <div><b>Disciplina:</b> ${esc(ctx?.disciplina?.nome || '')}</div>
          <div><b>Caderno:</b> ${esc(caderno)}</div>
          <div><b>Avaliação:</b> ${esc(av.titulo)}</div>
          <div><b>Data:</b> ${fmtData(av.data_aplicacao)}</div>
          <div><b>Valor:</b> ${fmtNota(av.valor_total)} pontos</div>
          <div><b>Questões:</b> ${av.questoes.length}</div>
        </div>

        <div class="sheet-fields">
          <div class="sheet-line"><span class="lbl">NOME DO ALUNO</span><span class="ln"></span></div>
          <div class="sheet-line">
            <span class="lbl">TURMA</span><span class="ln" style="max-width:26%"></span>
            <span class="lbl">MATRÍCULA</span><span class="ln" style="max-width:34%"></span>
          </div>
          <div class="sheet-line">
            <span class="lbl">DATA</span><span class="ln" style="max-width:26%"></span>
            <span class="lbl">ASSINATURA</span><span class="ln"></span>
          </div>
        </div>

        <div class="sheet-answers">
          ${av.questoes.map((q) => `
            <div class="sheet-q">
              <span class="n">${String(q.numero).padStart(2, '0')}</span>
              ${q.anulada
                ? '<span class="bubble" style="border-style:dashed;border-color:#888">X</span>'
                : alts.map((a) => `<span class="bubble">${a}</span>`).join('')}
            </div>`).join('')}
        </div>

        <div class="sheet-foot">
          <span>Preencha uma única alternativa por questão, com caneta preta ou azul.</span>
          <span>Caderno ${esc(caderno)} · ${esc(codigo)}</span>
        </div>
      </div>`;
  }

  function pintar() {
    const av = avId ? store.avaliacao(avId) : null;
    if (av && !store.aplicacaoDe(av, turmaId)) turmaId = av.aplicacoes[0]?.turma_id || null;

    root.innerHTML = `
      <div class="page-head no-print">
        <span class="eyebrow">Cartões</span>
        <h1>Cartões de respostas</h1>
        <p>Imprima e distribua. O QR Code identifica a avaliação, a versão e o caderno.</p>
      </div>

      <div class="card stack no-print">
        <div class="field">
          <label class="label" for="sel-av">Avaliação</label>
          <select id="sel-av" class="select" data-sel-av>
            ${avaliacoes.map((a) => `<option value="${esc(a.id)}" ${a.id === avId ? 'selected' : ''}>${esc(a.titulo)}</option>`).join('')}
          </select>
        </div>
        <div class="form-grid two">
          <div class="field">
            <label class="label" for="sel-turma">Turma</label>
            <select id="sel-turma" class="select" data-sel-turma>
              ${(av?.aplicacoes || []).map((a) => {
                const t = store.turma(a.turma_id);
                return `<option value="${esc(a.turma_id)}" ${a.turma_id === turmaId ? 'selected' : ''}>${esc(t?.nome || '')}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="field">
            <label class="label" for="sel-cd">Caderno</label>
            <select id="sel-cd" class="select" data-sel-cd>
              ${['A', 'B', 'C', 'D'].map((c) => `<option value="${c}" ${c === caderno ? 'selected' : ''}>Caderno ${c}</option>`).join('')}
            </select>
          </div>
        </div>
        ${av ? `<div class="row wrap" style="gap:8px">
          ${badge(`${av.questoes.length} questões`)}
          ${badge(`${av.layout?.num_alternativas || 5} alternativas`)}
          ${badge(`Layout ${av.layout?.codigo_caderno || 'SICEP-A'} v${av.layout?.versao || 1}`, 'y')}
        </div>` : ''}
      </div>

      ${av ? `
        <div class="sheet-wrap">${folha(av)}</div>

        <div class="btn-group no-print">
          <button class="btn btn-primary" type="button" data-imprimir>${icon('print', 17)} Imprimir / PDF</button>
        </div>

        <div class="alert y no-print">
          ${icon('info', 16)}
          <span>Na janela de impressão escolha <span class="strong">Salvar como PDF</span> para gerar o arquivo.
          O QR Code já traz o código do caderno informado na avaliação — é ele que você lê ou digita no SICEP+.</span>
        </div>
      ` : `
        <div class="empty">
          <div class="ei">${icon('cards', 20)}</div>
          <h3>Nenhuma avaliação disponível</h3>
          <p>Crie uma avaliação para gerar os cartões.</p>
          <a class="btn btn-primary" href="#/avaliacoes/nova">Nova avaliação</a>
        </div>`}
    `;

    root.querySelector('[data-sel-av]')?.addEventListener('change', (e) => {
      avId = e.target.value;
      turmaId = store.avaliacao(avId)?.aplicacoes[0]?.turma_id || null;
      pintar();
    });
    root.querySelector('[data-sel-turma]')?.addEventListener('change', (e) => { turmaId = e.target.value; pintar(); });
    root.querySelector('[data-sel-cd]')?.addEventListener('change', (e) => { caderno = e.target.value; pintar(); });
    root.querySelector('[data-imprimir]')?.addEventListener('click', () => window.print());
  }

  pintar();
  return root;
}

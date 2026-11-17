import * as store from '../store.js';
import { el, esc, icon, fmtData, badge } from '../ui.js';
import { montarCartaoSvg } from '../leitor/cartao-svg.js';
import { MAX_QUESTOES, GEOMETRIA_VERSAO } from '../leitor/geometria.js';
import { montarPayload } from '../leitor/qr-caderno.js';

/** QR Code real (gerador local, MIT — js/lib/qrcode.js). Devolve o objeto já montado. */
function qrObjeto(texto) {
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    return qr;
  } catch (e) {
    console.warn('[SICEP+] QR Code:', e);
    return null;
  }
}

export default function cartoes(params) {
  const avaliacoes = store.avaliacoes();
  let avId = params?.[0] || avaliacoes[0]?.id || null;
  let turmaId = avId ? store.avaliacao(avId)?.aplicacoes[0]?.turma_id || null : null;
  let caderno = 'A';

  const root = el('<div class="stack"></div>');

  function folha(av) {
    if (av.questoes.length > MAX_QUESTOES) {
      return `<div class="alert err">${icon('info', 16)}<span>O cartão comporta no máximo ${MAX_QUESTOES} questões.</span></div>`;
    }
    const aplicacao = store.aplicacaoDe(av, turmaId);
    const ctx = store.contextoAplicacao(aplicacao);
    const totalAlts = av.layout?.num_alternativas || 5;
    const letras = store.ALTERNATIVAS.slice(0, totalAlts);
    const codigo = av.layout?.codigo_caderno || 'SICEP-A';
    // O QR identifica a avaliação, o caderno, a versão do cartão e o tamanho da grade.
    const payload = montarPayload({
      codigo,
      caderno,
      questoes: av.questoes.length,
      alternativas: totalAlts,
      geometria: GEOMETRIA_VERSAO,
    });

    const svg = montarCartaoSvg({
      questoes: av.questoes,
      letras,
      escola: store.sessao()?.escola || '',
      turma: ctx?.turma?.nome || '',
      disciplina: ctx?.disciplina?.nome || '',
      avaliacao: av.titulo,
      data: fmtData(av.data_aplicacao),
      caderno: caderno,
      qr: qrObjeto(payload),   // o conteúdo do QR é dado de leitura; não aparece escrito no cartão
    });
    return `<div class="sheet">${svg}</div>`;
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
          ${badge(`Layout v${GEOMETRIA_VERSAO}`, 'y')}
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
          Imprima em <span class="strong">escala 100%</span> (sem “ajustar à página”) e não recorte dentro da moldura:
          os 4 quadrados pretos dos cantos precisam sair inteiros. O QR Code já identifica a avaliação, o caderno e a versão do cartão.</span>
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

import * as store from '../store.js';
import { el, esc, icon, fmtData, badge, toast } from '../ui.js';
import { montarCartaoSvg, montarQrSvg } from '../leitor/cartao-svg.js';
import { MAX_QUESTOES, GEOMETRIA_VERSAO, FOLHA, QR } from '../leitor/geometria.js';
import { montarPayload } from '../leitor/qr-caderno.js';
import { nomeArquivo, baixarBlob, svgParaPdf, svgParaPng } from '../leitor/exportar-cartao.js';

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
  // Opções de exportação (não mudam a grade nem a leitura: só o que vai impresso em volta).
  let modo = 'completo';      // 'completo' (com identificação) | 'gabarito' (só a grade)
  let qrModo = 'junto';       // 'junto' (QR no cartão) | 'separado' (cartão sem QR + QR à parte)
  let qrLado = QR.lado;       // lado do QR avulso, em mm
  let pagina = 'exata';       // PDF: 'exata' (tamanho do cartão) | 'a4'
  let dpi = 300;              // PNG
  let exportando = false;

  const root = el('<div class="stack"></div>');

  /** Monta o que o cartão precisa (SVG, QR e nomes). Devolve { erro } se não couber. */
  function construir(av) {
    if (av.questoes.length > MAX_QUESTOES) {
      return { erro: `O cartão comporta no máximo ${MAX_QUESTOES} questões.` };
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
    const qr = qrObjeto(payload);   // o conteúdo do QR é dado de leitura; não aparece escrito no cartão

    const svg = montarCartaoSvg({
      questoes: av.questoes,
      letras,
      escola: store.sessao()?.escola || '',
      turma: ctx?.turma?.nome || '',
      disciplina: ctx?.disciplina?.nome || '',
      avaliacao: av.titulo,
      data: fmtData(av.data_aplicacao),
      caderno: caderno,
      qr,
      modo,
      qrModo,
    });
    return { svg, qr, turma: ctx?.turma?.nome || '' };
  }

  function folha(av) {
    const c = construir(av);
    if (c.erro) return `<div class="alert err">${icon('info', 16)}<span>${esc(c.erro)}</span></div>`;
    return `<div class="sheet">${c.svg}</div>`;
  }

  /** QR avulso (só quando o QR sai separado do cartão). */
  function qrAvulso(av) {
    const c = construir(av);
    if (c.erro || !c.qr) return null;
    return montarQrSvg(c.qr, qrLado);
  }

  async function exportar(tipo) {
    if (exportando) return;
    const av = avId ? store.avaliacao(avId) : null;
    if (!av) return;
    const c = construir(av);
    if (c.erro) { toast(c.erro, 'err'); return; }

    const ehQr = tipo.startsWith('qr-');
    const formato = tipo.endsWith('pdf') ? 'pdf' : 'png';
    const peca = ehQr ? qrAvulso(av) : { svg: c.svg, larguraMm: FOLHA.largura, alturaMm: FOLHA.altura };
    if (!peca) { toast('Não foi possível montar o QR Code.', 'err'); return; }

    const nome = ehQr
      ? nomeArquivo('qr', av.titulo, `caderno-${caderno}`, `${qrLado}mm`)
      : nomeArquivo('cartao', av.titulo, c.turma, `caderno-${caderno}`,
        modo === 'gabarito' ? 'gabarito' : null, qrModo === 'separado' ? 'sem-qr' : null);

    exportando = true;
    root.querySelectorAll('[data-exp]').forEach((b) => { b.disabled = true; });
    try {
      const blob = formato === 'pdf'
        ? svgParaPdf(peca.svg, { larguraMm: peca.larguraMm, alturaMm: peca.alturaMm, pagina, titulo: ehQr ? 'QR Code do caderno' : av.titulo })
        : await svgParaPng(peca.svg, { larguraMm: peca.larguraMm, alturaMm: peca.alturaMm, dpi });
      baixarBlob(blob, `${nome}.${formato}`);
      toast(`${formato.toUpperCase()} gerado.`, 'ok');
    } catch (e) {
      console.warn('[SICEP+] exportar:', e);
      toast(e?.message || 'Não foi possível gerar o arquivo.', 'err');
    } finally {
      exportando = false;
      root.querySelectorAll('[data-exp]').forEach((b) => { b.disabled = false; });
    }
  }

  function pintar() {
    const av = avId ? store.avaliacao(avId) : null;
    if (av && !store.aplicacaoDe(av, turmaId)) turmaId = av.aplicacoes[0]?.turma_id || null;

    root.innerHTML = `
      <div class="page-head no-print">
        <span class="eyebrow">Cartões</span>
        <h1>Cartões de respostas</h1>
        <p>Imprima ou exporte em PDF/PNG. O QR Code identifica a avaliação, a versão e o caderno.</p>
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
        ${av ? `
        <div class="form-grid two">
          <div class="field">
            <label class="label" for="sel-modo">Conteúdo do cartão</label>
            <select id="sel-modo" class="select" data-sel-modo>
              <option value="completo" ${modo === 'completo' ? 'selected' : ''}>Completo (com identificação)</option>
              <option value="gabarito" ${modo === 'gabarito' ? 'selected' : ''}>Só o gabarito (sem identificação)</option>
            </select>
          </div>
          <div class="field">
            <label class="label" for="sel-qr">QR Code</label>
            <select id="sel-qr" class="select" data-sel-qr>
              <option value="junto" ${qrModo === 'junto' ? 'selected' : ''}>Junto, dentro do cartão</option>
              <option value="separado" ${qrModo === 'separado' ? 'selected' : ''}>Separado (arquivo à parte)</option>
            </select>
          </div>
          <div class="field">
            <label class="label" for="sel-pag">Página do PDF</label>
            <select id="sel-pag" class="select" data-sel-pag>
              <option value="exata" ${pagina === 'exata' ? 'selected' : ''}>Tamanho do cartão (para inserir na prova)</option>
              <option value="a4" ${pagina === 'a4' ? 'selected' : ''}>A4, cartão em tamanho real</option>
            </select>
          </div>
          <div class="field">
            <label class="label" for="sel-dpi">Resolução do PNG</label>
            <select id="sel-dpi" class="select" data-sel-dpi>
              <option value="300" ${dpi === 300 ? 'selected' : ''}>300 dpi (padrão)</option>
              <option value="600" ${dpi === 600 ? 'selected' : ''}>600 dpi (maior)</option>
            </select>
          </div>
          ${qrModo === 'separado' ? `
          <div class="field">
            <label class="label" for="sel-qrlado">Tamanho do QR avulso</label>
            <select id="sel-qrlado" class="select" data-sel-qrlado>
              ${[22, 30, 40].map((m) => `<option value="${m}" ${qrLado === m ? 'selected' : ''}>${m} mm${m === 22 ? ' (igual ao do cartão)' : ''}</option>`).join('')}
            </select>
          </div>` : ''}
        </div>
        <div class="row wrap" style="gap:8px">
          ${badge(`${av.questoes.length} questões`)}
          ${badge(`${av.layout?.num_alternativas || 5} alternativas`)}
          ${badge(`Layout v${GEOMETRIA_VERSAO}`, 'y')}
        </div>` : ''}
      </div>

      ${av ? `
        <div class="sheet-wrap">${folha(av)}</div>

        ${qrModo === 'separado' ? `
        <div class="stack no-print" style="gap:8px">
          <span class="label">QR Code avulso (${qrLado} mm + margem de 4 mm)</span>
          <div class="sheet-wrap"><div class="qr-avulso">${qrAvulso(av)?.svg || ''}</div></div>
        </div>` : ''}

        <div class="stack no-print" style="gap:10px">
          <div class="btn-group">
            <button class="btn btn-primary" type="button" data-exp="pdf">${icon('download', 17)} Cartão em PDF</button>
            <button class="btn btn-outline" type="button" data-exp="png">${icon('download', 17)} Cartão em PNG</button>
          </div>
          ${qrModo === 'separado' ? `
          <div class="btn-group">
            <button class="btn btn-outline" type="button" data-exp="qr-pdf">${icon('qr', 17)} QR em PDF</button>
            <button class="btn btn-outline" type="button" data-exp="qr-png">${icon('qr', 17)} QR em PNG</button>
          </div>` : ''}
          <div class="btn-group">
            <button class="btn btn-ghost" type="button" data-imprimir>${icon('print', 17)} Imprimir</button>
          </div>
        </div>

        <div class="alert y no-print">
          ${icon('info', 16)}
          <span>Imprima sempre em <span class="strong">escala 100%</span> (sem “ajustar à página”) e não recorte dentro da moldura:
          os 4 quadrados pretos dos cantos precisam sair inteiros.
          ${modo === 'gabarito' ? 'No modo <span class="strong">só o gabarito</span> o cartão não tem nome nem instruções: o aluno é identificado pelo app e a prova deve trazer o cabeçalho. ' : ''}
          ${qrModo === 'separado'
            ? 'Com o <span class="strong">QR separado</span> o cartão sai com um quadriculado no lugar do QR (ele ajuda o leitor a saber qual lado é o de cima): <span class="strong">não cubra nem recorte essa área</span>. Cole ou imprima o QR avulso na prova e leia-o primeiro, na etapa do QR do caderno.'
            : 'O QR Code já identifica a avaliação, o caderno e a versão do cartão.'}</span>
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
    root.querySelector('[data-sel-modo]')?.addEventListener('change', (e) => { modo = e.target.value; pintar(); });
    root.querySelector('[data-sel-qr]')?.addEventListener('change', (e) => { qrModo = e.target.value; pintar(); });
    root.querySelector('[data-sel-pag]')?.addEventListener('change', (e) => { pagina = e.target.value; });
    root.querySelector('[data-sel-dpi]')?.addEventListener('change', (e) => { dpi = Number(e.target.value) || 300; });
    root.querySelector('[data-sel-qrlado]')?.addEventListener('change', (e) => { qrLado = Number(e.target.value) || QR.lado; pintar(); });
    root.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', () => exportar(b.dataset.exp)));
    root.querySelector('[data-imprimir]')?.addEventListener('click', () => window.print());
  }

  pintar();
  return root;
}

import * as store from '../store.js';
import {
  el, esc, icon, toast, fmtNota, badge, situacaoBadge,
  barraDesempenho, desempenhoTexto,
} from '../ui.js';
import { carregarOpenCV, precarregarOpenCV } from '../leitor/opencv-loader.js';
import { abrirCameraPrincipal, CameraErro, prepararCaptura, fotoEmAlta, aplicarZoom, ZOOM_MAX } from '../leitor/camera.js';
import { codigoDe, igual, decidirQR, mensagemPrazoVencido, validarAssociacao as validarAssoc } from '../leitor/associacao.js';
import { codigoDoQR } from '../leitor/qr-caderno.js';
import { lerQR, desenharRevisao } from '../leitor/leitor.js';
import { calcularMoldura } from '../leitor/moldura.js';
import { processarCartao, carregarParametros, salvarParametros, restaurarParametros, descreverCartao } from '../leitor/omr.js';

let stream = null;
let tocha = false;

function pararCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  tocha = false;
}

const ETAPAS = {
  turma: '1 de 4 · Turma',
  aluno: '2 de 4 · Aluno',
  cartao: '3 de 4 · Cartão',
  conferencia: '4 de 4 · Correção',
  resultado: 'Resultado',
};

const ROTULO_ESTADO = {
  ok: 'Segura', branco: 'Em branco', fraca: 'Marca fraca', multipla: 'Marcação dupla', incerta: 'Marcação incerta',
};

/**
 * O omr.js já explica cada bloqueio. Aqui só entra a orientação prática que depende
 * da tela (o que o professor deve fazer agora).
 */
const DICA_BLOQUEIO = {
  cartao_outra_versao: 'Imprima um cartão novo na aba Cartões — o cartão antigo não pode ser lido por esta versão do SICEP+.',
  versao_diferente: 'Os cartões já impressos continuam válidos para a conferência manual, mas precisam ser reimpressos para a leitura automática.',
  cartao_cortado: 'Dica: enquadre a folha inteira, deixando uma margem branca em volta dos 4 quadrados pretos.',
};

/** Lado maior (px) da imagem entregue ao OMR: o mesmo para a câmera interna e para ENVIAR FOTO. */
const MAX_LADO_FOTO = 3200;

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

export default function leitura(params) {
  pararCamera();

  const root = el('<div class="stack"></div>');
  const st = {
    etapa: 'turma',
    aba: 'estudantes',
    busca: '',
    turmaId: null,
    alunoId: null,
    avaliacaoId: params?.[0] || null,
    avaliacaoFixa: false,   // true quando o professor escolheu a avaliação na aba Instrumentos
    qrLido: false,          // QR do caderno já lido para a avaliação atual
    cartaoQR: null,         // conteúdo do QR do cartão (versão, caderno, grade)
    modo: 'foto',           // 'foto' | 'manual'
    leituras: null,         // uma entrada por questão (ver montarLeituras)
    processo: null,         // último resultado de processarCartao()
    imagemProc: null,       // imagem RGBA do cartão (para reler com outros ajustes)
    semQR: false,
    confirmaCartao: false,
    ativa: null,
    salvando: false,
    resultado: null,
    releitura: false,       // veio de Resultados para refazer a leitura de um registro
  };

  // Releitura de um resultado já registrado: #/leitura/<avaliacao>/<aluno>.
  // O fluxo continua o mesmo (QR do caderno → confirmação → leitura do cartão).
  if (params?.[0] && params?.[1]) {
    const alvo = store.aluno(params[1]);
    const av = store.avaliacao(params[0]);
    if (alvo && av && store.aplicacaoDe(av, alvo.turma_id)) {
      st.turmaId = alvo.turma_id;
      st.alunoId = alvo.id;
      st.avaliacaoId = av.id;
      st.avaliacaoFixa = true;
      st.releitura = true;
      st.etapa = 'cartao';
    }
  }

  /* ---------------- Overlay da câmera (tela cheia) ---------------- */

  const cf = el(`
    <div class="cam-full" data-cf hidden role="dialog" aria-modal="true" aria-label="Leitura do cartão">
      <video playsinline muted autoplay aria-label="Imagem da câmera"></video>
      <img data-cf-img alt="Cartão capturado" hidden />
      <div class="cf-top">
        <button class="cf-btn" type="button" data-cf-voltar aria-label="Voltar">${icon('left', 20)}</button>
        <div class="cf-quem"><strong data-cf-aluno></strong><span data-cf-turma></span></div>
        <button class="cf-btn" type="button" data-cf-torch hidden aria-label="Lanterna">${icon('torch', 18)}</button>
        <button class="cf-btn" type="button" data-cf-fechar aria-label="Fechar câmera">${icon('close', 20)}</button>
      </div>
      <div class="cf-instr">
        <span class="cf-passo" data-cf-passo></span>
        <strong data-cf-instr></strong>
        <span class="cf-sub" data-cf-sub></span>
      </div>
      <div class="cf-alvo" data-cf-alvo>
        <span class="c tl"></span><span class="c tr"></span><span class="c bl"></span><span class="c br"></span><!-- só no passo do QR; no cartão o CSS os esconde -->
      </div>
      <div class="cf-status" data-cf-status></div>
      <button class="cf-refazer" type="button" data-cf-refazer hidden>${icon('camera', 16)} Refazer</button>
      <div class="cf-aviso" data-cf-aviso hidden></div>
      <div class="cf-escolha" data-cf-escolha hidden></div>
      <div class="cf-caderno" data-cf-caderno hidden></div>
      <div class="cf-zoom" data-cf-zoom hidden role="group" aria-label="Zoom da câmera"></div>
      <div class="cf-baixo">
        <button class="cf-sec" type="button" data-cf-arquivo>Enviar foto</button>
        <button class="cf-obturador" type="button" data-cf-tirar disabled aria-label="Tirar foto"><span></span></button>
        <button class="cf-sec" type="button" data-cf-manual></button>
      </div>
    </div>
  `);
  const $cf = (s) => cf.querySelector(s);
  const video = $cf('video');
  video.addEventListener('loadedmetadata', ajustarAlvo);
  video.addEventListener('resize', ajustarAlvo);

  const fileInput = el('<input type="file" accept="image/*" hidden data-file />');
  const body = el('<div class="stack"></div>');
  root.append(body, cf, fileInput);

  const ov = {
    aberto: false, passo: 'qr', cv: null, cvErro: null, camErro: null,
    marc: 0, ocupacao: null, ocupado: false, processando: false, capturando: false,
    aviso: null, erro: null, escolha: null, escolhaCartao: null, timer: null, camInfo: null,
    zoom: null,            // zoom atual da câmera (1x = o mais aberto que o aparelho permite)
    caderno: null,         // { av, cartao } aguardando a confirmação do professor
  };

  const quadroCanvas = document.createElement('canvas');
  const quadroCtx = quadroCanvas.getContext('2d', { willReadFrequently: true });

  /** Quadro atual do vídeo como ImageData-like, reduzido para `maxLado` quando necessário. */
  function quadroDoVideo(maxLado) {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    const k = Math.min(1, maxLado / Math.max(w, h));
    quadroCanvas.width = Math.round(w * k);
    quadroCanvas.height = Math.round(h * k);
    quadroCtx.drawImage(video, 0, 0, quadroCanvas.width, quadroCanvas.height);
    const id = quadroCtx.getImageData(0, 0, quadroCanvas.width, quadroCanvas.height);
    return { data: id.data, width: id.width, height: id.height, canvas: quadroCanvas };
  }

  /** Foto escolhida na galeria/câmera nativa → imagem RGBA (respeita a orientação EXIF). */
  async function imagemDoArquivo(arquivo, maxLado = MAX_LADO_FOTO) {
    let bmp;
    try {
      bmp = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
    } catch (_) {
      bmp = await new Promise((ok, falha) => {
        const url = URL.createObjectURL(arquivo);
        const im = new Image();
        im.onload = () => { URL.revokeObjectURL(url); ok(im); };
        im.onerror = () => { URL.revokeObjectURL(url); falha(new Error('Não consegui abrir a foto.')); };
        im.src = url;
      });
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const k = Math.min(1, maxLado / Math.max(w, h));
    quadroCanvas.width = Math.round(w * k);
    quadroCanvas.height = Math.round(h * k);
    quadroCtx.drawImage(bmp, 0, 0, quadroCanvas.width, quadroCanvas.height);
    if (bmp.close) bmp.close();
    const id = quadroCtx.getImageData(0, 0, quadroCanvas.width, quadroCanvas.height);
    return { data: id.data, width: id.width, height: id.height, canvas: quadroCanvas };
  }

  function mensagemCamera(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Permissão de câmera negada. Autorize o acesso ou use "Enviar foto".';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Nenhuma câmera compatível encontrada. Use "Enviar foto".';
    if (n === 'NotReadableError') return 'A câmera está em uso por outro aplicativo.';
    return 'Não foi possível abrir a câmera' + (e?.message ? ': ' + e.message : '.') + ' Use "Enviar foto".';
  }

  async function ligarCamera() {
    ov.camErro = null;
    if (!window.isSecureContext) { ov.camErro = 'A câmera exige HTTPS (ou localhost). Use "Enviar foto".'; return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      ov.camErro = 'Este navegador não libera a câmera para a página. Use "Enviar foto".'; return;
    }
    // Somente a câmera traseira principal (1x), na maior resolução. Sem plano B com outra lente:
    // se não der para identificá-la com segurança, o erro explica a limitação (js/leitor/camera.js).
    try {
      const r = await abrirCameraPrincipal(navigator.mediaDevices);
      stream = r.stream;
      ov.camInfo = r.info;
      ov.zoom = r.info.zoom;
      console.info('[SICEP+] câmera:', r.info.label, r.info.largura + 'x' + r.info.altura,
        '(' + r.info.confianca + ')', 'zoom', r.info.zoom, 'de', r.info.zoomLimites);
      if (r.info.zoomPiso > 1.01) {
        avisoTemporario(`Este aparelho não deixa a câmera mais aberta que ${String(r.info.zoomPiso).replace('.', ',')}x — afaste o celular para enquadrar o cartão inteiro.`, 6000);
      }
    } catch (e) {
      stream = null;
      ov.camErro = e instanceof CameraErro ? e.message : mensagemCamera(e);
      return;
    }
    if (!ov.aberto) { pararCamera(); return; }   // fechou enquanto a permissão era pedida

    try {
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.muted = true;
      await video.play();
    } catch (e) { console.warn('[SICEP+] play() bloqueado:', e); }

    if (!stream) return;   // a câmera foi fechada enquanto o vídeo iniciava
    const track = stream.getVideoTracks()[0];
    const cap = track && track.getCapabilities ? track.getCapabilities() : null;
    $cf('[data-cf-torch]').hidden = !(cap && 'torch' in cap && cap.torch);
  }

  $cf('[data-cf-torch]').addEventListener('click', async () => {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    try {
      tocha = !tocha;
      await track.applyConstraints({ advanced: [{ torch: tocha }] });
    } catch (e) {
      toast('Lanterna indisponível neste dispositivo.', 'err');
    }
  });

  /* ---- moldura da câmera: sempre dentro da parte da tela em que a imagem aparece ---- */

  /**
   * A moldura é medida a cada mudança de layout (ver js/leitor/moldura.js): área pintada
   * do vídeo, espaço livre abaixo do que está no topo e acima da barra de botões.
   */
  function ajustarAlvo() {
    const alvo = $cf('[data-cf-alvo]');
    if (!alvo) return;
    const area = video.getBoundingClientRect();
    if (!area.width || !area.height) return;

    const barraEl = $cf('.cf-baixo');
    // Só entra o que está realmente visível: um card escondido não pode encolher a moldura.
    const topoPilha = ['.cf-instr', '[data-cf-status]', '[data-cf-zoom]', '[data-cf-aviso]', '[data-cf-caderno]', '[data-cf-escolha]']
      .map((s) => $cf(s))
      .filter((e) => e && !e.hidden && e.getClientRects().length)
      .reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);

    const m = calcularMoldura({
      area,
      video: { w: video.videoWidth, h: video.videoHeight },
      barra: barraEl.getBoundingClientRect(),
      barraLateral: getComputedStyle(barraEl).position === 'absolute',
      topoPilha,
      passo: ov.passo,
    });
    if (!m) return;
    alvo.style.width = m.width + 'px';
    alvo.style.height = m.height + 'px';
    alvo.style.left = m.left + 'px';
    alvo.style.top = m.top + 'px';
  }

  // O DOM muda antes da medição (um card aparece/some e o layout só vale no quadro seguinte).
  let alvoRaf = 0;
  function ajustarAlvoDepois() {
    if (alvoRaf) cancelAnimationFrame(alvoRaf);
    alvoRaf = requestAnimationFrame(() => { alvoRaf = 0; ajustarAlvo(); });
  }

  /* ---- estado visual do overlay ---- */

  // A pré-visualização chama isto a cada quadro: só mexe no DOM quando algo mudou de verdade.
  let overlayAssinatura = '';
  let alvoObs = null;

  function atualizarOverlay() {
    const qr = ov.passo === 'qr';
    const assinatura = JSON.stringify([
      qr, ov.marc, ov.ocupacao == null ? null : Math.round(ov.ocupacao * 10),
      ov.processando, ov.capturando, !!ov.cv, ov.cvErro, ov.camErro, ov.erro, ov.aviso,
      ov.escolha ? ov.escolha.map((a) => a.id) : null,
      ov.zoom, ov.caderno ? [ov.caderno.av?.id, ov.caderno.cartao?.caderno] : null,
    ]);
    if (assinatura === overlayAssinatura) return;
    overlayAssinatura = assinatura;
    const confirma = !!ov.caderno;
    $cf('[data-cf-passo]').textContent = qr ? '1 de 2' : '2 de 2';
    $cf('[data-cf-instr]').textContent = confirma
      ? 'CONFIRME O CADERNO'
      : (qr ? 'LEIA O QR CODE DO CADERNO' : 'LEIA O CARTÃO RESPOSTA');
    $cf('[data-cf-sub]').textContent = confirma
      ? 'Confira o nome do caderno acima. Se não for este, toque em “Ler outro”.'
      : (qr
        ? 'Aponte para o QR Code do cartão, de frente e com boa luz.'
        : 'Enquadre o cartão inteiro: os 4 cantos dentro da moldura. Ajuste a distância ou o zoom e toque no botão quando quiser fotografar.');
    $cf('[data-cf-alvo]').className = 'cf-alvo ' + (qr ? 'qr' : 'cartao');
    ajustarAlvoDepois();
    // Passo do QR: o caderno só é identificado pela leitura do QR Code (sem digitar código).
    const bm = $cf('[data-cf-manual]');
    bm.textContent = 'Lançar manualmente';
    bm.style.visibility = qr ? 'hidden' : 'visible';
    bm.disabled = qr;
    bm.tabIndex = qr ? -1 : 0;

    let status = '', cls = '';
    if (ov.erro || confirma) { status = ''; }
    else if (ov.processando) { status = ov.cv ? 'Lendo o cartão…' : 'Carregando o leitor óptico…'; cls = 'busy'; }
    else if (ov.camErro) { status = ov.camErro; cls = 'err'; }
    else if (ov.cvErro) { status = 'Não foi possível carregar o leitor óptico.'; cls = 'err'; }
    else if (qr) {
      const procurando = ov.cv || typeof BarcodeDetector !== 'undefined';
      status = ov.aviso ? '' : (procurando ? 'Procurando o QR Code…' : 'Carregando o leitor óptico…');
      cls = procurando ? '' : 'busy';
    }
    else { status = ''; }   // cartão: captura livre, a detecção dos marcadores só roda depois da foto
    const s = $cf('[data-cf-status]');
    s.textContent = status;
    s.className = 'cf-status ' + cls;
    s.hidden = !status;

    const av = $cf('[data-cf-aviso]');
    const msg = ov.erro || ov.aviso;
    av.hidden = !msg;
    av.className = 'cf-aviso ' + (ov.erro ? 'err' : 'warn');
    av.innerHTML = msg ? `<span>${esc(msg)}</span>` : '';

    // Refazer: aparece quando há algo a refazer (leitura que falhou ou câmera que não abriu).
    $cf('[data-cf-refazer]').hidden = !(ov.erro || ov.camErro) || ov.processando;
    // Voltar/Fechar ficam travados enquanto o cartão é processado (evita resultado chegando numa tela que já mudou).
    $cf('[data-cf-voltar]').disabled = ov.processando;
    $cf('[data-cf-fechar]').disabled = ov.processando;

    const esc2 = $cf('[data-cf-escolha]');
    esc2.hidden = !ov.escolha;
    if (ov.escolha) {
      esc2.innerHTML = `<p>Mais de uma avaliação usa este código. Qual é?</p>
        ${ov.escolha.map((a) => `<button type="button" class="btn btn-outline btn-block" data-cf-av="${esc(a.id)}">${esc(a.titulo)}</button>`).join('')}`;
      esc2.querySelectorAll('[data-cf-av]').forEach((b) => b.addEventListener('click', () => {
        const a = ov.escolha.find((x) => x.id === b.dataset.cfAv);
        ov.escolha = null;
        if (a) { ov.caderno = { av: a, cartao: ov.escolhaCartao || null }; ov.escolhaCartao = null; }
        atualizarOverlay();
      }));
    }

    /* ---- confirmação do caderno lido (nome do caderno antes de fotografar) ---- */
    const cad = $cf('[data-cf-caderno]');
    const conf = ov.caderno;
    cad.hidden = !conf;
    if (conf) {
      const avConf = conf.av;
      const caderno = conf.cartao?.caderno ? `Caderno ${conf.cartao.caderno}` : null;
      cad.innerHTML = `
        <p class="cfc-rotulo">${icon('qr', 14)} Caderno identificado</p>
        <strong class="cfc-nome">${esc(avConf?.titulo || '')}</strong>
        <span class="cfc-sub">${esc([caderno, codigoDe(avConf), avConf?.questoes?.length ? avConf.questoes.length + ' questões' : null].filter(Boolean).join(' · '))}</span>
        <span class="cfc-pergunta">É este o caderno deste aluno?</span>
        <div class="cfc-acoes">
          <button type="button" class="cf-sec escuro" data-cf-confirma-nao>Ler outro</button>
          <button type="button" class="cf-sec forte" data-cf-confirma-ok>Sim, é este</button>
        </div>`;
      cad.querySelector('[data-cf-confirma-ok]').addEventListener('click', () => {
        const c = ov.caderno;
        ov.caderno = null;
        if (c) aceitarAvaliacao(c.av, c.cartao);
        else atualizarOverlay();
      });
      cad.querySelector('[data-cf-confirma-nao]').addEventListener('click', () => {
        ov.caderno = null;
        ov.erro = null;
        atualizarOverlay();   // volta a procurar o QR
      });
    }

    /* ---- zoom 1x–3x (só quando a câmera permite) ---- */
    const zbox = $cf('[data-cf-zoom]');
    const lim = ov.camInfo?.zoomLimites;
    const piso = Math.max(lim?.min ?? 1, 1);
    const teto = Math.min(lim?.max ?? 1, ZOOM_MAX);
    const podeZoom = !!lim && !ov.camErro && teto > piso + 0.05;
    zbox.hidden = !podeZoom;
    if (podeZoom) {
      const atual = ov.zoom ?? piso;
      const niveis = [1, 2, 3].filter((f) => f >= piso - 0.01 && f <= teto + 0.01);
      if (!niveis.length) niveis.push(piso);
      zbox.innerHTML = niveis.map((f) => `<button type="button" class="cf-zoom-btn ${Math.abs(atual - f) < 0.2 ? 'on' : ''}" data-cf-zoom="${f}" aria-pressed="${Math.abs(atual - f) < 0.2}">${String(f).replace('.', ',')}x</button>`).join('');
      zbox.querySelectorAll('[data-cf-zoom]').forEach((b) => b.addEventListener('click', () => escolherZoom(Number(b.dataset.cfZoom))));
    }

    const tirar = $cf('[data-cf-tirar]');
    // Captura livre: não depende de detectar marcadores, QR, cartão nem de o leitor óptico já ter carregado.
    // Só fica indisponível enquanto a câmera não funciona, durante a própria captura/leitura
    // (evita foto duplicada) ou quando há uma pergunta aberta (escolha de avaliação / confirmação do caderno).
    tirar.disabled = !!ov.camErro || ov.capturando || ov.processando || !!ov.escolha || !!ov.caderno;
  }

  /** Botão de zoom da câmera (1x, 2x, 3x). O zoom vale para a prévia e para a foto. */
  async function escolherZoom(fator) {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    const r = await aplicarZoom(track, fator);
    if (r == null) {
      toast('Este aparelho não permite controlar o zoom da câmera.', 'err');
      return;
    }
    ov.zoom = r;
    atualizarOverlay();
  }

  function avisoTemporario(msg, ms = 3500) {
    ov.aviso = msg;
    atualizarOverlay();
    clearTimeout(avisoTemporario.t);
    avisoTemporario.t = setTimeout(() => { if (ov.aviso === msg) { ov.aviso = null; atualizarOverlay(); } }, ms);
  }

  /* ---- passo 1: QR do caderno ---- */

  function tratarQR(texto) {
    const d = decidirQR(texto, {
      avaliacoesDaTurma: avaliacoesDaTurma(),
      fixa: st.avaliacaoFixa && st.avaliacaoId ? avaliacao() : null,
    });
    if (d.tipo === 'vazio') return false;
    // Prazo de correção encerrado: proibido assim que o QR é lido. Para a leitura (ov.erro trava o ciclo)
    // e nada é fotografado nem salvo; o professor sai por "Voltar".
    if (d.tipo === 'vencida') {
      ov.caderno = null; ov.escolha = null;
      ov.erro = mensagemPrazoVencido(d.avaliacao, d.prazo);
      atualizarOverlay();
      return false;
    }
    if (d.tipo === 'outra') {
      avisoTemporario(`Este QR é de outra avaliação ("${d.lido}"). Esperado: "${d.esperado}" (${d.avaliacao?.titulo || ''}).`);
      return false;
    }
    if (d.tipo === 'nenhuma') {
      avisoTemporario(`O QR "${d.lido}" não pertence a nenhuma avaliação desta turma.`);
      return false;
    }
    if (d.tipo === 'escolha') {
      ov.escolha = d.candidatas;
      ov.escolhaCartao = d.cartao || null;
      atualizarOverlay();
      return false;
    }
    // O QR carrega versão do layout e tamanho da grade: cartão incompatível para aqui,
    // antes de fotografar, com o motivo certo.
    if (d.conflitos && d.conflitos.length) {
      avisoTemporario(`Este cartão não serve para "${d.avaliacao?.titulo || ''}": ${d.conflitos.join('; ')}. Imprima um cartão novo na aba Cartões.`, 9000);
      return false;
    }
    // Antes de fotografar: o professor confirma que é este o caderno do aluno.
    ov.caderno = { av: d.avaliacao, cartao: d.cartao || null };
    atualizarOverlay();
    return false;
  }

  const validarAssociacao = (av) => validarAssoc(store, av, st.alunoId, st.turmaId);

  function aceitarAvaliacao(av, cartao = null) {
    const v = validarAssociacao(av);
    if (!v.ok) {
      avisoTemporario(v.motivo, 5000);
      return false;
    }
    st.avaliacaoId = av.id;
    st.qrLido = true;
    st.cartaoQR = cartao || null;
    ov.passo = 'cartao';
    ov.marc = 0;
    ov.aviso = null;
    toast('Caderno identificado: ' + av.titulo, 'ok');
    atualizarOverlay();
    return true;
  }

  /* ---- passo 2: cartão ---- */

  function opcoesDeLeitura() {
    const av = avaliacao();
    return {
      questoes: av.questoes.map((q) => ({ numero: q.numero, anulada: !!q.anulada })),
      numAlternativas: av.layout?.num_alternativas || 5,
      codigoEsperado: codigoDe(av),
      params: carregarParametros(),
    };
  }

  /** Esconde a foto congelada e volta a mostrar a prévia ao vivo da câmera. */
  function mostrarPreviaAoVivo() {
    $cf('[data-cf-img]').hidden = true;
    video.hidden = false;
  }

  /** Espera o OpenCV terminar de carregar (a foto já foi capturada; só a leitura depende dele). */
  async function aguardarLeitor() {
    for (let i = 0; i < 1200 && ov.aberto && !ov.cv && !ov.cvErro; i++) await dorme(100);
    return !!ov.cv;
  }

  /**
   * ÚNICO caminho de leitura do cartão resposta — usado pela câmera interna e por ENVIAR FOTO.
   * A única diferença entre os dois é a origem da imagem. Aqui acontece, depois da foto:
   * detecção dos 4 marcadores, geometria, perspectiva, QR e OMR (tudo dentro de processarCartao).
   */
  async function processarFotoCartao(imagem) {
    // congela a imagem na tela enquanto processa
    try { $cf('[data-cf-img]').src = imagem.canvas.toDataURL('image/jpeg', 0.7); $cf('[data-cf-img]').hidden = false; } catch (_) { /* só visual */ }
    ov.processando = true;
    atualizarOverlay();
    const pronto = await aguardarLeitor();
    ov.processando = false;
    if (!ov.aberto) return;
    if (!pronto) {
      ov.erro = 'Não foi possível carregar o leitor óptico. Verifique a internet e tente novamente.';
      mostrarPreviaAoVivo();
      atualizarOverlay();
      return;
    }
    await processarImagem(imagem);
  }

  async function processarImagem(imagem) {
    const av = avaliacao();
    if (!av || !ov.cv) {
      ov.erro = !av ? 'Nenhuma avaliação associada a esta leitura. Volte e leia o QR Code do caderno.' : 'O leitor óptico não está pronto. Tente novamente.';
      mostrarPreviaAoVivo();
      atualizarOverlay();
      return;
    }
    ov.processando = true;
    atualizarOverlay();
    await dorme(30); // deixa o "Lendo o cartão…" aparecer antes do trabalho pesado
    let r;
    try {
      r = await processarCartao(ov.cv, imagem, { ...opcoesDeLeitura(), canvasQR: imagem.canvas || null });
    } catch (e) {
      console.error('[SICEP+] processarCartao:', e);
      r = { ok: false, bloqueado: true, motivo: 'erro', mensagem: 'Erro ao processar a imagem: ' + (e?.message || e) };
    }
    ov.processando = false;
    if (!ov.aberto) return;   // a câmera foi fechada durante a leitura: não mexe na tela

    if (!r.ok) {
      // O motivo vem pronto do pipeline (cortado, outra versão, outra avaliação, grade…).
      ov.erro = [r.mensagem || 'Não foi possível ler este cartão.', DICA_BLOQUEIO[r.motivo]].filter(Boolean).join(' ');
      mostrarPreviaAoVivo();   // volta à câmera: o botão de captura continua disponível para tentar de novo
      atualizarOverlay();
      return;
    }

    st.processo = r;
    st.imagemProc = { data: imagem.data, width: imagem.width, height: imagem.height };
    st.modo = 'foto';
    st.cartaoQR = r.etapas.qr.cartao || st.cartaoQR;
    st.semQR = !r.etapas.qr.ok;
    st.confirmaCartao = false;
    montarLeituras(r.leituras);
    fecharOverlay();
    st.etapa = 'conferencia';
    pintar();
  }

  async function aguardarLivre() {
    for (let i = 0; i < 100 && ov.ocupado; i++) await dorme(30);
  }

  /** Espera o vídeo entregar um quadro na resolução alta depois de subir a câmera. */
  async function esperarQuadroMaior() {
    const alvo = ov.camInfo?.maxima?.largura || 0;
    if (!alvo) return;
    for (let i = 0; i < 16; i++) {
      if (video.videoWidth >= alvo * 0.9) return;
      await dorme(50);
    }
  }

  /**
   * Foto final na MAIOR resolução: ImageCapture (quando o navegador tem) ou
   * subindo a câmera só durante a captura e voltando para a pré-visualização.
   */
  async function capturarFotoFinal() {
    if (!stream) return quadroDoVideo(MAX_LADO_FOTO);
    try {
      const blob = await fotoEmAlta(stream);
      if (blob) return await imagemDoArquivo(blob, MAX_LADO_FOTO);
    } catch (e) {
      console.warn('[SICEP+] ImageCapture:', e);
    }
    const track = stream.getVideoTracks()[0];
    if (!track || !ov.camInfo?.maxima?.largura) return quadroDoVideo(MAX_LADO_FOTO);
    const restaurar = await prepararCaptura(track, ov.camInfo);
    try {
      if (ov.zoom) await aplicarZoom(track, ov.zoom);   // mantém o zoom escolhido na foto
      await esperarQuadroMaior();
      return quadroDoVideo(MAX_LADO_FOTO);
    } finally {
      await restaurar();
      if (ov.zoom) await aplicarZoom(track, ov.zoom);   // e ao voltar para a prévia
    }
  }

  async function tirarFoto() {
    if (ov.capturando || ov.processando || ov.escolha || ov.caderno || ov.camErro) return;   // evita foto duplicada
    ov.capturando = true;
    if (ov.erro) { ov.erro = null; mostrarPreviaAoVivo(); }   // nova tentativa depois de uma falha
    atualizarOverlay();
    try {
      await aguardarLivre();
      if (ov.passo === 'qr') {
        if (!ov.cv) { avisoTemporario('Aguarde o leitor óptico terminar de carregar.'); return; }
        const q = quadroDoVideo(1600);
        if (!q) return;
        ov.ocupado = true;
        try {
          const t = await lerQR(ov.cv, q, q.canvas);
          if (t) tratarQR(t); else avisoTemporario('QR Code não encontrado. Aproxime, centralize e tente de novo.');
        } finally { ov.ocupado = false; }
        return;
      }
      // Passo do cartão: captura livre. Nenhum marcador precisa ter sido detectado antes.
      ov.ocupado = true;
      let q = null;
      try {
        q = await capturarFotoFinal();
      } finally {
        ov.ocupado = false;
      }
      if (!q) { ov.erro = 'Não consegui capturar a imagem da câmera. Tente novamente.'; return; }
      await processarFotoCartao(q);
    } finally {
      ov.capturando = false;
      if (ov.aberto) atualizarOverlay();
    }
  }

  $cf('[data-cf-tirar]').addEventListener('click', tirarFoto);

  /* ---- análise ao vivo ---- */

  /**
   * Análise ao vivo — barata de propósito: quadro pequeno, sem tentar decodificar
   * o QR em várias escalas a cada ciclo. A leitura “de verdade” acontece na captura.
   */
  async function analisarQuadro() {
    if (document.hidden || !video.videoWidth) return;
    if (ov.passo === 'qr') {
      if (ov.escolha || ov.erro || ov.caderno) return;
      const q = quadroDoVideo(720);
      if (!q) return;
      const t = await lerQR(ov.cv, q, q.canvas, { rapido: true });
      if (t && ov.aberto) tratarQR(t);
      return;
    }
    // Passo do cartão: sem análise da prévia. Os marcadores só são procurados depois da foto.
  }

  async function ciclo() {
    ov.timer = null;
    if (!ov.aberto) return;
    if (document.hidden) { ov.timer = setTimeout(ciclo, 1000); return; }   // aba em segundo plano: não gasta CPU
    if (ov.passo === 'qr' && (ov.cv || typeof BarcodeDetector !== 'undefined') && !ov.processando && !ov.capturando && !ov.erro && !ov.ocupado && video.videoWidth) {
      ov.ocupado = true;
      try { await analisarQuadro(); } catch (e) { console.warn('[SICEP+] leitura ao vivo:', e); } finally { ov.ocupado = false; }
    }
    if (ov.aberto) ov.timer = setTimeout(ciclo, 500);
  }

  /* ---- abrir / fechar ---- */

  function carregarLeitor() {
    ov.cvErro = null;
    carregarOpenCV().then(({ cv }) => {
      ov.cv = cv;
      atualizarOverlay();
    }).catch((e) => {
      ov.cvErro = e?.message || 'Falha ao carregar o OpenCV.';
      atualizarOverlay();
      toast(ov.cvErro, 'err');
    });
  }

  /** Tela cheia do navegador (some a barra de endereço). Melhor esforço: o iPhone não permite, e aí vale o 100dvh do CSS. */
  function entrarTelaCheia() {
    const raiz = document.documentElement;
    const fn = raiz.requestFullscreen || raiz.webkitRequestFullscreen;
    if (!fn || document.fullscreenElement || document.webkitFullscreenElement) return;
    try {
      const pr = fn.call(raiz);
      if (pr && pr.catch) pr.catch(() => {});
    } catch (_) { /* sem tela cheia: segue com o overlay fixo */ }
  }

  function sairTelaCheia() {
    if (!(document.fullscreenElement || document.webkitFullscreenElement)) return;
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      const pr = fn && fn.call(document);
      if (pr && pr.catch) pr.catch(() => {});
    } catch (_) { /* ignora */ }
  }

  async function abrirCamera() {
    const aluno = store.aluno(st.alunoId);
    if (!aluno) return;
    if (!st.avaliacaoFixa && !(st.qrLido && st.avaliacaoId)) st.avaliacaoId = null;

    ov.aberto = true;
    ov.passo = st.qrLido && st.avaliacaoId ? 'cartao' : 'qr';
    ov.marc = 0; ov.ocupacao = null; ov.aviso = null; ov.erro = null; ov.escolha = null; ov.processando = false;
    ov.caderno = null; ov.escolhaCartao = null; ov.zoom = null;
    $cf('[data-cf-aluno]').textContent = aluno.nome_completo || '';
    $cf('[data-cf-turma]').textContent = store.turma(st.turmaId)?.nome || '';
    $cf('[data-cf-img]').hidden = true;
    cf.hidden = false;
    document.body.classList.add('cam-open');
    entrarTelaCheia();   // ainda no gesto do toque; não há await antes
    // Barra de endereço, tela cheia e rotação mudam a área disponível: remede a moldura.
    window.addEventListener('resize', ajustarAlvo);
    window.addEventListener('orientationchange', ajustarAlvo);
    document.addEventListener('fullscreenchange', ajustarAlvo);
    document.addEventListener('webkitfullscreenchange', ajustarAlvo);
    atualizarOverlay();
    if (!alvoObs && typeof ResizeObserver !== 'undefined') {
      alvoObs = new ResizeObserver(() => ajustarAlvo());
      alvoObs.observe(cf);   // gira a tela / muda a altura visível: remede a moldura
    }

    // Câmera primeiro: carregar o OpenCV (13 MB) junto travava a thread principal e atrasava a imagem.
    await ligarCamera();
    if (!ov.cv) carregarLeitor();
    atualizarOverlay();
    if (ov.aberto && !ov.timer) ov.timer = setTimeout(ciclo, 200);
  }

  function fecharOverlay() {
    ov.aberto = false;
    ov.caderno = null;
    ov.escolhaCartao = null;
    clearTimeout(ov.timer);
    ov.timer = null;
    if (alvoRaf) { cancelAnimationFrame(alvoRaf); alvoRaf = 0; }
    window.removeEventListener('resize', ajustarAlvo);
    window.removeEventListener('orientationchange', ajustarAlvo);
    document.removeEventListener('fullscreenchange', ajustarAlvo);
    document.removeEventListener('webkitfullscreenchange', ajustarAlvo);
    pararCamera();
    video.srcObject = null;
    $cf('[data-cf-torch]').hidden = true;
    cf.hidden = true;
    document.body.classList.remove('cam-open');
    sairTelaCheia();
  }

  $cf('[data-cf-fechar]').addEventListener('click', () => {
    if (ov.processando) return;
    fecharOverlay();
    st.etapa = 'cartao';
    pintar();
  });

  // Voltar: cartão → QR do caderno; QR → lista de alunos.
  $cf('[data-cf-voltar]').addEventListener('click', () => {
    if (ov.processando) return;
    if (ov.passo === 'cartao') {
      st.qrLido = false;
      if (!st.avaliacaoFixa) st.avaliacaoId = null;   // avaliação escolhida à mão continua valendo; o QR precisa bater com ela
      ov.passo = 'qr';
      ov.marc = 0; ov.ocupacao = null; ov.aviso = null; ov.erro = null; ov.escolha = null;
      ov.caderno = null; ov.escolhaCartao = null;
      $cf('[data-cf-img]').hidden = true;
      video.hidden = false;
      atualizarOverlay();
      return;
    }
    fecharOverlay();
    st.etapa = 'aluno';
    pintar();
  });

  // Refazer: descarta a leitura que falhou e volta à imagem ao vivo; se a câmera não abriu, tenta abrir de novo.
  $cf('[data-cf-refazer]').addEventListener('click', async () => {
    if (ov.processando) return;
    const refazCamera = !!ov.camErro;
    ov.erro = null; ov.aviso = null; ov.marc = 0; ov.ocupacao = null;
    $cf('[data-cf-img]').hidden = true;
    video.hidden = false;
    if (refazCamera) {
      pararCamera();
      atualizarOverlay();
      await ligarCamera();
    }
    atualizarOverlay();
  });

  $cf('[data-cf-arquivo]').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (ev) => {
    const arquivo = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!arquivo) return;
    if (!ov.aberto) return;
    if (ov.capturando || ov.processando || ov.escolha || ov.caderno) return;   // mesma trava do botão de captura
    ov.capturando = true;
    ov.erro = null;
    atualizarOverlay();
    try {
      const imagem = await imagemDoArquivo(arquivo, MAX_LADO_FOTO);   // mesma resolução da foto da câmera, com EXIF aplicado
      await aguardarLivre();
      if (ov.passo === 'qr') {
        if (!ov.cv) { avisoTemporario('Aguarde o leitor óptico terminar de carregar.'); return; }
        ov.ocupado = true;
        try {
          const t = await lerQR(ov.cv, imagem, imagem.canvas);
          if (t) tratarQR(t); else avisoTemporario('Não encontrei o QR Code nesta foto.');
        } finally { ov.ocupado = false; }
      } else {
        await processarFotoCartao(imagem);   // o mesmo caminho da câmera interna
      }
    } catch (e) {
      ov.erro = e?.message || 'Não consegui abrir a foto.';
      mostrarPreviaAoVivo();
    } finally {
      ov.capturando = false;
      if (ov.aberto) atualizarOverlay();
    }
  });

  $cf('[data-cf-manual]').addEventListener('click', () => {
    if (ov.passo === 'qr') return;   // sem digitação de código no passo do QR
    // Lançamento manual: sem foto, o professor marca tudo.
    fecharOverlay();
    iniciarManual();
    st.etapa = 'conferencia';
    pintar();
  });

  /* ---------------- Dados auxiliares ---------------- */

  const avaliacao = () => (st.avaliacaoId ? store.avaliacao(st.avaliacaoId) : null);
  const aplicacao = () => {
    const av = avaliacao();
    return av && st.turmaId ? store.aplicacaoDe(av, st.turmaId) : null;
  };
  const alunos = () => (st.turmaId ? store.alunosDaTurma(st.turmaId) : []);
  const avaliacoesDaTurma = () => store.avaliacoes().filter((a) => store.aplicacaoDe(a, st.turmaId));

  const resultadoDoAlunoNaTurma = (avaliacaoId, alunoId) =>
    store.resultadoDoAluno(avaliacaoId, alunoId, st.turmaId);

  function infoTurma(turmaId) {
    const total = store.alunosDaTurma(turmaId).length;
    const feitos = new Set(
      store.resultados().filter((r) => r.turma_id === turmaId).map((r) => r.aluno_id)
    ).size;
    return { total, feitos, completo: total > 0 && feitos >= total };
  }

  function alunosFiltrados() {
    const termo = st.busca.trim().toLowerCase();
    if (!termo) return alunos();
    return alunos().filter((a) => String(a.nome_completo || '').toLowerCase().includes(termo));
  }

  /* ---------------- Correção ---------------- */

  /**
   * Uma entrada por questão. Só entra como resposta o que o leitor reconheceu com segurança
   * (estado 'ok', sem `confere`) ou o que o professor escolheu/confirmou.
   *   resolvida=false → falta decisão do professor (marca fraca, dupla, incerta…).
   */
  function montarLeituras(lidas, anteriores = null) {
    const av = avaliacao();
    const antes = new Map((anteriores || []).map((l) => [l.numero, l]));
    st.leituras = av.questoes.map((q) => {
      const base = {
        numero: q.numero, gabarito: q.gabarito,
        valor: q.anulada ? 0 : Number(q.valor) || 0, anulada: !!q.anulada,
      };
      const ant = antes.get(q.numero);
      if (ant && ant.origem === 'professor') return { ...ant, ...base };   // decisão do professor sobrevive a uma releitura
      const l = lidas.find((x) => x.numero === q.numero);
      if (!l || q.anulada) {
        return { ...base, estado: q.anulada ? 'anulada' : 'branco', resposta: null, sugestao: null, resolvida: !!q.anulada, origem: 'leitor', preenchimento: {} };
      }
      const pendente = !!l.confere || !!l.bloqueada;
      return {
        ...base,
        estado: l.estado,
        resposta: pendente ? null : (l.detectada || null),
        sugestao: l.sugestao || null,
        resolvida: !pendente,
        origem: 'leitor',
        preenchimento: l.preenchimento || {},
      };
    });
  }

  function iniciarManual() {
    const av = avaliacao();
    st.modo = 'manual';
    st.processo = null;
    st.imagemProc = null;
    st.semQR = false;
    st.confirmaCartao = false;
    st.leituras = av.questoes.map((q) => ({
      numero: q.numero, gabarito: q.gabarito,
      valor: q.anulada ? 0 : Number(q.valor) || 0, anulada: !!q.anulada,
      estado: q.anulada ? 'anulada' : 'manual', resposta: null, sugestao: null,
      resolvida: !!q.anulada, origem: 'professor', preenchimento: {},
    }));
  }

  const pendentes = () => (st.leituras || []).filter((l) => !l.anulada && !l.resolvida);

  function respostasObjeto() {
    const respostas = {};
    (st.leituras || []).forEach((l) => { if (!l.anulada && l.resolvida && l.resposta) respostas[l.numero] = l.resposta; });
    return respostas;
  }

  function resumoLeitura() {
    const av = avaliacao();
    const calc = store.calcularCorrecao(av, respostasObjeto());
    const emBranco = (st.leituras || []).filter((l) => !l.anulada && l.resolvida && !l.resposta).length;
    return { ...calc, emBranco, pendentes: pendentes().length };
  }

  function contagens() {
    const c = { ok: 0, branco: 0, fraca: 0, multipla: 0, incerta: 0 };
    (st.leituras || []).forEach((l) => { if (!l.anulada && c[l.estado] !== undefined) c[l.estado]++; });
    return c;
  }

  function tileHTML(l) {
    const classes = ['ans-tile'];
    let txt, desc;
    if (l.anulada) {
      classes.push('anulada'); txt = 'X'; desc = 'anulada';
    } else if (!l.resolvida) {
      classes.push('pendente', 'p-' + l.estado);
      txt = l.sugestao ? l.sugestao + '?' : '?';
      desc = (ROTULO_ESTADO[l.estado] || 'a lançar') + ', precisa de conferência';
    } else {
      classes.push('ok');
      if (l.origem === 'professor') classes.push('editada');
      if (!l.resposta) classes.push('em-branco');
      txt = l.resposta || '–';
      desc = l.resposta ? 'alternativa ' + l.resposta : 'em branco';
    }
    return `<button type="button" class="${classes.join(' ')}" data-tile="${l.numero}" aria-label="Questão ${l.numero}: ${esc(desc)}">
      <span class="at-n">${l.numero}</span>
      <span class="at-a">${esc(txt)}</span>
    </button>`;
  }

  function editorHTML() {
    const l = (st.leituras || []).find((x) => x.numero === st.ativa);
    if (!l) return '';
    const av = avaliacao();
    const letras = store.ALTERNATIVAS.slice(0, av?.layout?.num_alternativas || 5);
    const nota = l.anulada ? '' : (l.estado === 'manual' ? 'Marque a alternativa assinalada no cartão.' : ({
      ok: 'Leitura segura. Toque para corrigir, se precisar.',
      branco: 'Nenhuma marca encontrada.',
      fraca: 'Marca muito clara — confirme a alternativa.',
      multipla: 'Mais de uma marca forte — escolha a correta ou deixe em branco.',
      incerta: 'Há outra marca visível — confirme a alternativa.',
    }[l.estado] || ''));
    return `
      <div class="ans-editor" id="editor">
        <div class="row between">
          <span class="small strong">Questão ${l.numero}${l.estado && l.estado !== 'manual' && !l.anulada ? ' · ' + esc(ROTULO_ESTADO[l.estado] || '') : ''}</span>
          <span class="xs muted">${l.anulada ? 'anulada' : fmtNota(l.valor) + ' ponto(s)'}</span>
        </div>
        ${l.anulada ? '<p class="xs muted">Questão anulada — creditada a todos os alunos.</p>' : `
        ${nota ? `<p class="xs muted" style="margin:0">${esc(nota)}</p>` : ''}
        <div class="row wrap" style="gap:8px">
          ${letras.map((a) => {
            const f = l.preenchimento?.[a];
            return `<button type="button" class="ans-opt ${l.resolvida && l.resposta === a ? 'on' : ''} ${!l.resolvida && l.sugestao === a ? 'sug' : ''}" data-opt="${a}">${a}${f != null ? `<small>${Math.round(f * 100)}%</small>` : ''}</button>`;
          }).join('')}
          <button type="button" class="ans-opt ${l.resolvida && !l.resposta ? 'on' : ''}" data-opt="">Em branco</button>
        </div>`}
        <div class="row between" style="gap:10px">
          <span class="xs muted">Toque em outra questão para corrigir.</span>
          <button type="button" class="btn btn-ghost btn-sm" data-fechar-editor>Fechar</button>
        </div>
      </div>`;
  }

  function scoreHTML() {
    const s = resumoLeitura();
    return `
      <div class="row between wrap" style="gap:12px">
        <div>
          <div class="xs muted">Nota parcial</div>
          <div class="result-big">
            <span class="rn">${fmtNota(s.nota)}</span>
            <span class="small muted">/ ${fmtNota(s.total)}</span>
          </div>
        </div>
        <div style="text-align:right">
          <div class="small strong">${s.percentual}%</div>
          <div class="xs muted">${s.emBranco} em branco · ${s.acertos} acerto(s)</div>
        </div>
      </div>`;
  }

  /** Só libera salvar quando nada duvidoso ficou sem decisão. */
  function podeSalvar() {
    if (st.salvando || !st.leituras) return { ok: false, motivo: '' };
    const p = pendentes().length;
    if (p) return { ok: false, motivo: `Resolva ${p} questão(ões) em amarelo antes de salvar.` };
    if (st.modo === 'foto' && st.semQR && !st.confirmaCartao) {
      return { ok: false, motivo: 'O QR do cartão não foi lido: confirme abaixo que o cartão é desta avaliação.' };
    }
    return { ok: true, motivo: '' };
  }

  async function confirmarCorrecao() {
    const av = avaliacao();
    const apl = aplicacao();
    if (!av || !apl) { toast('Avaliação/turma não identificada.', 'err'); return; }
    const assoc = validarAssociacao(av);   // revalida no lançamento (o estado pode ter mudado desde o QR)
    if (!assoc.ok) { toast(assoc.motivo + ' Nada foi salvo.', 'err'); return; }
    const pode = podeSalvar();
    if (!pode.ok) { toast(pode.motivo || 'Aguarde.', 'err'); return; }
    if (st.modo === 'foto' && st.processo?.etapas?.qr?.texto && !igual(codigoDoQR(st.processo.etapas.qr.texto), codigoDe(av))) {
      toast('O QR do cartão não é desta avaliação. Nada foi salvo.', 'err');
      return;
    }

    st.salvando = true;
    atualizarBotoes();
    try {
      const gradeaveis = st.leituras.filter((l) => !l.anulada);
      const automaticas = gradeaveis.filter((l) => l.origem === 'leitor' && l.resolvida && l.estado === 'ok').length;
      const confianca = st.modo === 'foto' && gradeaveis.length ? Number((automaticas / gradeaveis.length).toFixed(3)) : null;

      const r = await store.salvarResultado({
        avaliacao: av,
        aplicacao: apl,
        alunoId: st.alunoId,
        respostas: respostasObjeto(),
        confianca,
        situacao: 'normal',
        imagemRef: null,
        // Toda leitura entra em revisão: a nota só vai ao SIDED+ depois que o
        // professor confirmar aluno por aluno na aba Resultados.
        revisado: false,
        substituir: st.releitura,
      });

      if (!r.ok) { toast(r.erro, 'err'); return; }
      if (r.pendente) toast(r.mensagem, 'ok');
      else if (r.aviso) toast(r.aviso, 'err');

      st.releitura = false;
      st.resultado = r.resultado;
      st.etapa = 'resultado';
      pintar();
    } finally {
      st.salvando = false;
      atualizarBotoes();
    }
  }

  async function registrarSemCartao(situacao) {
    const av = avaliacao();
    const apl = aplicacao();
    if (!av || !apl || !st.alunoId) return;

    const r = await store.registrarSituacao({ avaliacao: av, aplicacao: apl, alunoId: st.alunoId, situacao });
    if (!r.ok) { toast(r.erro, 'err'); return; }
    st.resultado = r.resultado;
    st.etapa = 'resultado';
    pintar();
  }

  /* ---------------- Ajustes de leitura (Plano B) ---------------- */

  const CAMPOS_AJUSTE = [
    { k: 'marcada', rotulo: 'Limiar de marcação', min: 0.05, max: 0.95, passo: 0.01, ajuda: 'A partir de quanto preenchida a bolinha conta como marcada.' },
    { k: 'fraca', rotulo: 'Limiar de marca fraca', min: 0.01, max: 0.9, passo: 0.01, ajuda: 'Abaixo disso a bolinha é considerada vazia.' },
    { k: 'dominancia', rotulo: 'Dominância (marcação dupla)', min: 0.1, max: 1, passo: 0.05, ajuda: 'Duas marcas firmes com a 2ª ≥ esta fração da 1ª = marcação dupla.' },
    { k: 'incerteza', rotulo: 'Incerteza', min: 0.05, max: 1, passo: 0.05, ajuda: 'Outra marca visível com ≥ esta fração da 1ª = leitura incerta (vai para conferência).' },
  ];
  const CAMPOS_AVANCADO = [
    { k: 'raioAmostra', rotulo: 'Área medida da bolinha', min: 0.3, max: 0.9, passo: 0.02, ajuda: 'Fração do raio medida (0,62 = miolo, evita o contorno impresso).' },
    { k: 'percentilPapel', rotulo: 'Referência de papel', min: 0.5, max: 0.95, passo: 0.05, ajuda: 'Percentil das bolinhas usado como "papel vazio".' },
    { k: 'minGrade', rotulo: 'Exigência da grade', min: 0.3, max: 1, passo: 0.05, ajuda: 'Fração mínima de bolinhas encontradas; abaixo disso o cartão é bloqueado.' },
  ];

  function abrirAjustes() {
    const atual = carregarParametros();
    const campo = (c) => `
      <div class="field" style="margin:0">
        <label class="label row between" for="aj-${c.k}"><span>${c.rotulo}</span><output data-out="${c.k}" class="mono">${atual[c.k]}</output></label>
        <input id="aj-${c.k}" type="range" min="${c.min}" max="${c.max}" step="${c.passo}" value="${atual[c.k]}" data-par="${c.k}" />
        <span class="hint">${c.ajuda}</span>
      </div>`;

    const m = el(`
      <div class="modal-back" data-modal>
        <div class="modal" role="dialog" aria-modal="true" aria-label="Ajustes de leitura">
          <div class="row between">
            <h2 style="margin:0">Ajustes de leitura</h2>
            <button class="cf-btn dark" type="button" data-aj-fechar aria-label="Fechar">${icon('close', 18)}</button>
          </div>
          <p class="xs muted">Valem só neste aparelho. Os valores de fábrica podem ser restaurados a qualquer momento.</p>
          ${CAMPOS_AJUSTE.map(campo).join('')}
          <label class="row" style="gap:8px;align-items:center">
            <input type="checkbox" data-par-bool="conferirBranco" ${atual.conferirBranco ? 'checked' : ''} />
            <span class="small">Pedir conferência também das questões em branco</span>
          </label>
          <details>
            <summary class="small strong">Avançado</summary>
            <div class="stack" style="gap:12px;margin-top:10px">${CAMPOS_AVANCADO.map(campo).join('')}</div>
          </details>
          <div class="alert err" data-aj-erro hidden></div>
          <div class="btn-group">
            <button class="btn btn-outline" type="button" data-aj-restaurar>Restaurar padrão</button>
            <button class="btn btn-primary" type="button" data-aj-salvar>Salvar</button>
          </div>
        </div>
      </div>`);
    root.append(m);

    const fechar = () => m.remove();
    const lerForm = () => {
      const p = {};
      m.querySelectorAll('[data-par]').forEach((i) => { p[i.dataset.par] = Number(i.value); });
      m.querySelectorAll('[data-par-bool]').forEach((i) => { p[i.dataset.parBool] = i.checked; });
      return p;
    };
    m.querySelectorAll('[data-par]').forEach((i) => i.addEventListener('input', () => {
      m.querySelector(`[data-out="${i.dataset.par}"]`).textContent = i.value;
    }));
    m.querySelector('[data-aj-fechar]').addEventListener('click', fechar);
    m.addEventListener('click', (e) => { if (e.target === m) fechar(); });

    m.querySelector('[data-aj-restaurar]').addEventListener('click', () => {
      const p = restaurarParametros();
      m.querySelectorAll('[data-par]').forEach((i) => {
        i.value = p[i.dataset.par];
        m.querySelector(`[data-out="${i.dataset.par}"]`).textContent = p[i.dataset.par];
      });
      m.querySelectorAll('[data-par-bool]').forEach((i) => { i.checked = !!p[i.dataset.parBool]; });
      m.querySelector('[data-aj-erro]').hidden = true;
      toast('Ajustes restaurados para os valores de fábrica.', 'ok');
      oferecerReleitura();
    });

    m.querySelector('[data-aj-salvar]').addEventListener('click', () => {
      const p = lerForm();
      const erro = m.querySelector('[data-aj-erro]');
      if (!(p.fraca < p.marcada)) {
        erro.textContent = 'O limiar de marca fraca precisa ser menor que o de marcação.';
        erro.hidden = false;
        return;
      }
      erro.hidden = true;
      salvarParametros(p);
      toast('Ajustes salvos.', 'ok');
      fechar();
      oferecerReleitura();
    });
  }

  function oferecerReleitura() {
    if (st.etapa === 'conferencia' && st.imagemProc) pintar();
  }

  async function reler() {
    if (!st.imagemProc || !avaliacao()) return;
    try {
      const { cv } = await carregarOpenCV();
      ov.cv = cv;
      toast('Relendo o cartão com os ajustes atuais…');
      await dorme(30);
      const r = await processarCartao(cv, st.imagemProc, opcoesDeLeitura());
      if (!r.ok) { toast(r.mensagem || 'Não foi possível reler.', 'err'); return; }
      st.processo = r;
      st.cartaoQR = r.etapas.qr.cartao || null;
      st.semQR = !r.etapas.qr.ok;
      montarLeituras(r.leituras, st.leituras);
      toast('Cartão relido. Respostas editadas por você foram mantidas.', 'ok');
      pintar();
    } catch (e) {
      toast('Erro ao reler: ' + (e?.message || e), 'err');
    }
  }

  /* ---------------- Render ---------------- */

  function atualizarGrade() {
    const grade = body.querySelector('#grade');
    if (grade) grade.innerHTML = (st.leituras || []).map(tileHTML).join('');
    const box = body.querySelector('#scorebox');
    if (box) box.innerHTML = scoreHTML();
    atualizarBotoes();
  }

  function atualizarBotoes() {
    const b = body.querySelector('[data-confirmar]');
    if (!b) return;
    const pode = podeSalvar();
    b.disabled = !pode.ok;
    const dica = body.querySelector('[data-dica-salvar]');
    if (dica) { dica.textContent = pode.motivo; dica.hidden = !pode.motivo; }
    const lote = body.querySelector('[data-lote]');
    if (lote) {
      const n = pendentesSemSugestao().length;
      lote.hidden = !n;
      lote.textContent = `Confirmar ${n} em branco`;
    }
    const badgeEl = body.querySelector('[data-badge-pend]');
    if (badgeEl) {
      const p = pendentes().length;
      badgeEl.className = 'badge ' + (p ? 'warn' : 'ok');
      badgeEl.textContent = p ? `${p} a conferir` : 'Tudo conferido';
    }
  }

  const pendentesSemSugestao = () => pendentes().filter((l) => !l.sugestao);

  function abrirEditor(numero) {
    st.ativa = numero;
    const wrap = body.querySelector('#editor-box');
    if (!wrap) return;
    wrap.innerHTML = editorHTML();
    const editor = wrap.querySelector('#editor');
    if (!editor) return;
    editor.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });

    editor.querySelectorAll('[data-opt]').forEach((b) => {
      b.addEventListener('click', () => {
        const l = (st.leituras || []).find((x) => x.numero === numero);
        if (!l) return;
        l.resposta = b.dataset.opt || null;
        l.resolvida = true;
        l.origem = 'professor';
        st.ativa = null;
        wrap.innerHTML = '';
        atualizarGrade();
      });
    });
    editor.querySelector('[data-fechar-editor]').addEventListener('click', () => {
      st.ativa = null;
      wrap.innerHTML = '';
    });
  }

  function meta(extra = '') {
    const t = store.turma(st.turmaId);
    const a = store.aluno(st.alunoId);
    return `<div class="step-meta">
      <span class="small strong">${ETAPAS[st.etapa]}</span>
      <span class="xs muted">${esc([t?.nome, a?.nome_completo, extra].filter(Boolean).join(' · '))}</span>
    </div>`;
  }

  /* ---- Etapa 1: turma ---- */

  function etapaTurma() {
    const turmas = store.turmasDoProfessor(store.sessao().professor_id);
    const infos = turmas.map((t) => ({ t, ...infoTurma(t.id) }));
    const faltam = infos.filter((i) => !i.completo).length;

    body.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">Leitura</span>
        <h1>Selecione a turma</h1>
        <p>${esc(store.sessao()?.escola || 'Escola não informada')}</p>
      </div>

      ${infos.length ? `
        <div class="card stack tight list-card">
          ${infos.map(({ t, total, feitos, completo }) => `
            <button type="button" class="turma-row" data-turma="${esc(t.id)}">
              <span class="tr-check ${completo ? 'ok' : ''}">${completo ? icon('check', 15) : ''}</span>
              <span class="grow">
                <span class="tr-nome">${esc(t.nome)}</span>
                <span class="tr-sub">${completo ? 'Finalizado' : 'Em andamento'}</span>
              </span>
              <span class="tr-bars" aria-hidden="true">
                ${[0, 1, 2, 3, 4].map((i) => `<span class="${total && feitos / total > i / 5 ? 'on' : ''}"></span>`).join('')}
              </span>
              <span class="tr-cont">${feitos} de ${total}</span>
            </button>`).join('')}
        </div>

        <div class="row between wrap" style="gap:10px">
          <span class="small ${faltam ? 'strong' : 'muted'}">Faltam ${faltam} de ${infos.length} turmas para sincronizar</span>
          <span class="row" style="gap:8px">
            <button class="btn btn-outline btn-sm" type="button" data-ajustes>${icon('sliders', 15)} Ajustes de leitura</button>
            <button class="btn btn-outline btn-sm" type="button" data-recarregar>${icon('refresh', 15)} Recarregar</button>
          </span>
        </div>
      ` : `
        <div class="empty">
          <div class="ei">${icon('users', 20)}</div>
          <h3>Nenhuma turma vinculada</h3>
          <p>Fale com a secretaria da escola.</p>
        </div>`}
    `;

    body.querySelectorAll('[data-turma]').forEach((b) => {
      b.addEventListener('click', () => {
        st.turmaId = b.dataset.turma;
        st.alunoId = null;
        st.avaliacaoId = null;
        st.avaliacaoFixa = false;
        st.qrLido = false;
        st.leituras = null;
        st.aba = 'estudantes';
        st.busca = '';
        st.etapa = 'aluno';
        pintar();
      });
    });
    body.querySelector('[data-ajustes]')?.addEventListener('click', abrirAjustes);
    body.querySelector('[data-recarregar]')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      await store.recarregar();
      pintar();
    });
  }

  /* ---- Etapa 2: aluno / instrumento ---- */

  function abaEstudantes() {
    const lista = alunosFiltrados();
    const avs = avaliacoesDaTurma();

    return `
      <div class="field" style="margin:0">
        <label class="label sr-only" for="busca">Buscar estudante</label>
        <div class="search-box">
          ${icon('search', 16)}
          <input id="busca" class="input" type="search" placeholder="Buscar estudante" value="${esc(st.busca)}" data-busca />
        </div>
      </div>

      ${lista.length ? `
        <div class="card stack tight list-card" style="padding:0">
          ${lista.map((a) => {
            const corrigidos = avs.filter((av) => resultadoDoAlunoNaTurma(av.id, a.id)).length;
            const totalAvs = avs.length;
            return `
              <button type="button" class="aluno-row" data-aluno="${esc(a.id)}">
                <span class="grow">
                  <span class="al-nome">${esc(a.nome_completo)}</span>
                  <span class="al-sub">${totalAvs ? `${corrigidos} de ${totalAvs} avaliação(ões)` : 'Sem avaliação aplicada'}</span>
                </span>
                <span class="al-add">${icon('plus', 18)}</span>
              </button>`;
          }).join('')}
        </div>` : `
        <div class="empty">
          <div class="ei">${icon('users', 20)}</div>
          <h3>Nenhum estudante encontrado</h3>
          <p>${st.busca ? 'Tente outro nome.' : 'Esta turma não tem alunos cadastrados.'}</p>
        </div>`}
    `;
  }

  function abaInstrumentos() {
    const avs = avaliacoesDaTurma();
    return `
      ${avs.length ? `
        <div class="card stack tight list-card">
          ${avs.map((av) => {
            const prog = store.progresso(av, st.turmaId);
            return `
              <button type="button" class="inst-row" data-instrumento="${esc(av.id)}">
                <span class="grow">
                  <span class="al-nome">${esc(av.titulo)}</span>
                  <span class="al-sub mono">${esc(codigoDe(av))} · ${av.questoes.length} questões</span>
                </span>
                <span class="tr-cont">${prog.registrados} de ${prog.total}</span>
              </button>`;
          }).join('')}
        </div>` : `
        <div class="empty">
          <div class="ei">${icon('cards', 20)}</div>
          <h3>Nenhuma avaliação aplicada</h3>
          <p>Crie uma avaliação para esta turma.</p>
        </div>`}
    `;
  }

  function etapaAluno() {
    const t = store.turma(st.turmaId);
    body.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">Leitura</span>
        <h1>Selecione um aluno</h1>
      </div>

      <div class="capture-head">
        <button class="icon-btn" type="button" data-voltar-turma aria-label="Voltar">${icon('left', 18)}</button>
        <span class="grow">
          <span class="strong">${esc(t?.nome || 'Turma')}</span>
          <span class="xs muted" style="display:block">${esc(store.sessao()?.escola || '')}</span>
        </span>
      </div>

      <div class="tabs" role="tablist">
        <button type="button" class="tab ${st.aba === 'estudantes' ? 'on' : ''}" data-aba="estudantes" role="tab">Estudantes</button>
        <button type="button" class="tab ${st.aba === 'instrumentos' ? 'on' : ''}" data-aba="instrumentos" role="tab">Instrumentos</button>
      </div>

      ${st.aba === 'estudantes' ? abaEstudantes() : abaInstrumentos()}
    `;

    body.querySelector('[data-voltar-turma]').addEventListener('click', () => {
      st.etapa = 'turma';
      st.turmaId = null;
      pintar();
    });

    body.querySelectorAll('[data-aba]').forEach((b) => {
      b.addEventListener('click', () => { st.aba = b.dataset.aba; pintar(); });
    });

    const busca = body.querySelector('[data-busca]');
    if (busca) {
      busca.addEventListener('input', () => {
        st.busca = busca.value;
        const pos = busca.selectionStart;
        pintar();
        const novo = body.querySelector('[data-busca]');
        if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
      });
    }

    // Escolher o aluno abre a câmera em tela cheia; o QR do caderno define a avaliação.
    body.querySelectorAll('[data-aluno]').forEach((b) => {
      b.addEventListener('click', () => {
        if (!avaliacoesDaTurma().length) { toast('Nenhuma avaliação aplicada a esta turma.', 'err'); return; }
        st.alunoId = b.dataset.aluno;
        st.leituras = null;
        st.processo = null;
        st.imagemProc = null;
        st.avaliacaoId = null;
        st.avaliacaoFixa = false;
        st.qrLido = false;
        st.releitura = false;
        st.etapa = 'cartao';
        pintar();
        abrirCamera();
      });
    });

    // Instrumento escolhido à mão: o QR lido precisa ser dessa avaliação.
    body.querySelectorAll('[data-instrumento]').forEach((b) => {
      b.addEventListener('click', () => {
        if (!st.alunoId) { toast('Escolha o estudante na aba Estudantes.', 'err'); return; }
        st.avaliacaoId = b.dataset.instrumento;
        st.avaliacaoFixa = true;
        st.qrLido = false;
        st.leituras = null;
        st.processo = null;
        st.imagemProc = null;
        st.etapa = 'cartao';
        pintar();
        abrirCamera();
      });
    });
  }

  /* ---- Etapa 3: cartão (a câmera fica no overlay; aqui é o ponto de retorno) ---- */

  function etapaCartao() {
    const aluno = store.aluno(st.alunoId);
    const av = (st.qrLido || st.releitura) && st.avaliacaoId ? avaliacao() : null;
    body.innerHTML = `
      <div class="capture-head">
        <button class="icon-btn" type="button" data-voltar-aluno aria-label="Voltar">${icon('left', 18)}</button>
        <span class="grow">
          <span class="strong">${esc(aluno?.nome_completo || '')}</span>
          <span class="xs muted" style="display:block">${esc(store.turma(st.turmaId)?.nome || '')}</span>
        </span>
        ${av ? badge('Caderno ' + codigoDe(av), 'y') : ''}
      </div>

      ${st.releitura ? `
        <div class="alert y">
          ${icon('refresh', 16)}
          <span>Reler o cartão de <strong>${esc(aluno?.nome_completo || '')}</strong> em <strong>${esc(av?.titulo || '')}</strong>.
            A nota atual só é substituída depois que você confirmar a nova correção.</span>
        </div>` : ''}

      <div class="card stack">
        <p class="small" style="margin:0">${av
          ? `Avaliação: <strong>${esc(av.titulo)}</strong>. Leia o QR Code do caderno e depois o cartão resposta.`
          : 'Leia o QR Code do caderno e depois o cartão resposta.'}</p>
        <button class="btn btn-primary btn-block" type="button" data-abrir-cam>${icon('camera', 17)} ${av ? 'Ler o cartão resposta' : 'Abrir a câmera'}</button>
      </div>
    `;
    body.querySelector('[data-voltar-aluno]').addEventListener('click', () => {
      st.releitura = false;   // sair da releitura volta ao fluxo normal
      st.etapa = 'aluno';
      pintar();
    });
    body.querySelector('[data-abrir-cam]').addEventListener('click', () => abrirCamera());
  }

  /* ---- Etapa 4: conferência ---- */

  function legendaHTML() {
    const c = contagens();
    const item = (k, rotulo) => `<span class="lg lg-${k}"><i></i>${rotulo} <b>${c[k]}</b></span>`;
    return `<div class="legenda">
      ${item('ok', 'Seguras')}${item('branco', 'Em branco')}${item('fraca', 'Fracas')}${item('multipla', 'Duplas')}${item('incerta', 'Incertas')}
    </div>`;
  }

  function etapaConferencia() {
    const av = avaliacao();
    const manual = st.modo === 'manual';
    const pode = podeSalvar();
    const p = pendentes().length;

    body.innerHTML = `
      <div class="capture-head">
        <button class="icon-btn" type="button" data-voltar-cartao aria-label="Voltar">${icon('left', 18)}</button>
        <span class="grow">
          <span class="strong">${esc(store.aluno(st.alunoId)?.nome_completo || '')}</span>
          <span class="xs muted" style="display:block">${esc(av?.titulo || '')} · ${esc(codigoDe(av))}</span>
        </span>
        <span class="badge ${p ? 'warn' : 'ok'}" data-badge-pend>${p ? `${p} a conferir` : 'Tudo conferido'}</span>
      </div>

      <div class="card">
        ${manual
          ? '<p class="xs muted" style="margin-bottom:10px">Lançamento manual (sem foto): toque em cada questão e marque a alternativa do cartão.</p>'
          : `${legendaHTML()}
             <p class="xs muted" style="margin:10px 0">Amarelo = precisa da sua decisão. Toque na questão para escolher a alternativa ou deixar em branco.</p>`}
        ${!manual && st.cartaoQR ? `<p class="xs muted" style="margin:0 0 8px">Cartão lido: ${esc(descreverCartao(st.cartaoQR))}</p>` : ''}
        ${!manual && st.processo?.layout?.versao === 3 ? `<div class="alert y" style="margin:0 0 10px">
          ${icon('info', 16)}
          <span>Este cartão foi impresso no <span class="strong">layout anterior (v3)</span>. A leitura usou a grade antiga, que confere com a folha.
          Imprima os próximos cartões na aba Cartões (layout v4).</span>
        </div>` : ''}
        <div class="ans-grid" id="grade">${st.leituras.map(tileHTML).join('')}</div>
        <div id="editor-box"></div>
        <div class="row wrap" style="gap:8px;margin-top:10px">
          <button class="btn btn-outline btn-sm" type="button" data-lote hidden></button>
        </div>
        <div id="scorebox" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
          ${scoreHTML()}
        </div>
      </div>

      ${!manual && st.semQR ? `
        <div class="alert warn">
          ${icon('alert', 16)}
          <span>O QR Code deste cartão não foi lido. A avaliação vale pelo caderno lido antes.
            <label class="row" style="gap:8px;margin-top:8px;align-items:center">
              <input type="checkbox" data-confirma-cartao ${st.confirmaCartao ? 'checked' : ''} />
              <span>Confirmo que este cartão é de <strong>${esc(av?.titulo || '')}</strong></span>
            </label>
          </span>
        </div>` : ''}

      ${!manual && st.processo ? `
        <details class="card" data-revisao>
          <summary class="small strong">Ver o cartão endireitado</summary>
          <canvas data-canvas-rev style="width:100%;margin-top:10px;border-radius:8px"></canvas>
        </details>` : ''}

      <div class="alert y">
        ${icon('info', 16)}
        <span>Nada duvidoso é salvo sozinho. Questões em branco contam como erro.
          A nota fica em revisão até você confirmar em <a href="#/resultados">Resultados</a>.</span>
      </div>

      <p class="xs strong" data-dica-salvar style="color:var(--warn)" ${pode.motivo ? '' : 'hidden'}>${esc(pode.motivo)}</p>

      <div class="btn-group">
        <button class="btn btn-outline" type="button" data-refazer>${icon('camera', 16)} Refazer foto</button>
        <button class="btn btn-primary" type="button" data-confirmar ${pode.ok ? '' : 'disabled'}>Confirmar correção</button>
      </div>
      <div class="row wrap" style="gap:8px">
        <button class="btn btn-ghost btn-sm" type="button" data-ajustes>${icon('sliders', 15)} Ajustes de leitura</button>
        ${st.imagemProc ? '<button class="btn btn-ghost btn-sm" type="button" data-reler>Reler com os ajustes</button>' : ''}
      </div>
    `;

    // Delegação: a grade é recriada a cada edição (atualizarGrade), então o listener fica no contêiner.
    body.querySelector('#grade').addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-tile]');
      if (t) abrirEditor(Number(t.dataset.tile));
    });
    body.querySelector('[data-voltar-cartao]').addEventListener('click', () => { st.etapa = 'cartao'; pintar(); });
    body.querySelector('[data-confirmar]').addEventListener('click', confirmarCorrecao);
    body.querySelector('[data-ajustes]').addEventListener('click', abrirAjustes);
    body.querySelector('[data-reler]')?.addEventListener('click', reler);

    body.querySelector('[data-lote]').addEventListener('click', () => {
      pendentesSemSugestao().forEach((l) => { l.resposta = null; l.resolvida = true; l.origem = 'professor'; });
      atualizarGrade();
    });
    body.querySelector('[data-confirma-cartao]')?.addEventListener('change', (e) => {
      st.confirmaCartao = e.target.checked;
      atualizarBotoes();
    });
    body.querySelector('[data-refazer]').addEventListener('click', () => {
      st.leituras = null;
      st.processo = null;
      st.imagemProc = null;
      st.etapa = 'cartao';
      pintar();
      abrirCamera();
    });

    if (!manual && st.processo) {
      const det = body.querySelector('[data-revisao]');
      const desenhar = () => {
        const canvas = body.querySelector('[data-canvas-rev]');
        if (!canvas || !st.processo?.alinhada) return;
        // Só aparece anel verde no que está resolvido; o que ainda pende aparece em amarelo.
        const marcadas = st.leituras.map((l) => ({
          numero: l.numero,
          estado: l.resolvida ? 'ok' : (l.estado === 'ok' ? 'incerta' : l.estado),
          detectada: l.resolvida ? l.resposta : null,
          preenchimento: l.preenchimento,
        }));
        desenharRevisao(canvas, st.processo.alinhada, st.processo.layout, marcadas, 720);
      };
      det?.addEventListener('toggle', () => { if (det.open) desenhar(); });
    }
    atualizarBotoes();
  }

  /* ---- Resultado ---- */

  function etapaResultado() {
    const av = avaliacao();
    const r = st.resultado || {};
    const faixa = store.faixaDe(av, r.percentual || 0);
    body.innerHTML = `
      <div class="card stack">
        <div class="card-head">
          <div>
            <h2>${esc(store.aluno(st.alunoId)?.nome_completo || '')}</h2>
            <p class="xs muted">${esc(av?.titulo || '')}</p>
          </div>
          ${situacaoBadge(r.situacao)}
        </div>

        <div class="row between wrap" style="gap:12px">
          <div>
            <div class="xs muted">Nota</div>
            <div class="result-big">
              <span class="rn">${r.nota == null ? '—' : fmtNota(r.nota)}</span>
              <span class="small muted">/ ${fmtNota(av?.valor_total || 0)}</span>
            </div>
          </div>
          <div style="text-align:right">${desempenhoTexto(r.percentual || 0, faixa)}</div>
        </div>

        ${barraDesempenho(r.percentual || 0, faixa)}

        <div class="kv-list" style="margin-top:12px">
          <div><span class="k">Acertos</span><span class="v">${r.acertos ?? '—'}</span></div>
          <div><span class="k">Erros</span><span class="v">${r.erros ?? '—'}</span></div>
          <div><span class="k">Situação</span><span class="v">${esc(store.SITUACOES[r.situacao]?.rotulo || r.situacao || '—')}</span></div>
          <div><span class="k">Registro</span><span class="v">${r.status === 'confirmado' ? 'Confirmado' : 'Revisão pendente'}</span></div>
        </div>

        ${r.status === 'confirmado' ? '' : `
          <p class="xs muted" style="margin:0">
            A nota foi gravada em revisão. Confirme em <a href="#/resultados">Resultados</a> antes de enviar ao SIDED+.
          </p>`}
      </div>

      <div class="btn-group">
        <button class="btn btn-outline" type="button" data-outro>Corrigir outro</button>
        <button class="btn btn-primary" type="button" data-concluir>Concluir</button>
      </div>
    `;

    const limpar = () => {
      st.leituras = null;
      st.processo = null;
      st.imagemProc = null;
      st.resultado = null;
      st.avaliacaoId = null;
      st.avaliacaoFixa = false;
      st.qrLido = false;
      st.semQR = false;
      st.confirmaCartao = false;
    };

    body.querySelector('[data-outro]').addEventListener('click', () => {
      st.alunoId = null;
      limpar();
      st.etapa = 'aluno';
      pintar();
    });
    body.querySelector('[data-concluir]').addEventListener('click', () => {
      st.turmaId = null;
      st.alunoId = null;
      limpar();
      st.etapa = 'turma';
      pintar();
    });
  }

  /* ---------------- Pintar ---------------- */

  function pintar() {
    if (st.etapa === 'turma') return etapaTurma();
    if (st.etapa === 'aluno') return etapaAluno();
    if (st.etapa === 'cartao') return etapaCartao();
    if (st.etapa === 'conferencia') return etapaConferencia();
    return etapaResultado();
  }

  // Adianta o OpenCV em segundo plano enquanto o professor ainda escolhe o aluno: quando a câmera abrir
  // ele já está pronto e a abertura não disputa a thread principal com os 13 MB do leitor.
  (globalThis.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => { if (!ov.cv) precarregarOpenCV(); });

  pintar();
  return {
    node: root,
    destroy: () => {
      ov.aberto = false;
      clearTimeout(ov.timer);
      if (alvoObs) { alvoObs.disconnect(); alvoObs = null; }
      document.body.classList.remove('cam-open');
      sairTelaCheia();
      pararCamera();
    },
  };
}

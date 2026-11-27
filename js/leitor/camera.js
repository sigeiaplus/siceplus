/* SIGEIA AVALIAÇÕES · Seleção da câmera traseira PRINCIPAL (1x) e resolução máxima.
 *
 * Regras (mudança 1):
 *  - usa somente a câmera traseira principal; nunca ultrawide (0,5x), tele, macro, profundidade ou frontal;
 *  - pede a maior resolução que essa câmera suportar;
 *  - se não der para identificar a principal com segurança, NÃO escolhe outra lente: lança CameraErro
 *    explicando a limitação (o professor ainda pode usar "Enviar foto").
 *
 * Limite do navegador: a web não informa "esta é a lente 1x". Só existe o nome (label) da câmera, que
 * só aparece depois que a permissão é concedida, e o formato do nome varia por sistema. Por isso a escolha
 * é por regras sobre o nome, com a confiança registrada em `info.confianca`.
 */

export class CameraErro extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'CameraErro';
    this.codigo = codigo;
  }
}

/** Resolução pedida (o navegador entrega o modo mais próximo; depois sobe até o máximo da câmera). */
export const RESOLUCAO_ALVO = { largura: 4096, altura: 3072 };

/**
 * Resolução da PRÉ-VISUALIZAÇÃO. O vídeo roda nesse tamanho (fluido) e a foto
 * final é tirada na resolução máxima da câmera (ver prepararCaptura / fotoEmAlta).
 */
export const LARGURA_PREVIAO = 1440;

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Classifica o nome de uma câmera.
 * @returns {{tipo: 'frontal'|'ultrawide'|'auxiliar'|'virtual'|'traseira'|'desconhecida', principalExplicita: boolean, androidId: number|null}}
 */
export function classificarRotulo(rotulo) {
  const r = semAcento(rotulo);
  const vazio = { tipo: 'desconhecida', principalExplicita: false, androidId: null };
  if (!r) return vazio;

  if (/\bfront|\buser\b|selfie|frontal|facetime|\binterna\b/.test(r)) return { ...vazio, tipo: 'frontal' };
  if (/ultra|0[.,]5\s?x|grande.?angular|wide.?angle/.test(r)) return { ...vazio, tipo: 'ultrawide' };
  if (/tele(photo|objetiva)?\b|periscop|macro|depth|profundidade|\btof\b|\b[2-9](\.\d)?\s?x\b|\bzoom\b/.test(r)) {
    return { ...vazio, tipo: 'auxiliar' };
  }
  // Câmeras virtuais (juntam várias lentes e podem trocar para a ultrawide sozinhas).
  if (/\b(dual|triple|quad|tripla|dupla)\b/.test(r)) return { ...vazio, tipo: 'virtual' };

  const android = r.match(/camera2?\s*(\d+)\s*,?\s*facing\s*back/);
  if (android) return { tipo: 'traseira', principalExplicita: false, androidId: Number(android[1]) };

  if (/\b(back|rear|traseira|environment)\b/.test(r)) {
    // "Back Camera" / "Câmera traseira" / "main" / "principal": a lente padrão do aparelho.
    const explicita = /^(back|rear)\s+camera$/.test(r) || /^camera\s+(traseira|principal)$/.test(r) || /\b(main|principal)\b/.test(r);
    return { tipo: 'traseira', principalExplicita: explicita, androidId: null };
  }
  return vazio;
}

/**
 * Escolhe a câmera principal entre os dispositivos de vídeo.
 * @param {Array<{deviceId: string, label: string}>} dispositivos  (videoinput já com nomes)
 * @returns {{deviceId: string, label: string, confianca: 'explicita'|'unica'|'convencao-android', motivo: string}}
 * @throws {CameraErro} quando não dá para identificar com segurança
 */
export function escolherPrincipal(dispositivos) {
  const lista = (dispositivos || []).filter((d) => d && d.deviceId);
  if (!lista.length) throw new CameraErro('sem-camera', 'Nenhuma câmera foi encontrada neste aparelho. Use "Enviar foto".');

  if (lista.every((d) => !String(d.label || '').trim())) {
    throw new CameraErro('sem-nomes',
      'Este navegador não informa o nome das câmeras, então não consigo garantir a lente principal (1x). ' +
      'Use "Enviar foto" ou abra o SIGEIA AVALIAÇÕES no Chrome (Android) ou no Safari (iPhone).');
  }

  const analisadas = lista.map((d) => ({ d, c: classificarRotulo(d.label) }));
  const candidatas = analisadas.filter((x) => x.c.tipo === 'traseira');

  if (!candidatas.length) {
    const soVirtual = analisadas.some((x) => x.c.tipo === 'virtual') && !analisadas.some((x) => x.c.tipo === 'traseira');
    throw new CameraErro(soVirtual ? 'so-virtual' : 'sem-principal',
      soVirtual
        ? 'O aparelho só oferece uma câmera combinada (várias lentes), que pode usar a ultrawide. Não consigo garantir a lente principal (1x). Use "Enviar foto".'
        : 'Não encontrei a câmera traseira principal (1x) neste aparelho. Use "Enviar foto".');
  }

  const explicitas = candidatas.filter((x) => x.c.principalExplicita);
  if (explicitas.length === 1) {
    return { deviceId: explicitas[0].d.deviceId, label: explicitas[0].d.label, confianca: 'explicita', motivo: 'Nome indica a câmera traseira principal.' };
  }
  if (candidatas.length === 1) {
    return { deviceId: candidatas[0].d.deviceId, label: candidatas[0].d.label, confianca: 'unica', motivo: 'Única câmera traseira comum disponível (ultrawide, tele e combinadas descartadas).' };
  }
  // Android/Chrome: "camera2 0, facing back", "camera2 2, facing back"... o id 0 é, por convenção do Android, a principal.
  const comId = candidatas.filter((x) => x.c.androidId != null);
  if (comId.length === candidatas.length) {
    comId.sort((a, b) => a.c.androidId - b.c.androidId);
    return { deviceId: comId[0].d.deviceId, label: comId[0].d.label, confianca: 'convencao-android', motivo: 'Menor id de câmera traseira no Android (convenção: câmera principal).' };
  }
  throw new CameraErro('ambigua',
    'O aparelho tem mais de uma câmera traseira e não consigo identificar com segurança qual é a principal (1x). Use "Enviar foto".');
}

const pixels = (s) => (s && s.width && s.height ? s.width * s.height : 0);

/** Zoom máximo oferecido na interface. */
export const ZOOM_MAX = 3;

/** Faixa de zoom que a câmera aberta aceita (null = o navegador não deixa controlar). */
export function limitesZoom(track) {
  const cap = track && track.getCapabilities ? track.getCapabilities() : null;
  const c = cap && cap.zoom;
  if (!c || typeof c.min !== 'number' || typeof c.max !== 'number' || !(c.max > c.min)) return null;
  const set = track.getSettings ? track.getSettings() : {};
  return {
    min: c.min,
    max: c.max,
    passo: c.step || 0.1,
    atual: typeof set.zoom === 'number' ? set.zoom : c.min,
  };
}

/**
 * Aplica um zoom (1x = mais aberto que o aparelho permite, no mínimo; até ZOOM_MAX).
 * Devolve o valor efetivo ou null quando a câmera não aceita zoom.
 */
export async function aplicarZoom(track, fator) {
  const lim = limitesZoom(track);
  if (!lim || !track.applyConstraints) return null;
  const alvo = Math.min(lim.max, Math.max(lim.min, Number(fator) || 1));
  try {
    await track.applyConstraints({ advanced: [{ zoom: alvo }] });
  } catch (_) {
    try { await track.applyConstraints({ zoom: alvo }); } catch (__) { return null; }
  }
  const set = track.getSettings ? track.getSettings() : {};
  return typeof set.zoom === 'number' ? set.zoom : alvo;
}

/**
 * Volta ao enquadramento mais aberto possível (~1x). É o que corrige a impressão de
 * "já abriu em 2x": o zoom é aplicado DEPOIS de escolher a resolução de vídeo, porque
 * trocar a resolução pode mudar o recorte do sensor.
 */
export async function zerarZoom(track) {
  const lim = limitesZoom(track);
  if (!lim) return null;
  return aplicarZoom(track, Math.max(lim.min, 1));
}

/** Sobe a resolução até o máximo que a câmera informa, mantendo o melhor resultado. */
async function subirResolucao(track) {
  const cap = track.getCapabilities ? track.getCapabilities() : null;
  if (!cap || !cap.width || !cap.height || !cap.width.max || !cap.height.max) return;
  const antes = track.getSettings();
  if (pixels(antes) >= cap.width.max * cap.height.max * 0.95) return;
  try {
    await track.applyConstraints({ width: { ideal: cap.width.max }, height: { ideal: cap.height.max } });
  } catch (_) { return; }
  const depois = track.getSettings();
  if (pixels(depois) < pixels(antes)) {
    try { await track.applyConstraints({ width: { ideal: antes.width }, height: { ideal: antes.height } }); } catch (_) { /* mantém */ }
  }
}

const parar = (stream) => { if (stream) stream.getTracks().forEach((t) => t.stop()); };

/* ---------------- Cache da escolha (abertura rápida) ----------------
 * Abrir a câmera custava 3 a 7 s: um getUserMedia só para liberar os nomes das lentes, a escolha,
 * um segundo getUserMedia em 4096x3072 e depois mais trocas de resolução. Agora a lente escolhida
 * (e a resolução máxima dela) fica guardada neste aparelho e a abertura é UM getUserMedia já no
 * tamanho da pré-visualização. Se a lente guardada falhar, o cache é apagado e o caminho completo
 * (com todas as conferências de "só a principal 1x") roda de novo. */

const CHAVE_CACHE = 'sicep-camera-v2';

function lerCache() {
  try {
    const c = JSON.parse(globalThis.localStorage?.getItem(CHAVE_CACHE) || 'null');
    if (c && typeof c.deviceId === 'string' && c.deviceId) return c;
  } catch (_) { /* sem cache */ }
  return null;
}

function gravarCache(c) {
  try { globalThis.localStorage?.setItem(CHAVE_CACHE, JSON.stringify(c)); } catch (_) { /* sem cache */ }
}

/** Apaga a lente guardada (a próxima abertura refaz a escolha completa). */
export function limparCacheCamera() {
  try { globalThis.localStorage?.removeItem(CHAVE_CACHE); } catch (_) { /* ok */ }
}

/** Lista as câmeras COM nome. Só abre uma câmera "de sonda" quando o navegador não revela os nomes. */
async function dispositivosComNome(md) {
  const listar = async () => (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  let lista = [];
  try { lista = await listar(); } catch (_) { /* tenta com sonda */ }
  if (lista.some((d) => String(d.label || '').trim())) return lista;

  // Sem nomes (permissão ainda não concedida): a sonda libera os nomes. Este quadro é descartado.
  let sonda = null;
  try {
    sonda = await md.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    return await listar();
  } finally {
    parar(sonda);
  }
}

/**
 * Abre a câmera escolhida UMA vez, já no tamanho da pré-visualização, e confere a lente aberta.
 * @param {{deviceId: string, label: string, confianca: string, motivo: string}} escolha
 * @param {{largura: number, altura: number}|null} maximaConhecida  resolução máxima guardada (ou null)
 */
async function abrirEscolha(md, escolha, maximaConhecida) {
  // Sem máxima conhecida, assume sensor 4:3 só para a prévia sair com a orientação certa (em pé/deitado).
  const alvo = tamanhoPrevia(maximaConhecida || { largura: 4032, altura: 3024 });
  const stream = await md.getUserMedia({
    audio: false,
    video: {
      deviceId: { exact: escolha.deviceId },
      width: { ideal: alvo.largura },
      height: { ideal: alvo.altura },
    },
  });
  const track = stream.getVideoTracks()[0];

  // Conferência: o nome do track aberto não pode ser frontal/ultrawide/auxiliar/virtual.
  const aberta = classificarRotulo(track.label || escolha.label);
  const set0 = track.getSettings ? track.getSettings() : {};
  if (['frontal', 'ultrawide', 'auxiliar', 'virtual'].includes(aberta.tipo) || set0.facingMode === 'user') {
    parar(stream);
    throw new CameraErro('lente-errada', 'O aparelho abriu uma lente que não é a principal (1x). Use "Enviar foto".');
  }

  // Resolução máxima (usada só na hora da foto): vem do cache ou das capacidades da câmera.
  // Sem nenhuma das duas, mede como antes (sobe até o máximo e volta para a prévia).
  let maxima = maximaConhecida && maximaConhecida.largura ? maximaConhecida : null;
  if (!maxima) {
    const cap = track.getCapabilities ? track.getCapabilities() : null;
    if (cap && cap.width && cap.height && cap.width.max && cap.height.max) {
      maxima = { largura: cap.width.max, altura: cap.height.max };
    }
  }
  let previa;
  if (maxima) {
    const s = track.getSettings ? track.getSettings() : {};
    previa = { largura: s.width || alvo.largura, altura: s.height || alvo.altura };
  } else {
    await subirResolucao(track);
    const final = track.getSettings ? track.getSettings() : {};
    maxima = { largura: final.width || null, altura: final.height || null };
    previa = await reduzirParaPrevia(track);
  }

  // Zoom por ÚLTIMO (mexer na resolução depois dele muda o recorte do sensor).
  const zoomInicial = await zerarZoom(track);
  const zoomLimites = limitesZoom(track);

  return {
    stream,
    info: {
      deviceId: escolha.deviceId,
      label: track.label || escolha.label,
      confianca: escolha.confianca,
      motivo: escolha.motivo,
      largura: previa.largura || maxima.largura,
      altura: previa.altura || maxima.altura,
      maxima,
      previa,
      zoomAjustado: zoomInicial != null,
      zoom: zoomInicial,
      zoomLimites: zoomLimites ? { min: zoomLimites.min, max: zoomLimites.max, passo: zoomLimites.passo } : null,
      // O aparelho pode não deixar ir mais aberto que isto (aí não há 1x real).
      zoomPiso: zoomLimites ? Math.max(zoomLimites.min, 1) : null,
    },
  };
}

/**
 * Abre a câmera traseira principal (maior resolução fica reservada para a foto).
 * Nunca recorre a `video: true` nem a outra lente: se algo falhar, lança erro.
 * @param {MediaDevices} md  navigator.mediaDevices
 * @returns {Promise<{stream: MediaStream, info: object}>}
 */
export async function abrirCameraPrincipal(md) {
  if (!md || !md.getUserMedia || !md.enumerateDevices) {
    throw new CameraErro('sem-api', 'Este navegador não permite escolher a câmera. Use "Enviar foto".');
  }

  // Caminho rápido: lente e resolução máxima já conhecidas, um único getUserMedia.
  const guardada = lerCache();
  if (guardada) {
    try {
      const r = await abrirEscolha(md, {
        deviceId: guardada.deviceId, label: guardada.label || '',
        confianca: guardada.confianca || 'explicita', motivo: guardada.motivo || 'Lente principal guardada neste aparelho.',
      }, guardada.maxima || null);
      r.info.doCache = true;
      return r;
    } catch (e) {
      // Permissão negada não se resolve com o caminho completo; qualquer outra falha apaga o cache e refaz tudo.
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      limparCacheCamera();
    }
  }

  // Caminho completo (primeira vez ou lente guardada que falhou).
  const dispositivos = await dispositivosComNome(md);
  const escolha = escolherPrincipal(dispositivos);
  const r = await abrirEscolha(md, escolha, null);
  gravarCache({
    deviceId: escolha.deviceId, label: r.info.label, confianca: escolha.confianca,
    motivo: escolha.motivo, maxima: r.info.maxima,
  });
  return r;
}

/**
 * Tamanho da PRÉ-VISUALIZAÇÃO: maior lado com LARGURA_PREVIAO, na mesma proporção da câmera,
 * mas girado quando a proporção não bate com a tela. Sem isso o celular em pé recebe um quadro
 * 4:3 deitado e a imagem fica numa faixa no meio da tela (com faixa preta em cima e embaixo).
 * O aparelho que não tiver o modo girado devolve o que tiver — a moldura se ajusta depois.
 */
export function tamanhoPrevia(maxima) {
  const larg = (maxima && maxima.largura) || 0;
  const alt = (maxima && maxima.altura) || 0;
  if (!larg || !alt) return { largura: LARGURA_PREVIAO, altura: Math.round(LARGURA_PREVIAO * 0.75) };
  const k = LARGURA_PREVIAO / Math.max(larg, alt);
  const w = Math.max(1, Math.round(larg * k));
  const h = Math.max(1, Math.round(alt * k));
  const telaEmPe = (window.innerHeight || 0) >= (window.innerWidth || 0);
  return (h > w) === telaEmPe ? { largura: w, altura: h } : { largura: h, altura: w };
}

/** Baixa a resolução do vídeo para a pré-visualização (mantém a foto no máximo). */
async function reduzirParaPrevia(track) {
  const atual = track.getSettings ? track.getSettings() : {};
  const alvo = tamanhoPrevia(atual);
  try {
    await track.applyConstraints({
      width: { ideal: alvo.largura },
      height: { ideal: alvo.altura },
    });
  } catch (_) { /* segue com a resolução que estiver */ }
  const s = track.getSettings ? track.getSettings() : {};
  return { largura: s.width || atual.width || null, altura: s.height || atual.height || null };
}

/**
 * Sobe a câmera para a resolução máxima só durante a foto e devolve a função que
 * volta para a pré-visualização. Se o navegador recusar, devolve uma função vazia
 * e a captura usa o quadro atual do vídeo (nunca pior do que antes).
 */
export async function prepararCaptura(track, info) {
  const nada = async () => {};
  if (!track || !track.applyConstraints || !info?.maxima?.largura) return nada;
  const previa = info.previa || {};
  try {
    await track.applyConstraints({
      width: { ideal: info.maxima.largura },
      height: { ideal: info.maxima.altura },
    });
  } catch (_) {
    return nada;
  }
  return async () => {
    try {
      await track.applyConstraints({
        width: { ideal: previa.largura || LARGURA_PREVIAO },
        height: { ideal: previa.altura || Math.round(LARGURA_PREVIAO * 0.75) },
      });
    } catch (_) { /* mantém a resolução maior: só afeta a fluidez do próximo enquadramento */ }
  };
}

/**
 * Foto em resolução máxima pelo ImageCapture (Chrome/Android tira foto no sensor,
 * sem passar pelo vídeo). Devolve um Blob ou null quando o navegador não suporta.
 */
export async function fotoEmAlta(stream) {
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  if (!track || typeof globalThis.ImageCapture === 'undefined') return null;
  try {
    const captura = new globalThis.ImageCapture(track);
    if (typeof captura.takePhoto !== 'function') return null;
    const blob = await captura.takePhoto();
    return blob && blob.size ? blob : null;
  } catch (_) {
    return null;
  }
}

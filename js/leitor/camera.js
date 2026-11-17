/* SICEP+ · Seleção da câmera traseira PRINCIPAL (1x) e resolução máxima.
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
      'Use "Enviar foto" ou abra o SICEP+ no Chrome (Android) ou no Safari (iPhone).');
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

/** Se o zoom da câmera começar fora de 1x (e o navegador permitir), volta para 1x. */
async function garantirZoom1x(track) {
  const cap = track.getCapabilities ? track.getCapabilities() : null;
  const set = track.getSettings ? track.getSettings() : {};
  if (!cap || !cap.zoom || typeof set.zoom !== 'number') return false;
  if (Math.abs(set.zoom - 1) < 0.01) return false;
  if (cap.zoom.min > 1 || cap.zoom.max < 1) return false;
  try {
    await track.applyConstraints({ advanced: [{ zoom: 1 }] });
    return true;
  } catch (_) {
    return false;
  }
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

/**
 * Abre a câmera traseira principal na maior resolução.
 * Nunca recorre a `video: true` nem a outra lente: se algo falhar, lança erro.
 * @param {MediaDevices} md  navigator.mediaDevices
 * @returns {Promise<{stream: MediaStream, info: object}>}
 */
export async function abrirCameraPrincipal(md) {
  if (!md || !md.getUserMedia || !md.enumerateDevices) {
    throw new CameraErro('sem-api', 'Este navegador não permite escolher a câmera. Use "Enviar foto".');
  }

  // 1) Permissão (sem ela os nomes das câmeras vêm vazios). Este quadro é descartado.
  let sonda = null;
  let dispositivos;
  try {
    sonda = await md.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    dispositivos = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  } finally {
    parar(sonda);
  }

  // 2) Escolha da principal (ou erro explicando a limitação).
  const escolha = escolherPrincipal(dispositivos);

  // 3) Abre exatamente essa câmera, pedindo a maior resolução.
  const stream = await md.getUserMedia({
    audio: false,
    video: {
      deviceId: { exact: escolha.deviceId },
      width: { ideal: RESOLUCAO_ALVO.largura },
      height: { ideal: RESOLUCAO_ALVO.altura },
    },
  });
  const track = stream.getVideoTracks()[0];

  // 4) Conferência: o nome do track aberto não pode ser frontal/ultrawide/auxiliar/virtual.
  const aberta = classificarRotulo(track.label || escolha.label);
  const set0 = track.getSettings ? track.getSettings() : {};
  if (['frontal', 'ultrawide', 'auxiliar', 'virtual'].includes(aberta.tipo) || set0.facingMode === 'user') {
    parar(stream);
    throw new CameraErro('lente-errada', 'O aparelho abriu uma lente que não é a principal (1x). Use "Enviar foto".');
  }

  // 5) 1x e resolução máxima: assim a foto final tem a maior resolução disponível.
  const zoomAjustado = await garantirZoom1x(track);
  await subirResolucao(track);
  const final = track.getSettings ? track.getSettings() : {};
  const maxima = { largura: final.width || null, altura: final.height || null };

  // 6) Pré-visualização em resolução menor. Quadros de 12 MP sendo desenhados a
  //    cada frame travam a tela do celular; a foto continua saindo no tamanho máximo.
  const previa = await reduzirParaPrevia(track, maxima);

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
      zoomAjustado,
    },
  };
}

/** Baixa a resolução do vídeo para a pré-visualização (mantém a foto no máximo). */
async function reduzirParaPrevia(track, maxima) {
  const atual = track.getSettings ? track.getSettings() : {};
  if (!maxima.largura || maxima.largura <= LARGURA_PREVIAO * 1.1) {
    return { largura: atual.width || maxima.largura, altura: atual.height || maxima.altura };
  }
  const proporcao = (maxima.altura || 3) / (maxima.largura || 4);
  try {
    await track.applyConstraints({
      width: { ideal: LARGURA_PREVIAO },
      height: { ideal: Math.round(LARGURA_PREVIAO * proporcao) },
    });
  } catch (_) { /* segue com a resolução que estiver */ }
  const s = track.getSettings ? track.getSettings() : {};
  return { largura: s.width || maxima.largura, altura: s.height || maxima.altura };
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

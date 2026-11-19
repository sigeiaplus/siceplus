/* SICEP+ · Geometria da moldura de enquadramento da câmera.
 *
 * A prévia usa object-fit: contain: quando a câmera entrega um quadro com proporção
 * diferente da tela, a imagem ocupa só uma faixa (com preto em cima e embaixo). A moldura
 * precisa ser calculada sobre ESSA faixa — antes ela era medida na tela inteira e metade
 * caía no preto, sem dar para encaixar os 4 cantos do cartão.
 *
 * Aqui a moldura é a maior possível dentro do espaço livre entre o que está visível no topo
 * (instrução, status, zoom) e a barra de botões, sempre centrada nesse espaço.
 */

export const PROPORCAO_CARTAO = 186 / 273;   // 0,681: largura / altura do cartão impresso
const MARGEM = 0.94;                         // fração do espaço livre que a moldura pode ocupar
const FOLGA = 8;                             // respiro entre a moldura e os controles (px)
const ESPACO_MINIMO = 170;                   // abaixo disso a moldura usa a imagem inteira

/**
 * Retângulo em que a moldura deve ser desenhada (centro em left/top, como no CSS).
 *
 * @param {object} p
 * @param {{left:number,top:number,width:number,height:number}} p.area  caixa do <video>
 * @param {{w:number,h:number}} p.video     quadro entregue pela câmera (videoWidth/Height)
 * @param {{left:number,top:number}|null} p.barra  barra de botões
 * @param {boolean} p.barraLateral   tela deitada: a barra fica na lateral direita
 * @param {number} p.topoPilha       bottom (px) do último aviso visível no topo
 * @param {'qr'|'cartao'} p.passo
 * @returns {{left:number, top:number, width:number, height:number}|null}
 */
export function calcularMoldura({ area, video, barra = null, barraLateral = false, topoPilha = 0, passo = 'cartao' }) {
  if (!area || !(area.width > 0) || !(area.height > 0)) return null;

  // 1) área realmente pintada pelo vídeo (desconta as faixas do contain)
  let x0 = area.left;
  let x1 = area.left + area.width;
  let y0 = area.top;
  let y1 = area.top + area.height;
  const vw = video && video.w;
  const vh = video && video.h;
  if (vw > 0 && vh > 0) {
    const k = Math.min(area.width / vw, area.height / vh);
    const dw = vw * k;
    const dh = vh * k;
    const cx = area.left + area.width / 2;
    const cy = area.top + area.height / 2;
    x0 = cx - dw / 2; x1 = cx + dw / 2;
    y0 = cy - dh / 2; y1 = cy + dh / 2;
  }

  // 2) onde a moldura pode ir: acima da barra de botões e abaixo do que está no topo
  let base = y1;
  if (barraLateral) {
    if (barra && barra.left > 0) x1 = Math.min(x1, barra.left - FOLGA);
  } else if (barra && barra.top > 0) {
    base = Math.min(y1, barra.top - FOLGA);
  }
  let topo = Math.max(y0, (topoPilha || 0) + FOLGA);

  // Pouco espaço livre (tela baixa, aviso comprido…): usa a imagem inteira, porque as 4 marcas
  // do cartão precisam caber — uma moldura de 2 cm não serve para ler nada.
  if (base - topo < ESPACO_MINIMO) { topo = y0; base = y1; }
  if (!(base > topo) || !(x1 > x0)) return null;

  // 3) a maior moldura com a proporção do cartão (ou quadrada, no passo do QR)
  const prop = passo === 'qr' ? 1 : PROPORCAO_CARTAO;
  const largura = Math.min((x1 - x0) * MARGEM, (base - topo) * MARGEM * prop);
  if (!(largura > 40)) return null;

  return {
    left: Math.round((x0 + x1) / 2),
    top: Math.round((topo + base) / 2),
    width: Math.round(largura),
    height: Math.round(largura / prop),
  };
}

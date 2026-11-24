/* ============================================================
   SICEP+ · Exportação do cartão (e do QR) em PDF ou PNG
   ------------------------------------------------------------
   Recebe o SVG que o cartao-svg.js já desenhou (a mesma fonte da impressão e da
   leitura) e o converte, sem biblioteca externa:

   · PDF  — VETORIAL: cada retângulo, bolinha, linha, caminho e texto do SVG vira
            operador de desenho do PDF. A página tem o tamanho exato do cartão
            (para inserir na prova) ou é uma A4 com o cartão em tamanho real.
   · PNG  — rasteriza o SVG num canvas (300 ou 600 dpi) e grava o DPI no arquivo
            (chunk pHYs), para o Word/Docs/Canva inserirem na medida certa em mm.

   Só entende os elementos que cartao-svg.js gera (svg, g sem transformação, rect,
   circle, line, path com M/L/H/V/Z, text). Não é um conversor de SVG genérico.
   ============================================================ */

const PT_POR_MM = 72 / 25.4;
const A4_MM = { largura: 210, altura: 297 };
const MARGEM_TOPO_A4_MM = 10;

/* ---------------- utilidades ---------------- */

/** Nome de arquivo seguro (sem acento, espaço ou símbolo). */
export function nomeArquivo(...partes) {
  return partes
    .filter(Boolean)
    .map((p) => String(p).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('_')
    .slice(0, 120) || 'cartao';
}

/** Dispara o download de um Blob. */
export function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ---------------- PNG ---------------- */

let tabelaCrc = null;
function crc32(bytes) {
  if (!tabelaCrc) {
    tabelaCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabelaCrc[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = tabelaCrc[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Grava o DPI num PNG (chunk pHYs logo depois do IHDR). Sem isso os editores
 * assumem 72 ou 96 dpi e inserem o cartão com o tamanho errado.
 * @param {Uint8Array} png
 * @param {number} dpi
 * @returns {Uint8Array}
 */
export function gravarDpiPng(png, dpi) {
  const assinatura = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (png[i] !== assinatura[i]) throw new Error('Arquivo não é um PNG.');
  const fimIHDR = 8 + 12 + 13;                         // assinatura + chunk IHDR (4+4+13+4)
  const ppm = Math.round(dpi / 0.0254);                // pixels por metro
  const chunk = new Uint8Array(21);                    // 4 tamanho + 4 tipo + 9 dados + 4 CRC
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);              // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1;                                       // unidade: metro
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // Remove um pHYs que já exista, para não duplicar.
  let corpo = png.subarray(fimIHDR);
  let ini = 0;
  const partes = [];
  const dvp = new DataView(corpo.buffer, corpo.byteOffset, corpo.byteLength);
  while (ini + 12 <= corpo.length) {
    const tam = dvp.getUint32(ini);
    const tipo = String.fromCharCode(corpo[ini + 4], corpo[ini + 5], corpo[ini + 6], corpo[ini + 7]);
    const total = 12 + tam;
    if (tipo !== 'pHYs') partes.push(corpo.subarray(ini, ini + total));
    ini += total;
  }
  const saida = new Uint8Array(fimIHDR + chunk.length + partes.reduce((a, p) => a + p.length, 0));
  saida.set(png.subarray(0, fimIHDR), 0);
  saida.set(chunk, fimIHDR);
  let pos = fimIHDR + chunk.length;
  for (const p of partes) { saida.set(p, pos); pos += p.length; }
  return saida;
}

/** Troca width/height (mm) do <svg> raiz por pixels, para o navegador rasterizar no tamanho certo. */
export function svgComPixels(svg, w, h) {
  return svg.replace(/<svg\b[^>]*>/, (tag) => tag
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace('<svg', `<svg width="${w}" height="${h}"`));
}

/**
 * SVG → PNG (Blob) na resolução pedida, com o DPI gravado no arquivo.
 * @param {string} svg
 * @param {{larguraMm:number, alturaMm:number, dpi?:number}} o
 */
export async function svgParaPng(svg, { larguraMm, alturaMm, dpi = 300 }) {
  const w = Math.round((larguraMm / 25.4) * dpi);
  const h = Math.round((alturaMm / 25.4) * dpi);
  const blobSvg = new Blob([svgComPixels(svg, w, h)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blobSvg);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((ok, erro) => {
      img.onload = ok;
      img.onerror = () => erro(new Error('Não foi possível desenhar o cartão para o PNG.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Este aparelho não conseguiu criar a imagem nessa resolução. Tente 300 dpi.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const png = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
    if (!png) throw new Error('Este aparelho não conseguiu gerar o PNG nessa resolução. Tente 300 dpi.');
    const bytes = new Uint8Array(await png.arrayBuffer());
    return new Blob([gravarDpiPng(bytes, dpi)], { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------------- PDF (vetorial) ---------------- */

const WIN_ANSI = { '…': 0x85, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '€': 0x80 };

/** Texto → string "latin1" escapada para dentro de ( ) do PDF (WinAnsi). */
export function textoPdf(t) {
  let s = '';
  for (const ch of String(t ?? '')) {
    let c = ch.codePointAt(0);
    if (WIN_ANSI[ch]) c = WIN_ANSI[ch];
    else if (c > 255) c = 0x3f;                        // fora do WinAnsi: "?"
    const x = String.fromCharCode(c);
    s += x === '\\' || x === '(' || x === ')' ? '\\' + x : x;
  }
  return s;
}

const num = (v) => (Math.abs(v) < 1e-9 ? '0' : (+v.toFixed(4)).toString());

function cor(valor, padrao) {
  const v = (valor ?? padrao ?? 'none').trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return null;
  let h = v.startsWith('#') ? v.slice(1) : null;
  if (h && h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!h || !/^[0-9a-f]{6}$/.test(h)) return null;
  const r = (i) => num(parseInt(h.slice(i, i + 2), 16) / 255);
  return `${r(0)} ${r(2)} ${r(4)}`;
}

/** Interpreta d="M x y h dx v dy H x V y L x y z" (o que o cartão usa) e devolve operadores de caminho. */
function caminho(d) {
  const toks = String(d).match(/[MmLlHhVvZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  let i = 0, cmd = null, x = 0, y = 0, x0 = 0, y0 = 0, out = '';
  const n = () => parseFloat(toks[i++]);
  const temNumero = () => i < toks.length && !/^[A-Za-z]$/.test(toks[i]);
  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++];
    switch (cmd) {
      case 'M': case 'm': {
        const a = n(), b = n();
        x = cmd === 'm' ? x + a : a; y = cmd === 'm' ? y + b : b; x0 = x; y0 = y;
        out += `${num(x)} ${num(y)} m `;
        cmd = cmd === 'm' ? 'l' : 'L';
        break;
      }
      case 'L': case 'l': {
        do {
          const a = n(), b = n();
          x = cmd === 'l' ? x + a : a; y = cmd === 'l' ? y + b : b;
          out += `${num(x)} ${num(y)} l `;
        } while (temNumero());
        break;
      }
      case 'H': case 'h': { do { const a = n(); x = cmd === 'h' ? x + a : a; out += `${num(x)} ${num(y)} l `; } while (temNumero()); break; }
      case 'V': case 'v': { do { const a = n(); y = cmd === 'v' ? y + a : a; out += `${num(x)} ${num(y)} l `; } while (temNumero()); break; }
      case 'Z': case 'z': out += 'h '; x = x0; y = y0; break;
      default: throw new Error(`Comando de caminho não suportado: ${cmd}`);
    }
  }
  return out;
}

function circulo(cx, cy, r) {
  const k = 0.5522847498 * r;
  return `${num(cx + r)} ${num(cy)} m `
    + `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c `
    + `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c `
    + `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c `
    + `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c h `;
}

/** Largura do texto em unidades do SVG (mm). Usa o canvas quando existe; senão, média de 0,55 em. */
function medirTexto(texto, tamanho, negrito) {
  try {
    const ctx = medirTexto.ctx || (medirTexto.ctx = document.createElement('canvas').getContext('2d'));
    ctx.font = `${negrito ? 'bold ' : ''}100px Helvetica, Arial, sans-serif`;
    return (ctx.measureText(texto).width / 100) * tamanho;
  } catch (_) {
    return texto.length * tamanho * 0.55;
  }
}

/** Converte os elementos do SVG em operadores de desenho (em mm, y para baixo). */
function desenhar(elementos, medir) {
  let c = '';
  for (const e of elementos) {
    const tag = e.tagName.toLowerCase();
    if (tag === 'g') { c += desenhar(e.children, medir); continue; }
    if (tag === 'text') { c += textoOp(e, medir); continue; }
    const preencher = cor(e.getAttribute('fill'), '#000');
    const tracar = cor(e.getAttribute('stroke'), 'none');
    let forma = '';
    if (tag === 'rect') {
      const x = +e.getAttribute('x') || 0, y = +e.getAttribute('y') || 0;
      forma = `${num(x)} ${num(y)} ${num(+e.getAttribute('width'))} ${num(+e.getAttribute('height'))} re `;
    } else if (tag === 'circle') {
      forma = circulo(+e.getAttribute('cx'), +e.getAttribute('cy'), +e.getAttribute('r'));
    } else if (tag === 'line') {
      forma = `${num(+e.getAttribute('x1'))} ${num(+e.getAttribute('y1'))} m ${num(+e.getAttribute('x2'))} ${num(+e.getAttribute('y2'))} l `;
    } else if (tag === 'path') {
      forma = caminho(e.getAttribute('d'));
    } else {
      continue;
    }
    // <line> nunca é preenchida; os demais seguem fill/stroke do elemento.
    const usaPreencher = tag !== 'line' && preencher;
    if (!usaPreencher && !tracar) continue;
    let op = '';
    if (usaPreencher) op += `${usaPreencher} rg `;
    if (tracar) {
      op += `${tracar} RG ${num(+e.getAttribute('stroke-width') || 1)} w `;
      const dash = (e.getAttribute('stroke-dasharray') || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
      op += dash.length ? `[${dash.map(num).join(' ')}] 0 d ` : '[] 0 d ';
    }
    const pinta = usaPreencher && tracar ? 'B' : usaPreencher ? 'f' : 'S';
    c += `q ${op}${forma}${pinta} Q\n`;
  }
  return c;
}

function textoOp(e, medir) {
  const texto = e.textContent;
  if (!texto) return '';
  const cr = cor(e.getAttribute('fill'), '#000');
  if (!cr) return '';
  const tamanho = +e.getAttribute('font-size') || 3;
  const peso = (e.getAttribute('font-weight') || '').toLowerCase();
  const negrito = peso === 'bold' || +peso >= 600;
  const esp = +e.getAttribute('letter-spacing') || 0;
  let x = +e.getAttribute('x') || 0;
  const y = +e.getAttribute('y') || 0;
  const largura = medir(texto, tamanho, negrito) + esp * [...texto].length;
  const ancora = e.getAttribute('text-anchor');
  if (ancora === 'middle') x -= largura / 2;
  else if (ancora === 'end') x -= largura;
  // O espaço de desenho tem y para baixo; a matriz de texto desfaz o espelhamento das letras.
  return `q ${cr} rg BT /${negrito ? 'F2' : 'F1'} ${num(tamanho)} Tf ${num(esp)} Tc 1 0 0 -1 ${num(x)} ${num(y)} Tm (${textoPdf(texto)}) Tj ET Q\n`;
}

/**
 * Monta o PDF (string "latin1": cada caractere é um byte) a partir do SVG.
 * @param {string} svg
 * @param {{larguraMm:number, alturaMm:number, pagina?:'exata'|'a4', titulo?:string,
 *          medir?:(texto:string,tamanho:number,negrito:boolean)=>number,
 *          parse?:(svg:string)=>Element}} o   `medir` e `parse` existem para testes fora do navegador
 */
export function svgParaPdfTexto(svg, { larguraMm, alturaMm, pagina = 'exata', titulo = 'Cartão de respostas', medir = medirTexto, parse = null }) {
  const raiz = parse ? parse(svg) : new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  if (!raiz || raiz.tagName.toLowerCase() !== 'svg') throw new Error('SVG inválido.');

  const a4 = pagina === 'a4';
  const pagLmm = a4 ? A4_MM.largura : larguraMm;
  const pagAmm = a4 ? A4_MM.altura : alturaMm;
  const offX = a4 ? (A4_MM.largura - larguraMm) / 2 : 0;
  const offY = a4 ? MARGEM_TOPO_A4_MM : 0;
  const pagL = pagLmm * PT_POR_MM, pagA = pagAmm * PT_POR_MM;

  // cm: mm → pt, com y invertido (origem do PDF é o canto inferior esquerdo).
  const cm = `${num(PT_POR_MM)} 0 0 ${num(-PT_POR_MM)} ${num(offX * PT_POR_MM)} ${num(pagA - offY * PT_POR_MM)} cm`;
  const conteudo = `${cm}\n${desenhar(raiz.children, medir)}`;

  const objetos = [];
  const add = (corpo) => { objetos.push(corpo); return objetos.length; };
  const catalogo = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pagL)} ${num(pagA)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`);
  add(`<< /Length ${conteudo.length} >>\nstream\n${conteudo}endstream`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const info = add(`<< /Title (${textoPdf(titulo)}) /Producer (SICEP+) >>`);

  let pdf = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
  const offs = [];
  objetos.forEach((corpo, i) => {
    offs.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root ${catalogo} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

/** SVG → PDF (Blob) vetorial. */
export function svgParaPdf(svg, opcoes) {
  const texto = svgParaPdfTexto(svg, opcoes);
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

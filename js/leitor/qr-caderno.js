/* ============================================================
   SICEP+ · Conteúdo do QR Code do cartão
   ------------------------------------------------------------
   O QR identifica o CADERNO (código da avaliação), a versão do caderno,
   a versão da geometria do cartão e o tamanho da grade (questões ×
   alternativas). É curto de propósito: um QR maior fica com módulos
   pequenos demais para a câmera do celular.

   Formato atual (v1 do payload):
     SICEP1|C:<código>|N:<caderno>|G:<geometria>|Q:<questões>|A:<alternativas>

   Cartões impressos antes deste formato trazem só o código no QR
   (por exemplo "SICEP-A"): são lidos como `legado` e validados apenas
   pelo código + conferência da grade.
   ============================================================ */

export const PREFIXO = 'SICEP1';

const limpar = (v) => String(v ?? '').trim().replace(/[|:]/g, '-');

/**
 * Monta o texto do QR.
 * @param {{codigo:string, caderno?:string, questoes?:number, alternativas?:number, geometria:number}} d
 */
export function montarPayload(d) {
  const campos = [
    `C:${limpar(d.codigo)}`,
    `N:${limpar(d.caderno || 'A')}`,
    `G:${Number(d.geometria) || 0}`,
    `Q:${Number(d.questoes) || 0}`,
    `A:${Number(d.alternativas) || 0}`,
  ];
  return [PREFIXO, ...campos].join('|');
}

/**
 * Interpreta o texto lido do QR.
 * @returns {{legado:boolean, codigo:string, caderno:string|null, geometria:number|null,
 *            questoes:number|null, alternativas:number|null, texto:string}}
 */
export function interpretarPayload(texto) {
  const t = String(texto || '').trim();
  const base = {
    legado: true, codigo: t, caderno: null, geometria: null,
    questoes: null, alternativas: null, texto: t,
  };
  if (!t || !t.startsWith(PREFIXO + '|')) return base;

  const campos = {};
  for (const parte of t.split('|').slice(1)) {
    const i = parte.indexOf(':');
    if (i < 1) continue;
    campos[parte.slice(0, i).trim().toUpperCase()] = parte.slice(i + 1).trim();
  }
  const numero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    legado: false,
    codigo: campos.C || '',
    caderno: campos.N || null,
    geometria: numero(campos.G),
    questoes: numero(campos.Q),
    alternativas: numero(campos.A),
    texto: t,
  };
}

/** Só o código do caderno contido no QR (funciona no formato novo e no antigo). */
export function codigoDoQR(texto) {
  return interpretarPayload(texto).codigo;
}

/** Texto curto para mostrar ao professor quando o QR não serve. */
export function resumoQR(texto) {
  const p = interpretarPayload(texto);
  if (!p.texto) return 'QR ilegível';
  if (p.legado) return p.texto;
  return [p.codigo, p.caderno ? `caderno ${p.caderno}` : null, p.geometria ? `layout v${p.geometria}` : null]
    .filter(Boolean).join(' · ') || p.texto;
}

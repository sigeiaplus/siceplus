/* ============================================================
   SICEP+ · Utilitários de interface
   ============================================================ */

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.firstElementChild;
}

export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content;
}

export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function go(hash) {
  if (location.hash === hash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

export function fmtData(iso) {
  if (!iso) return '—';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  if (!a || !m || !d) return iso;
  return `${d}/${m}/${a}`;
}

export function fmtNota(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (Number.isNaN(v)) return '—';
  // Até 10 casas: 0,25 continua 0,25 (nada de arredondar para 0,3).
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 10 });
}

export function iniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/);
  if (!partes[0]) return '?';
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (primeira + ultima).toUpperCase();
}

export function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

let toastTimer = null;
export function toast(msg, tipo = '') {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = msg;
  box.className = 'toast show ' + tipo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.className = 'toast ' + tipo; }, 3200);
}

/* ---------------- Ícones ---------------- */

const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.7V20h13V9.7"/><path d="M10 20v-5.5h4V20"/>',
  list: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  cards: '<path d="M6 9V4h12v5"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><rect x="6" y="17" width="12" height="3.5" rx="1"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/>',
  chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5M12.5 16V8M17 16v-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  check: '<path d="M4.5 12.5 9.5 17.5 20 6.5"/>',
  alert: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17.2h.01"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17.6 9.6 3.75 3.75 0 0 1 17 18H7Z"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.4 4-5 7-5s5.8 1.6 7 5"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><path d="M14 14h3v3h-3zM20.5 14v.01M14 20.5v.01M20.5 20.5v.01"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="7" rx="1.5"/><path d="M6 16h12v5H6z"/>',
  edit: '<path d="M4 20h4L18 10l-4-4L4 16v4Z"/><path d="M14.5 6.5 17.5 9.5"/>',
  trash: '<path d="M4 7h16"/><path d="M10 4h4"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10.5 11v6M13.5 11v6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.6 15.6 20 20"/>',
  school: '<path d="M3 9.5 12 4l9 5.5"/><path d="M5 10.5V20h14V10.5"/><path d="M10 20v-5h4v5"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v4.6h-4.6"/>',
  torch: '<path d="M9 3h6v4l-1 2v3H10V9L9 7V3Z"/><path d="M10 12h4v3.5l-2 5.5-2-5.5V12Z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c1-3.2 3.5-4.7 6.5-4.7s5.5 1.5 6.5 4.7"/><path d="M16 5.4a3.2 3.2 0 0 1 0 5.2M17.5 15.6c2 .6 3.3 2 4 4.4"/>',
  doc: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z"/><path d="M14 3v5h5"/>',
  logout: '<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8h.01"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  download: '<path d="M12 4v11"/><path d="M8 11.5 12 15.5l4-4"/><path d="M4.5 19.5h15"/>',
};

export function icon(nome, tamanho = 20) {
  const d = PATHS[nome] || PATHS.info;
  return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

/* ---------------- Componentes reutilizáveis ---------------- */

export function syncChip(estado) {
  return `<span class="sync ${estado.classe}" title="Sincronização na nuvem">
    <span class="dot"></span>${esc(estado.texto)}
  </span>`;
}

export function badge(texto, tipo = '') {
  return `<span class="badge ${tipo}">${esc(texto)}</span>`;
}

export function statusAvaliacao(status) {
  if (status === 'pronta') return badge('Pronta para aplicar', 'ok');
  if (status === 'rascunho') return badge('Rascunho', 'warn');
  return badge(status || '—');
}

export function statusResultado(status) {
  if (status === 'confirmado') return badge('Confirmado', 'ok');
  return badge('Revisão pendente', 'warn');
}

export function fmtDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* ---------------- Prazo, desempenho e situações ---------------- */

const FAIXAS = {
  verde: { cor: 'var(--ok)', bg: 'var(--ok-bg)', rotulo: 'Bom desempenho' },
  amarelo: { cor: 'var(--warn)', bg: 'var(--warn-bg)', rotulo: 'Atenção' },
  vermelho: { cor: 'var(--err)', bg: 'var(--err-bg)', rotulo: 'Abaixo do esperado' },
};

export function faixaVisual(faixa) {
  return FAIXAS[faixa] || FAIXAS.amarelo;
}

export function prazoChip(prazo) {
  if (!prazo) return '';
  const mapa = {
    ok: { classe: 'ok', prefixo: 'Corrigir até ' },
    hoje: { classe: 'warn', prefixo: 'Vence hoje · ' },
    atrasado: { classe: 'err', prefixo: 'Prazo vencido · ' },
    sem: { classe: '', prefixo: '' },
  };
  const m = mapa[prazo.status] || mapa.sem;
  return `<span class="badge ${m.classe}">${m.prefixo}${esc(prazo.texto)}</span>`;
}

const SITUACOES_BADGE = {
  normal: { rotulo: 'Corrigido', classe: 'ok' },
  ausente: { rotulo: 'Ausente', classe: 'err' },
  abstencao: { rotulo: 'Abstenção', classe: 'warn' },
  nao_entregue: { rotulo: 'Não entregue', classe: 'warn' },
  cartao_branco: { rotulo: 'Cartão em branco', classe: 'warn' },
  cartao_invalido: { rotulo: 'Cartão inválido', classe: 'err' },
};

export function situacaoBadge(situacao) {
  if (!situacao || situacao === 'normal') return '';
  const s = SITUACOES_BADGE[situacao] || SITUACOES_BADGE.normal;
  return `<span class="badge ${s.classe}">${esc(s.rotulo)}</span>`;
}

export function barraDesempenho(percentual, faixa) {
  const valor = Math.max(0, Math.min(100, Number(percentual) || 0));
  const f = faixaVisual(faixa);
  return `<div class="perf" role="img" aria-label="Desempenho ${valor}%">
    <span style="width:${valor}%;background:${f.cor}"></span>
  </div>`;
}

export function desempenhoTexto(percentual, faixa) {
  const f = faixaVisual(faixa);
  const valor = (Number(percentual) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return `<span class="badge" style="background:${f.bg};border-color:${f.cor}33;color:${f.cor}">
    ${valor}% · ${f.rotulo}
  </span>`;
}

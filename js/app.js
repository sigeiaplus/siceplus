/* ============================================================
   SICEP+ · Bootstrap, shell e roteador

   Dados 100% reais: sem sessão ou sem conexão a aplicação mostra o
   motivo, nunca preenche a tela com dados fictícios.
   ============================================================ */

import * as store from './store.js';
import { el, icon, syncChip, esc } from './ui.js';

import estadoScreen from './screens/estado.js';
import loginScreen from './screens/login.js';
import homeScreen from './screens/home.js';
import avaliacoesScreen from './screens/avaliacoes.js';
import novaAvaliacaoScreen from './screens/nova-avaliacao.js';
import avaliacaoDetalheScreen from './screens/avaliacao-detalhe.js';
import cartoesScreen from './screens/cartoes.js';
import leituraScreen from './screens/leitura.js';
import resultadosScreen from './screens/resultados.js';

const NAV = [
  { hash: '#/inicio', label: 'Início', icone: 'home' },
  { hash: '#/avaliacoes', label: 'Avaliações', icone: 'list' },
  { hash: '#/cartoes', label: 'Cartões', icone: 'cards' },
  { hash: '#/leitura', label: 'Leitura', icone: 'camera' },
  { hash: '#/resultados', label: 'Resultados', icone: 'chart' },
];

const ROTAS = [
  { re: /^#\/inicio$/, view: homeScreen, titulo: 'Início' },
  { re: /^#\/avaliacoes$/, view: avaliacoesScreen, titulo: 'Avaliações' },
  { re: /^#\/avaliacoes\/nova$/, view: novaAvaliacaoScreen, titulo: 'Nova avaliação' },
  { re: /^#\/avaliacoes\/editar\/([\w-]+)$/, view: novaAvaliacaoScreen, titulo: 'Editar avaliação' },
  { re: /^#\/avaliacoes\/([\w-]+)$/, view: avaliacaoDetalheScreen, titulo: 'Avaliação' },
  { re: /^#\/cartoes(?:\/([\w-]+))?$/, view: cartoesScreen, titulo: 'Cartões de respostas' },
  { re: /^#\/leitura$/, view: leituraScreen, titulo: 'Leitura de cartões' },
  { re: /^#\/resultados$/, view: resultadosScreen, titulo: 'Resultados' },
];

// #app é apenas um contêiner: a classe .app pertence ao shell montado por shell().
// Deixar a classe aqui criava um grid aninhado (coluna da sidenav) que espremia
// a tela de login e o próprio shell no desktop.
document.getElementById('app')?.classList.remove('app');

let limpezaAtual = null;

function resolver(hash) {
  for (const rota of ROTAS) {
    const m = hash.match(rota.re);
    if (m) return { rota, params: m.slice(1) };
  }
  return null;
}

function navLink(item, ativo, compacto) {
  return `<a class="nav-link ${ativo ? 'active' : ''}" href="${item.hash}" ${ativo ? 'aria-current="page"' : ''}>
    ${icon(item.icone, compacto ? 18 : 21)}
    <span>${esc(item.label)}</span>
  </a>`;
}

function shell(hash, conteudo, titulo) {
  const usuario = store.sessao();
  const estado = store.estadoSincronizacao();
  const raiz = (hash.split('/')[1] || '').toLowerCase();
  const ativo = (h) => h === '#/' + raiz;

  const app = el('<div class="app"></div>');

  const sidenav = el(`<aside class="sidenav">
    <div class="brand">
      <span class="mark"><img src="assets/icons/icon.svg" alt="" /></span>
      <span>
        <span class="brand-name">SICEP+</span>
        <span class="brand-sub">Correção de provas</span>
      </span>
    </div>
    <div class="nav-section">Menu</div>
    <nav class="nav-list" style="flex-direction:column;align-items:stretch" aria-label="Menu principal">
      ${NAV.map((i) => navLink(i, ativo(i.hash), true)).join('')}
    </nav>
    <div class="nav-foot">
      <div class="strong" style="color:var(--ink-2)">${esc(usuario?.escola || '')}</div>
      <div>SICEP+ · ${esc(usuario?.nome || '')}</div>
      <div class="nav-actions">
        ${syncChip(estado)}
        <button class="icon-btn" type="button" data-sair title="Sair" aria-label="Sair">
          ${icon('logout', 18)}
        </button>
      </div>
    </div>
  </aside>`);

  const main = el(`<div class="app-main">
    <header class="appbar">
      <div class="brand">
        <span class="mark"><img src="assets/icons/icon.svg" alt="" /></span>
        <span>
          <span class="brand-name">SICEP+</span>
          <span class="brand-sub">${esc(titulo || '')}</span>
        </span>
      </div>
      ${syncChip(estado)}
      <button class="icon-btn" type="button" data-sair title="Sair" aria-label="Sair">
        ${icon('logout', 18)}
      </button>
    </header>
    <main class="page" id="view"></main>
  </div>`);

  main.querySelector('#view').append(conteudo);

  const bottom = el(`<nav class="bottomnav" aria-label="Menu principal">
    ${NAV.map((i) => navLink(i, ativo(i.hash), false)).join('')}
  </nav>`);

  app.append(sidenav, main, bottom);

  app.querySelectorAll('[data-sair]').forEach((b) => b.addEventListener('click', () => store.sair()));

  return app;
}

function render() {
  if (typeof limpezaAtual === 'function') {
    try { limpezaAtual(); } catch (e) { console.warn(e); }
    limpezaAtual = null;
  }

  const hash = location.hash || '#/inicio';
  const alvo = resolver(hash);
  const app = document.getElementById('app');

  if (!alvo) { location.replace('#/inicio'); return; }

  const resultado = alvo.rota.view(alvo.params);
  const conteudo = resultado?.node || resultado;
  if (typeof resultado?.destroy === 'function') limpezaAtual = resultado.destroy;

  app.replaceChildren(shell(hash, conteudo, alvo.rota.titulo));
  document.title = 'SICEP+ · ' + (alvo.rota.titulo || 'Início');
  window.scrollTo({ top: 0 });
}

function montarApp() {
  if (!location.hash || !resolver(location.hash)) location.replace('#/inicio');
  render();
  window.addEventListener('hashchange', render);
}

function montarLogin() {
  const app = document.getElementById('app');
  app.replaceChildren(loginScreen({
    aoEntrar: async () => {
      const b = await store.iniciar();
      if (b.estado !== 'pronto') {
        app.replaceChildren(estadoScreen(b.estado, b.erro));
        return;
      }
      removerListener();
      montarApp();
    },
  }));
  document.title = 'SICEP+ · Entrar';
}

function removerListener() {
  window.removeEventListener('hashchange', render);
}

const boot = await store.iniciar();

if (boot.estado === 'sem-sessao') {
  montarLogin();
} else if (boot.estado !== 'pronto') {
  document.getElementById('app').replaceChildren(estadoScreen(boot.estado, boot.erro));
  document.title = 'SICEP+';
} else {
  montarApp();
}

/* Service worker (PWA) — apenas fora do ambiente local */
if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[SICEP+] SW', e));
  });
}

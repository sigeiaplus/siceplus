import { el } from '../ui.js';
import * as store from '../store.js';
import { CONFIG } from '../config.js';

const EYE_ON = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>'
  + '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>'
  + '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

// Máscara de CPF apenas quando o que foi digitado tem só números.
function mascararCpf(input) {
  const bruto = input.value;
  if (!/^[0-9.-]*$/.test(bruto)) return;
  let v = bruto.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  input.value = v;
}

/**
 * Login individual do SIGEIA AVALIAÇÕES com a MESMA credencial do SIGEIA+/SIDED+
 * (login, e-mail ou CPF + senha, tabela users). Nada de cadastro novo.
 */
export default function login({ aoEntrar } = {}) {
  const root = el(`
    <div class="login">
      <aside class="login-hero">
        <div class="login-hero-top">
          <span class="mark lg"><img src="assets/icons/icon.svg" alt="" /></span>
          <span class="login-hero-name">SIGEIA<span> AVALIAÇÕES</span></span>
        </div>

        <div class="login-hero-mid">
          <span class="login-eyebrow">Correção de provas</span>
          <h1>Do cartão<br/>à <em>nota fechada</em>.</h1>
          <p class="login-lead">
            Turma, aluno, cartão de respostas e resultado — na ordem certa,
            com a nota pronta para o diário.
          </p>
          <ul class="login-feats">
            <li>Gabarito oficial por avaliação</li>
            <li>Cartão A4 com identificação por QR</li>
            <li>Nota, acertos e percentual por aluno</li>
          </ul>
        </div>

        <div class="login-hero-foot">SIGEIA AVALIAÇÕES · integrado ao SIGEIA+/SIDED+</div>
      </aside>

      <main class="login-panel">
        <div class="login-card">
          <div class="login-brand-mobile">
            <span class="mark lg"><img src="assets/icons/icon.svg" alt="" /></span>
            <span class="login-hero-name">SIGEIA<span> AVALIAÇÕES</span></span>
          </div>

          <form class="login-form" data-form novalidate>
            <h2 class="login-title">Entrar</h2>
            <p class="login-sub">
              Use seu CPF, e-mail ou login do SIGEIA+ e a mesma senha.
            </p>

            <div class="alert err" data-erro hidden>
              <span data-erro-texto></span>
            </div>

            <div class="field">
              <label class="label" for="login-id">CPF, e-mail ou login</label>
              <input id="login-id" class="input" type="text" autocomplete="username"
                     autocapitalize="none" spellcheck="false"
                     placeholder="Digite seu acesso" data-login />
            </div>

            <div class="field">
              <label class="label" for="login-senha">Senha</label>
              <div class="input-eye">
                <input id="login-senha" class="input" type="password" autocomplete="current-password"
                       placeholder="••••••••" data-senha />
                <button class="input-eye-btn" type="button" data-olho aria-label="Mostrar ou ocultar senha">
                  <svg viewBox="0 0 24 24" data-olho-svg fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${EYE_ON}</svg>
                </button>
              </div>
            </div>

            <button class="btn btn-primary btn-block login-submit" type="submit" data-entrar>
              <span class="btn-spin" data-spin></span>
              <span data-rotulo>Entrar</span>
            </button>

            <p class="login-note">
              Sua conta é a mesma do SIGEIA+/SIDED+ — não existe senha própria do SIGEIA AVALIAÇÕES.
            </p>
          </form>

          <p class="login-foot">
            Problemas para entrar?
            <a href="${CONFIG.loginUrl}" target="_blank" rel="noopener">abrir sistema acadêmico</a>
          </p>
        </div>
      </main>
    </div>
  `);

  const form = root.querySelector('[data-form]');
  const campoLogin = root.querySelector('[data-login]');
  const campoSenha = root.querySelector('[data-senha]');
  const botao = root.querySelector('[data-entrar]');
  const rotulo = root.querySelector('[data-rotulo]');
  const caixaErro = root.querySelector('[data-erro]');
  const textoErro = root.querySelector('[data-erro-texto]');
  const olho = root.querySelector('[data-olho]');
  const olhoSvg = root.querySelector('[data-olho-svg]');

  const mostrarErro = (msg) => {
    textoErro.textContent = msg;
    caixaErro.hidden = false;
    caixaErro.classList.remove('shake');
    void caixaErro.offsetWidth;
    caixaErro.classList.add('shake');
  };
  const limparErro = () => { caixaErro.hidden = true; };

  campoLogin.addEventListener('input', () => mascararCpf(campoLogin));

  olho.addEventListener('click', () => {
    const mostrar = campoSenha.type === 'password';
    campoSenha.type = mostrar ? 'text' : 'password';
    olhoSvg.innerHTML = mostrar ? EYE_OFF : EYE_ON;
    campoSenha.focus();
  });

  let enviando = false;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (enviando) return;
    limparErro();

    const acesso = campoLogin.value.trim();
    const senha = campoSenha.value;
    if (!acesso || !senha) {
      mostrarErro('Preencha o acesso e a senha.');
      (acesso ? campoSenha : campoLogin).focus();
      return;
    }

    enviando = true;
    botao.disabled = true;
    botao.dataset.carregando = '1';
    rotulo.textContent = 'Entrando...';

    try {
      const r = await store.entrar(acesso, senha);
      if (!r.ok) {
        mostrarErro(r.erro);
        campoSenha.value = '';
        campoSenha.focus();
        return;
      }
      rotulo.textContent = 'Pronto';
      if (typeof aoEntrar === 'function') await aoEntrar();
    } catch (e) {
      console.error('[SIGEIA AVALIAÇÕES] login', e);
      mostrarErro('Erro inesperado ao entrar. Tente novamente.');
    } finally {
      enviando = false;
      botao.disabled = false;
      delete botao.dataset.carregando;
      rotulo.textContent = 'Entrar';
    }
  });

  setTimeout(() => campoLogin.focus(), 80);

  return root;
}

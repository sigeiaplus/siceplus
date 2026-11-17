import { el, icon } from '../ui.js';

const CONTEUDO = {
  'sem-config': {
    icone: 'alert',
    titulo: 'Integração não configurada',
    texto: 'Faltam a URL e a chave publishable do projeto Supabase em <span class="mono">js/config.js</span>. '
      + 'O SICEP+ não exibe dados até a conexão existir.',
    acao: null,
  },
  'sem-sessao': {
    icone: 'user',
    titulo: 'Sessão encerrada',
    texto: 'Entre com seu CPF, e-mail ou login do SIGEIA+ e a mesma senha.',
    acao: { rotulo: 'Entrar', retry: true },
  },
  erro: {
    icone: 'alert',
    titulo: 'Não foi possível carregar os dados',
    texto: 'A conexão com a nuvem falhou. Nenhum dado foi inventado para preencher a tela. '
      + 'Verifique a rede e tente novamente.',
    acao: { rotulo: 'Tentar novamente', retry: true },
  },
};

export default function estadoScreen(estado, detalhe) {
  const cfg = CONTEUDO[estado] || CONTEUDO.erro;

  const root = el(`
    <div class="login">
      <div class="login-card">
        <div class="login-brand">
          <span class="mark lg"><img src="assets/icons/icon.svg" alt="" /></span>
          <div>
            <h1>SICEP+</h1>
            <p class="small muted">Correção escolar de provas por cartão de respostas</p>
          </div>
        </div>

        <div class="card stack">
          <div class="row" style="gap:10px;align-items:flex-start">
            <span class="ei" style="width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:var(--warn-bg);color:var(--warn);flex:none">
              ${icon(cfg.icone, 18)}
            </span>
            <div>
              <h2>${cfg.titulo}</h2>
              <p class="small muted" style="margin-top:4px">${cfg.texto}</p>
            </div>
          </div>

          ${detalhe ? `<p class="xs mono" style="background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;overflow-wrap:anywhere">${detalhe}</p>` : ''}

          ${cfg.acao?.href ? `<a class="btn btn-primary btn-block" href="${cfg.acao.href}">${cfg.acao.rotulo}</a>` : ''}
          ${cfg.acao?.retry ? `<button class="btn btn-primary btn-block" type="button" data-retry>${cfg.acao.rotulo}</button>` : ''}
        </div>

        <p class="xs muted center" style="margin-top:14px">SICEP+ · integrado ao SIDED+</p>
      </div>
    </div>
  `);

  root.querySelector('[data-retry]')?.addEventListener('click', () => location.reload());

  return root;
}

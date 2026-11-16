/* ============================================================
   SICEP+ · Configuração de integração
   ------------------------------------------------------------
   Este arquivo fica SOMENTE no código-fonte. Nada aqui é exibido
   na interface: o usuário vê apenas "Sincronização na nuvem".

   Chave PUBLISHABLE (pública por definição, vai para o navegador).
   NUNCA coloque service_role no cliente.

   A sessão do usuário continua vindo do login existente do
   SIGEIA+/SIDED+ (sessionStorage ded_user / prof_data). O SICEP+
   não tem tela de login própria.
   ============================================================ */

export const CONFIG = {
  // Projeto "Banco de Dados: SIGEA+" (ref biocjxggjjfeqmpuysik)
  supabaseUrl: 'https://biocjxggjjfeqmpuysik.supabase.co',
  supabaseAnonKey: 'sb_publishable_hyRA-OEOFyp48wFdtkt5Rw_WrMXzKVX',

  // Origem do login existente
  loginUrl: 'https://sidedplus.vercel.app/',
};

export function configurado() {
  return Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
}

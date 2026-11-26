/* SICEP+ · Associação aluno ↔ caderno (QR) ↔ avaliação.
 * Lógica pura (sem DOM) para poder ser testada fora do navegador.
 */

import { interpretarPayload, resumoQR } from './qr-caderno.js';
import { GEOMETRIA_VERSAO } from './geometria.js';

export const codigoDe = (av) => String(av?.layout?.codigo_caderno || 'SICEP-A').trim();
/**
 * Prazo de correção encerrado? Só vale quando a avaliação tem prazo válido; sem prazo nunca vence.
 * Mesma regra de store.prazoDe (agora > fim), mas pura, para poder ser testada e usada aqui.
 * @returns {{vencido: boolean, fim: Date|null, texto: string}}
 */
export function prazoVencido(av, agora = new Date()) {
  if (!av?.prazo_correcao) return { vencido: false, fim: null, texto: '' };
  const fim = new Date(av.prazo_correcao);
  if (Number.isNaN(fim.getTime())) return { vencido: false, fim: null, texto: '' };
  const texto = fim.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return { vencido: agora > fim, fim, texto };
}

/** Mensagem única usada em todos os bloqueios por prazo vencido. */
export const mensagemPrazoVencido = (av, texto) =>
  `O prazo de correção de "${av?.titulo || 'esta avaliação'}" terminou em ${texto}. Não é possível corrigir avaliações com prazo vencido.`;

export const igual = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * O que o QR diz e que precisa bater com a avaliação escolhida.
 * Cartões no formato antigo não trazem esses dados: aí só o código vale.
 * @returns {string[]} lista de incompatibilidades (vazia = QR compatível)
 */
export function conflitosCartao(av, cartao) {
  if (!cartao || !av) return [];
  if (cartao.legado) return [];   // QR antigo: só o código identifica
  const n = Array.isArray(av.questoes) ? av.questoes.length : 0;
  const alts = Number(av.layout?.num_alternativas) || 5;
  const fora = [];
  if (cartao.geometria && cartao.geometria !== GEOMETRIA_VERSAO) {
    fora.push(`o cartão foi impresso com o layout v${cartao.geometria} (o atual é v${GEOMETRIA_VERSAO})`);
  }
  if (cartao.questoes && cartao.questoes !== n) {
    fora.push(`o cartão tem ${cartao.questoes} questões e a avaliação tem ${n}`);
  }
  if (cartao.alternativas && cartao.alternativas !== alts) {
    fora.push(`o cartão tem ${cartao.alternativas} alternativas e a avaliação tem ${alts}`);
  }
  return fora;
}

/**
 * Decide o que o QR lido significa.
 * @param {string} texto  conteúdo do QR
 * @param {{avaliacoesDaTurma: object[], fixa: object|null}} ctx  `fixa` = avaliação escolhida à mão na aba Instrumentos
 * @returns {{tipo: 'vazio'}|{tipo:'ok', avaliacao:object, cartao:object, conflitos:string[], lido:string}
 *          |{tipo:'escolha', candidatas:object[], cartao:object}
 *          |{tipo:'outra', lido:string, esperado:string, avaliacao:object}
 *          |{tipo:'vencida', avaliacao:object, prazo:string, lido:string}
 *          |{tipo:'nenhuma', lido:string}}
 * `tipo: 'vencida'`: o QR é de uma avaliação com prazo de correção encerrado. Nada prossegue.
 */
export function decidirQR(texto, { avaliacoesDaTurma, fixa, agora = new Date() }) {
  const p = interpretarPayload(texto);
  const t = p.codigo;
  if (!String(texto || '').trim() || !t) return { tipo: 'vazio' };

  if (fixa) {
    if (!igual(codigoDe(fixa), t)) {
      return { tipo: 'outra', lido: resumoQR(texto), esperado: codigoDe(fixa), avaliacao: fixa };
    }
    const pz = prazoVencido(fixa, agora);
    if (pz.vencido) return { tipo: 'vencida', avaliacao: fixa, prazo: pz.texto, lido: t };
    return { tipo: 'ok', avaliacao: fixa, cartao: p, conflitos: conflitosCartao(fixa, p), lido: t };
  }
  const todas = (avaliacoesDaTurma || []).filter((a) => igual(codigoDe(a), t));
  if (!todas.length) return { tipo: 'nenhuma', lido: resumoQR(texto) };
  // Avaliação com prazo vencido nunca é candidata: se não sobrar nenhuma aberta, bloqueia.
  const candidatas = todas.filter((a) => !prazoVencido(a, agora).vencido);
  if (!candidatas.length) {
    return { tipo: 'vencida', avaliacao: todas[0], prazo: prazoVencido(todas[0], agora).texto, lido: t };
  }
  if (candidatas.length > 1) return { tipo: 'escolha', candidatas, cartao: p };   // mesmo código em mais de uma avaliação: nunca adivinha
  return { tipo: 'ok', avaliacao: candidatas[0], cartao: p, conflitos: conflitosCartao(candidatas[0], p), lido: t };
}

/**
 * Valida a associação aluno ↔ turma ↔ avaliação antes de aceitar o QR e antes de lançar.
 * Barra: prazo de correção vencido, aluno fora da turma, avaliação não aplicada à turma, avaliação sem questões
 * e aluno que já tem resultado confirmado nessa avaliação (lançamento duplicado).
 * @param {object} store  precisa de alunosDaTurma, aplicacaoDe, resultadoDoAluno
 */
export function validarAssociacao(store, av, alunoId, turmaId, agora = new Date()) {
  if (!av) return { ok: false, motivo: 'Avaliação não identificada.' };
  const pz = prazoVencido(av, agora);
  if (pz.vencido) return { ok: false, motivo: mensagemPrazoVencido(av, pz.texto), prazoVencido: true };
  if (!alunoId || !turmaId) return { ok: false, motivo: 'Selecione o aluno antes de ler o caderno.' };
  if (!store.alunosDaTurma(turmaId).some((a) => a.id === alunoId)) {
    return { ok: false, motivo: 'Este aluno não pertence à turma selecionada.' };
  }
  if (!store.aplicacaoDe(av, turmaId)) {
    return { ok: false, motivo: `A avaliação "${av.titulo}" não está aplicada a esta turma.` };
  }
  if (!Array.isArray(av.questoes) || !av.questoes.length) {
    return { ok: false, motivo: `A avaliação "${av.titulo}" não tem questões cadastradas.` };
  }
  const existente = store.resultadoDoAluno(av.id, alunoId, turmaId);
  if (existente && existente.status === 'confirmado') {
    return { ok: false, motivo: `Este aluno já tem resultado confirmado em "${av.titulo}".` };
  }
  return { ok: true, motivo: '' };
}

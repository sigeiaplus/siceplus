/* SICEP+ · Associação aluno ↔ caderno (QR) ↔ avaliação.
 * Lógica pura (sem DOM) para poder ser testada fora do navegador.
 */

export const codigoDe = (av) => String(av?.layout?.codigo_caderno || 'SICEP-A').trim();
export const igual = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Decide o que o QR lido significa.
 * @param {string} texto  conteúdo do QR
 * @param {{avaliacoesDaTurma: object[], fixa: object|null}} ctx  `fixa` = avaliação escolhida à mão na aba Instrumentos
 * @returns {{tipo: 'vazio'}|{tipo:'ok', avaliacao:object}|{tipo:'escolha', candidatas:object[]}
 *          |{tipo:'outra', lido:string, esperado:string, avaliacao:object}|{tipo:'nenhuma', lido:string}}
 */
export function decidirQR(texto, { avaliacoesDaTurma, fixa }) {
  const t = String(texto || '').trim();
  if (!t) return { tipo: 'vazio' };

  if (fixa) {
    if (!igual(codigoDe(fixa), t)) return { tipo: 'outra', lido: t, esperado: codigoDe(fixa), avaliacao: fixa };
    return { tipo: 'ok', avaliacao: fixa };
  }
  const candidatas = (avaliacoesDaTurma || []).filter((a) => igual(codigoDe(a), t));
  if (!candidatas.length) return { tipo: 'nenhuma', lido: t };
  if (candidatas.length > 1) return { tipo: 'escolha', candidatas };   // mesmo código em mais de uma avaliação: nunca adivinha
  return { tipo: 'ok', avaliacao: candidatas[0] };
}

/**
 * Valida a associação aluno ↔ turma ↔ avaliação antes de aceitar o QR e antes de lançar.
 * Barra: aluno fora da turma, avaliação não aplicada à turma, avaliação sem questões
 * e aluno que já tem resultado confirmado nessa avaliação (lançamento duplicado).
 * @param {object} store  precisa de alunosDaTurma, aplicacaoDe, resultadoDoAluno
 */
export function validarAssociacao(store, av, alunoId, turmaId) {
  if (!av) return { ok: false, motivo: 'Avaliação não identificada.' };
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

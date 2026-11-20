// Gera (em /tmp/omr) o SVG e o layout JSON do cartão atual (v5) e do v4 antigo, com o MESMO
// código da impressão. Uso: node gerar-cartoes.mjs [questoes] [alternativas]
import fs from 'node:fs';
import { qrObjeto } from '../_ambiente.mjs';
import { montarCartaoSvg } from '../../js/leitor/cartao-svg.js';
import { montarCartaoSvg as montarV4 } from '../../js/leitor/legado/cartao-svg-v4.js';
import { montarPayload } from '../../js/leitor/qr-caderno.js';
import { GEOMETRIA_VERSAO, layoutCartao, FOLHA } from '../../js/leitor/geometria.js';
import { layoutCartao as layoutV4, GEOMETRIA_VERSAO as V4, FOLHA as FOLHA4 } from '../../js/leitor/legado/geometria-v4.js';

const n = Number(process.argv[2] || 50), alts = Number(process.argv[3] || 4);
const questoes = Array.from({ length: n }, (_, i) => ({ numero: i + 1 }));
const letras = ['A', 'B', 'C', 'D', 'E'].slice(0, alts);
const dados = { escola: 'Escola Municipal Exemplo', turma: '9º A', disciplina: 'Matemática', avaliacao: 'Avaliação Diagnóstica', data: '19/11/2026', caderno: 'A', codigo: 'SICEP-A' };
fs.mkdirSync('/tmp/omr', { recursive: true });

const p5 = montarPayload({ codigo: 'SICEP-A', caderno: 'A', questoes: n, alternativas: alts, geometria: GEOMETRIA_VERSAO });
fs.writeFileSync('/tmp/omr/v5.svg', montarCartaoSvg({ questoes, letras, ...dados, qr: qrObjeto(p5) }));
const L5 = layoutCartao(questoes, alts, letras);
fs.writeFileSync('/tmp/omr/v5.json', JSON.stringify({ folha: FOLHA, layout: L5 }));

const p4 = montarPayload({ codigo: 'SICEP-A', caderno: 'A', questoes: n, alternativas: alts, geometria: V4 });
fs.writeFileSync('/tmp/omr/v4.svg', montarV4({ questoes, letras, ...dados, qr: qrObjeto(p4) }));
const L4 = layoutV4(questoes, alts, letras);
fs.writeFileSync('/tmp/omr/v4.json', JSON.stringify({ folha: FOLHA4, layout: L4 }));
console.log(`v5 ${FOLHA.largura}x${FOLHA.altura} mm, ${L5.colunas} col x ${L5.linhas} lin, ${L5.bolhas.length} bolinhas, d=${L5.diametro.toFixed(2)} mm`);
console.log(`v4 ${FOLHA4.largura}x${FOLHA4.altura} mm, ${L4.colunas} col x ${L4.linhas} lin, d=${L4.diametro.toFixed(2)} mm`);

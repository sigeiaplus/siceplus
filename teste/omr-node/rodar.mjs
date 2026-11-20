// Roda o pipeline REAL (omr.js + OpenCV.js) sobre as fotos sintéticas de /tmp/omr/fotos.
// Uso: node rodar.mjs [filtro]   (testes SINTÉTICOS: não substituem cartão impresso + aparelho)
import fs from 'node:fs';
import { createRequire } from 'node:module';
const RAIZ = process.env.RAIZ || '../..';
const { processarCartao } = await import(`${RAIZ}/js/leitor/omr.js`);

const require = createRequire(import.meta.url);
let cv = require('../../js/lib/opencv.js');
if (cv instanceof Promise) cv = await cv; else if (typeof cv === 'function') cv = await cv(); else if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });

const DIR = process.env.DIR || '/tmp/omr/fotos';
const filtro = process.argv[2] || '';
const nomes = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f.includes(filtro)).map((f) => f.replace('.json', '')).sort();
const N = Number(process.env.N || 50), ALTS = Number(process.env.ALTS || 4);
const questoes = Array.from({ length: N }, (_, i) => ({ numero: i + 1 }));
let falhasCriticas = 0;
const linhas = [];

for (const nome of nomes) {
  const meta = JSON.parse(fs.readFileSync(`${DIR}/${nome}.json`, 'utf8'));
  const buf = fs.readFileSync(`${DIR}/${nome}.rgba`);
  const imagem = { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), width: meta.width, height: meta.height };
  const t0 = Date.now();
  const r = await processarCartao(cv, imagem, { questoes, numAlternativas: ALTS, codigoEsperado: 'SICEP-A' });
  const ms = Date.now() - t0;
  const esp = meta.respostas;
  let certas = 0, erradas = 0, conferir = 0, brancoOk = 0, brancoErrado = 0;
  const detalhe = [];
  if (!r.bloqueado) {
    for (const l of r.leituras) {
      const e = esp[String(l.numero)];
      const unica = e && e.length === 1 ? e : null;
      if (l.estado === 'ok') {
        if (unica === l.detectada) certas++;
        else if (!e) { brancoErrado++; detalhe.push(`Q${l.numero}: lida ${l.detectada} mas estava em branco`); }
        else { erradas++; detalhe.push(`Q${l.numero}: lida ${l.detectada}, esperado ${e}`); }
      } else if (l.estado === 'branco') {
        if (!e) brancoOk++; else if (!l.confere) detalhe.push(`Q${l.numero}: marcada ${e} lida como branco (sem conferir)`);
      }
      if (l.confere) conferir++;
    }
  }
  // CRÍTICO: nunca aceitar resposta errada (estado ok com alternativa diferente) nem inventar resposta.
  const critico = erradas + brancoErrado;
  falhasCriticas += critico;
  linhas.push({
    nome, bloqueado: r.bloqueado ? r.motivo : '-', ok: certas, erradas: critico, conferir, brancoOk, ms,
    grade: r.etapas?.grade?.razao ?? '-', qr: r.etapas?.qr?.ok ? 'sim' : 'nao', aviso: (r.aviso || []).join(',') || '-',
  });
  if (detalhe.length && critico) console.log(nome, detalhe.slice(0, 6));
  if (r.bloqueado && process.env.MSG) console.log('   ', nome, '→', r.mensagem);
}
console.table(linhas);
console.log(falhasCriticas === 0 ? 'RESPOSTAS ERRADAS ACEITAS: 0' : `ATENÇÃO: ${falhasCriticas} resposta(s) errada(s) aceita(s) como certa(s)`);

/* ============================================================
   SICEP+ · Testes SIMULADOS do offline (6E/6F) em Node

   Nada aqui é um teste físico: o "servidor" é o PostgREST em memória
   de nuvem-falsa.mjs, o IndexedDB é idb-min.mjs e a rede é simulada
   alternando navigator.onLine e injetando falhas.

   Rodar:  node teste/offline/rodar.mjs
   ============================================================ */

import fs from 'node:fs';
import { instalarIndexedDB } from './idb-min.mjs';
import { instalarNuvemFalsa } from './nuvem-falsa.mjs';

/* ---------------- Globais de navegador ---------------- */

const idb = instalarIndexedDB();
globalThis.indexedDB = idb.indexedDB;
globalThis.IDBKeyRange = idb.IDBKeyRange;

const nav = { onLine: true };
try {
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
} catch (e) {
  // Node pode expor navigator como getter: usa o objeto existente.
  try { Object.defineProperty(globalThis.navigator, 'onLine', { value: true, writable: true, configurable: true }); } catch (e2) { /* ignora */ }
}
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };

const sessao = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (sessao.has(k) ? sessao.get(k) : null),
  setItem: (k, v) => sessao.set(k, String(v)),
  removeItem: (k) => sessao.delete(k),
  clear: () => sessao.clear(),
};

const fake = instalarNuvemFalsa();

/* ---------------- Infra dos testes ---------------- */

let total = 0;
let passaram = 0;
const falhasDoTeste = [];

function ok(cond, msg) {
  total += 1;
  if (cond) { passaram += 1; console.log(`  ✓ ${msg}`); return; }
  falhasDoTeste.push(msg);
  console.log(`  ✗ FALHOU: ${msg}`);
}

function igual(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)})`); }

const storeUrl = new URL('../../js/store.js', import.meta.url).href;
let instancia = 0;
/** Importa uma instância NOVA do store: simula fechar e reabrir o aplicativo. */
function abrirApp() { instancia += 1; return import(`${storeUrl}?app=${instancia}`); }

function preparar() {
  instancia += 1;
  idb.reset();
  sessao.clear();
  sessao.set('ded_user', JSON.stringify({ id: 'u1', nome: 'Professor Teste', role: 'professor', escola_id: 'e1' }));
  sessao.set('prof_data', JSON.stringify({ id: 'p1', nome: 'Professor Teste', escola_id: 'e1' }));
  fake.reset({
    turmas: [{ id: 't1', nome: '1º A', ano: 2026, turno: 'Manhã', ano_serie: '1º ano' }],
    disciplinas: [{ id: 'd1', nome: 'Matemática' }],
    turma_disciplinas: [{ id: 'td1', turma_id: 't1', disciplina_id: 'd1', professor_id: 'p1' }],
    alunos: [
      { id: 'a1', nome_completo: 'Ana Silva', turma_id: 't1' },
      { id: 'a2', nome_completo: 'Bruno Souza', turma_id: 't1' },
    ],
    escolas: [{ id: 'e1', nome: 'Escola Teste' }],
  });
  nav.onLine = true;
}

function base(titulo, extras = {}) {
  return {
    codigo_caderno: 'T1',
    titulo,
    descricao: '',
    data_aplicacao: '2026-11-20',
    prazo_correcao: null,
    trimestre: 1,
    valor_total: 10,
    num_alternativas: 5,
    lancar_sided: true,
    faixas: { verde: 80, amarelo: 60 },
    questoes: [
      { numero: 1, enunciado: 'Q1', valor: 3, gabarito: 'A', anulada: false },
      { numero: 2, enunciado: 'Q2', valor: 3, gabarito: 'B', anulada: false },
      { numero: 3, enunciado: 'Q3', valor: 4, gabarito: 'C', anulada: false },
    ],
    aplicacoes: [{ turma_id: 't1', turma_disciplina_id: 'td1', disciplina_id: 'd1', professor_id: 'p1' }],
    disciplina: 'Matemática',
    ...extras,
  };
}

const questoesDe = (id) => fake.tabelas.sicep_questoes.filter((q) => q.avaliacao_id === id);
const avaliacoesDe = (id) => fake.tabelas.sicep_avaliacoes.filter((a) => a.id === id);

function semQuestoesDuplicadas() {
  const chaves = new Set();
  for (const q of fake.tabelas.sicep_questoes) {
    const k = `${q.avaliacao_id}|${q.numero}`;
    ok(!chaves.has(k), `questão não duplicada (${k})`);
    chaves.add(k);
  }
}

async function filaDoUsuario(store) {
  const db = await import('../../js/offline/db.js');
  return db.filaListar('u1');
}

/* ---------------- Cenários ---------------- */

async function cenarioCriacaoEdicaoOfflineEConflito() {
  console.log('\n1-9. Criar offline, reabrir, editar offline, conflito e resolver mantendo a versão local');
  preparar();
  let store = await abrirApp();
  let r = await store.iniciar();
  igual(r.estado, 'pronto', 'abre online');

  const id1 = await store.salvarAvaliacao(base('Prova 1'));
  ok(avaliacoesDe(id1).length === 1, 'avaliação criada online uma única vez');
  igual(questoesDe(id1).length, 3, 'questões criadas online');
  ok(!store.avaliacaoPendente(store.avaliacao(id1)), 'avaliação online sem pendência');

  // Modo avião.
  nav.onLine = false;
  const id2 = await store.salvarAvaliacao(base('Prova offline'));
  ok(store.avaliacao(id2)?.sync === 'pendente', 'criação offline fica pendente');
  ok(avaliacoesDe(id2).length === 0, 'criação offline não vai à nuvem');
  let fila = await filaDoUsuario(store);
  igual(fila.filter((i) => i.avaliacao_id === id2 && (i.tipo === 'avaliacao' || i.tipo === 'questoes')).length, 2, 'dois itens na fila (avaliação + questões)');
  ok(store.estadoSincronizacao().texto.includes('Offline'), 'indicador mostra Offline');

  // Fechar e reabrir em modo avião: nova instância do módulo, cache + fila do IndexedDB.
  store = await abrirApp();
  r = await store.iniciar();
  igual(r.origem, 'cache', 'reabre sem internet pela cópia local');
  const depoisDeReabrir = store.avaliacao(id2);
  ok(Boolean(depoisDeReabrir), 'avaliação criada offline continua na lista após reabrir');
  igual(depoisDeReabrir?.questoes.length, 3, 'questões da criação offline preservadas após reabrir');
  ok(store.avaliacaoPendente(depoisDeReabrir), 'avaliação continua pendente após reabrir');

  // Editar offline uma avaliação já sincronizada (título, enunciado e gabarito).
  const alterada = base('Prova 1 editada');
  alterada.questoes[1] = { ...alterada.questoes[1], gabarito: 'D', enunciado: 'Q2 editada' };
  await store.salvarAvaliacao({ ...alterada, id: id1 });
  const av1 = store.avaliacao(id1);
  igual(av1?.titulo, 'Prova 1 editada', 'edição offline aparece imediatamente');
  igual(av1?.questoes[1]?.gabarito, 'D', 'gabarito editado offline preservado');
  ok(av1?.sync === 'pendente', 'edição entrou na fila');
  igual(avaliacoesDe(id1)[0]?.titulo, 'Prova 1', 'nuvem não é tocada enquanto offline');
  fila = await filaDoUsuario(store);
  igual(fila.filter((i) => i.tipo === 'edicao' && i.avaliacao_id === id1).length, 1, 'uma única edição na fila');

  // Alteração concorrente no servidor (outro aparelho).
  fake.tabelas.sicep_avaliacoes.find((a) => a.id === id1).titulo = 'Alterada na nuvem';

  nav.onLine = true;
  await store.sincronizarFila();
  ok(store.avaliacao(id1)?.sync === 'conflito', 'conflito de versões detectado');
  igual(avaliacoesDe(id1)[0]?.titulo, 'Alterada na nuvem', 'nuvem NÃO foi sobrescrita em silêncio');
  igual(store.avaliacao(id1)?.titulo, 'Prova 1 editada', 'versão local preservada');
  ok(store.estadoSincronizacao().texto.toLowerCase().includes('conflito'), 'indicador mostra conflito');
  const itemConflito = (await filaDoUsuario(store)).find((i) => i.status === 'conflito');
  ok(Boolean(itemConflito?.conflito?.servidor), 'versão do servidor guardada junto do conflito');

  // Decisão: manter a versão local.
  const resolvido = await store.resolverConflitoDaAvaliacao(id1, 'local');
  ok(resolvido.ok, 'conflito resolvido mantendo a versão local');
  igual(avaliacoesDe(id1)[0]?.titulo, 'Prova 1 editada', 'versão local enviada à nuvem');
  igual(questoesDe(id1).find((q) => Number(q.numero) === 2)?.gabarito, 'D', 'gabarito local chegou à nuvem');
  igual(questoesDe(id1).length, 3, 'questões preservadas sem recriar');

  await store.sincronizarFila();
  igual(avaliacoesDe(id2).length, 1, 'criação offline enviada uma única vez');
  igual(questoesDe(id2).length, 3, 'questões da criação offline enviadas');

  // Depois de sincronizada, a avaliação que nasceu offline volta a ser editável (sem "só local").
  nav.onLine = false;
  await store.salvarAvaliacao({ ...base('Prova offline editada'), id: id2 });
  igual(store.avaliacao(id2)?.titulo, 'Prova offline editada', 'avaliação criada offline pode ser editada após sincronizar');
  nav.onLine = true;
  await store.sincronizarFila();
  igual(avaliacoesDe(id2)[0]?.titulo, 'Prova offline editada', 'edição posterior chegou à nuvem');
  semQuestoesDuplicadas();
}

async function cenarioConflitoMantendoNuvem() {
  console.log('\n7-8b. Conflito resolvido mantendo a versão da nuvem');
  preparar();
  const store = await abrirApp();
  await store.iniciar();
  const id = await store.salvarAvaliacao(base('Original'));

  nav.onLine = false;
  await store.salvarAvaliacao({ ...base('Minha edição local'), id });
  fake.tabelas.sicep_avaliacoes.find((a) => a.id === id).titulo = 'Versão da nuvem';

  nav.onLine = true;
  await store.sincronizarFila();
  ok(store.avaliacao(id)?.sync === 'conflito', 'conflito detectado');

  const r = await store.resolverConflitoDaAvaliacao(id, 'nuvem');
  ok(r.ok, 'conflito resolvido mantendo a nuvem');
  igual(avaliacoesDe(id)[0]?.titulo, 'Versão da nuvem', 'nuvem permanece intacta');
  igual(store.avaliacao(id)?.titulo, 'Versão da nuvem', 'tela voltou para a versão da nuvem');
  igual(questoesDe(id).length, 3, 'questões da nuvem preservadas');
  semQuestoesDuplicadas();
}

async function cenarioFalhaParcial() {
  console.log('\n6. Avaliação criada, questões recusadas: retomar sem recriar');
  preparar();
  const store = await abrirApp();
  await store.iniciar();

  nav.onLine = false;
  const id = await store.salvarAvaliacao(base('Parcial'));
  nav.onLine = true;
  fake.falhar({ metodo: 'POST', tabela: 'sicep_questoes', restantes: 1, tipo: 'antes', status: 400 });

  await store.sincronizarFila();
  igual(avaliacoesDe(id).length, 1, 'avaliação gravada na primeira etapa');
  igual(questoesDe(id).length, 0, 'questões recusadas na primeira tentativa');
  let fila = await filaDoUsuario(store);
  igual(fila.find((i) => i.tipo === 'avaliacao')?.status, 'sincronizado', 'item da avaliação confirmado');
  ok(fila.find((i) => i.tipo === 'questoes')?.status === 'erro', 'item das questões ficou com erro');
  ok(!store.avaliacaoPendente(store.avaliacao(id)) === false, 'avaliação NÃO é considerada sincronizada com questões pendentes');
  ok(store.estadoSincronizacao().texto.includes('erro'), 'indicador mostra erro');

  await store.tentarSincronizarAgora();
  igual(avaliacoesDe(id).length, 1, 'avaliação NÃO foi recriada ao retomar');
  igual(questoesDe(id).length, 3, 'questões completadas na nova tentativa');
  ok(!store.avaliacaoPendente(store.avaliacao(id)), 'avaliação sincronizada só depois das questões');
  semQuestoesDuplicadas();
}

async function cenarioRespostaPerdida() {
  console.log('\n9. Resposta perdida: nova tentativa sem duplicar');
  preparar();
  const store = await abrirApp();
  await store.iniciar();

  nav.onLine = false;
  const id = await store.salvarAvaliacao(base('Resposta perdida'));
  nav.onLine = true;
  fake.falhar({ metodo: 'POST', tabela: 'sicep_avaliacoes', restantes: 1, tipo: 'depois' });

  await store.sincronizarFila();
  igual(avaliacoesDe(id).length, 1, 'a gravação aconteceu apesar da resposta perdida');
  let fila = await filaDoUsuario(store);
  const item = fila.find((i) => i.tipo === 'avaliacao');
  ok(item?.status === 'erro' && !item?.permanente, 'falha de rede ficou como transitória (nova tentativa automática)');

  await store.tentarSincronizarAgora();
  igual(avaliacoesDe(id).length, 1, 'repetição não criou segunda avaliação');
  igual(questoesDe(id).length, 3, 'questões enviadas depois');
  semQuestoesDuplicadas();
}

async function cenarioRecusaPreservaResultados() {
  console.log('\n6b. Recusa da avaliação não descarta resultados nem dados pendentes');
  preparar();
  const store = await abrirApp();
  await store.iniciar();

  nav.onLine = false;
  const id = await store.salvarAvaliacao(base('Recusada'));
  const av = store.avaliacao(id);
  const salvo = await store.salvarResultado({
    avaliacao: av, aplicacao: av.aplicacoes[0], alunoId: 'a1',
    respostas: { 1: 'A', 2: 'B', 3: 'C' }, situacao: 'normal', revisado: true,
  });
  ok(salvo.ok && salvo.pendente, 'resultado salvo offline');

  nav.onLine = true;
  fake.falhar({ metodo: 'POST', tabela: 'sicep_avaliacoes', restantes: 99, tipo: 'antes', status: 400 });
  await store.sincronizarFila();

  ok(Boolean(store.avaliacao(id)), 'avaliação continua guardada após a recusa');
  igual(store.avaliacao(id)?.sync, 'erro', 'recusa visível no estado da avaliação');
  const fila = await filaDoUsuario(store);
  ok(fila.some((i) => i.tipo === 'resultado' && i.status !== 'sincronizado'), 'resultado pendente NÃO foi descartado');
  igual(questoesDe(id).length, 0, 'nada foi gravado na nuvem');

  const linhas = await store.itensDaFila();
  ok(linhas.some((l) => l.tipo === 'avaliacao'), 'fila mostra a avaliação recusada');
  ok(linhas.some((l) => l.tipo === 'resultado'), 'fila mostra o resultado pendente');
}

async function cenarioSided() {
  console.log('\n10-11. Online normal e envio manual ao SIDED+ preservado');
  preparar();
  const store = await abrirApp();
  await store.iniciar();

  const id = await store.salvarAvaliacao(base('Com notas'));
  const av = store.avaliacao(id);
  const salvo = await store.salvarResultado({
    avaliacao: av, aplicacao: av.aplicacoes[0], alunoId: 'a1',
    respostas: { 1: 'A', 2: 'B', 3: 'C' }, situacao: 'normal', revisado: true,
  });
  ok(salvo.ok, 'resultado gravado online');
  const conf = await store.confirmarResultado(salvo.resultado.id);
  ok(conf.ok, 'resultado confirmado');

  const envio = await store.enviarAoSided(id, 't1');
  ok(envio.ok && envio.enviados === 1, 'envio manual ao SIDED+ funciona');
  igual(fake.tabelas.notas.length, 1, 'uma nota no SIDED+');
  igual(Number(fake.tabelas.notas[0]?.nota), 10, 'nota enviada correta');

  // Edição offline depois do envio: trimestre travado e questões preservadas.
  nav.onLine = false;
  const reduzida = base('Com notas editada');
  reduzida.questoes = reduzida.questoes.slice(0, 2);
  await store.salvarAvaliacao({ ...reduzida, id, trimestre: 2 });
  nav.onLine = true;
  await store.sincronizarFila();

  const noServidor = avaliacoesDe(id)[0];
  igual(Number(noServidor?.trimestre), 1, 'trimestre não muda depois do envio ao SIDED+');
  igual(questoesDe(id).length, 3, 'nenhuma questão é apagada depois do envio (vínculos preservados)');
  igual(fake.tabelas.notas.length, 1, 'nota já enviada não é alterada nem duplicada');
  igual(Number(fake.tabelas.notas[0]?.nota), 10, 'valor da nota enviada permanece');
  semQuestoesDuplicadas();
}

async function cenarioServiceWorker() {
  console.log('\n12. Cache e atualização do Service Worker');
  const txt = fs.readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  ok(/sicep-v25/.test(txt), 'cache do app avançou para v25');
  ok(txt.includes("./js/offline/fila.js") && txt.includes("./js/offline/db.js"), 'fila e banco offline no app shell');
  ok(txt.includes("./js/screens/fila-painel.js"), 'painel da fila no app shell');
  ok(/network|cache: 'reload'|fetch\(req\)/.test(txt), 'estratégia de atualização presente');
}

/* ---------------- Execução ---------------- */

async function cenarioHabilidades() {
  console.log('\n13-20. Habilidades do planejamento: carga, trimestre, múltipla, gravação e preservação');
  preparar();
  fake.reset({
    turmas: [
      { id: 't1', nome: '1º A', ano: 2026, turno: 'Manhã', ano_serie: '1º ano' },
      { id: 't2', nome: '2º B', ano: 2026, turno: 'Tarde', ano_serie: '2º ano' },
    ],
    disciplinas: [{ id: 'd1', nome: 'Matemática' }],
    turma_disciplinas: [
      { id: 'td1', turma_id: 't1', disciplina_id: 'd1', professor_id: 'p1' },
      { id: 'td2', turma_id: 't2', disciplina_id: 'd1', professor_id: 'p1' },
    ],
    alunos: [],
    escolas: [{ id: 'e1', nome: 'Escola Teste' }],
    divisoes: [
      { id: 'div1', nome: '1º TRIMESTRE', ordem: 1, tipo: 'Trimestral' },
      { id: 'div2', nome: '2º TRIMESTRE', ordem: 2, tipo: 'Trimestral' },
    ],
    parametro_divisoes: [
      { id: 'pd1', divisao_id: 'div1', ordem_divisao: 1, parametro_id: 'par1' },
      { id: 'pd2', divisao_id: 'div2', ordem_divisao: 2, parametro_id: 'par1' },
    ],
    habilidades_planejamento: [
      { id: 'h1', turma_disciplina_id: 'td1', codigo: 'EF06MA01', descricao: 'Frações', temas: ['Números'], divisao_id: 'div1' },
      { id: 'h2', turma_disciplina_id: 'td1', codigo: 'EF06MA03', descricao: 'Porcentagem', temas: ['Números'], divisao_id: 'div1' },
      { id: 'h3', turma_disciplina_id: 'td1', codigo: 'EF06MA10', descricao: 'Geometria', temas: ['Geometria'], divisao_id: 'div2' },
      { id: 'h4', turma_disciplina_id: 'td2', codigo: 'EF06MA01', descricao: 'Frações', temas: ['Números'], divisao_id: 'div1' },
      { id: 'h5', turma_disciplina_id: 'td2', codigo: 'EF06MA20', descricao: 'Álgebra na turma 2', temas: ['Álgebra'], divisao_id: 'div1' },
    ],
  });
  nav.onLine = true;

  const store = await abrirApp();
  let r = await store.iniciar();
  igual(r.estado, 'pronto', 'abre online com habilidades');
  igual(store.habilidades().length, 5, 'carrega as habilidades dos dois vínculos');
  ok(store.tem('habilidades'), 'recurso de habilidades disponível');
  igual(store.erroDeHabilidades(), null, 'sem erro de leitura de habilidades');

  igual(store.habilidadesDoContexto(['td1'], 1).map((h) => h.codigo), ['EF06MA01', 'EF06MA03'], 'filtra por vínculo e 1º trimestre (ordem_divisao)');
  igual(store.habilidadesDoContexto(['td1'], 2).map((h) => h.codigo), ['EF06MA10'], 'filtra o 2º trimestre pela ordem_divisao');
  igual(store.habilidadesDoContexto(['td1'], null).map((h) => h.codigo), ['EF06MA01', 'EF06MA03', 'EF06MA10'], 'sem trimestre mostra todas do vínculo');

  const multi = store.habilidadesDoContexto(['td1', 'td2'], 1);
  igual(multi.map((h) => h.codigo), ['EF06MA01', 'EF06MA03', 'EF06MA20'], 'várias turmas usam a união das habilidades');
  igual(multi.find((h) => h.codigo === 'EF06MA01')?.vinculos.sort(), ['td1', 'td2'], 'código comum guarda os dois contextos');

  const dados = base('Com habilidades');
  dados.aplicacoes = [
    { turma_id: 't1', turma_disciplina_id: 'td1', disciplina_id: 'd1', professor_id: 'p1' },
    { turma_id: 't2', turma_disciplina_id: 'td2', disciplina_id: 'd1', professor_id: 'p1' },
  ];
  dados.questoes[0] = { ...dados.questoes[0], habilidade_bncc: 'EF06MA01,EF06MA03' };
  dados.questoes[1] = { ...dados.questoes[1], habilidade_bncc: 'EF06MA20' };
  dados.questoes[2] = { ...dados.questoes[2], habilidade_bncc: null };

  const id = await store.salvarAvaliacao(dados);
  igual(questoesDe(id).find((q) => Number(q.numero) === 1)?.habilidade_bncc, 'EF06MA01,EF06MA03', 'grava vários códigos separados por vírgula');
  igual(questoesDe(id).find((q) => Number(q.numero) === 2)?.habilidade_bncc, 'EF06MA20', 'grava a habilidade da questão 2');
  igual(questoesDe(id).find((q) => Number(q.numero) === 3)?.habilidade_bncc ?? null, null, 'questão sem habilidade fica sem vínculo');
  igual(store.avaliacao(id)?.questoes.find((q) => q.numero === 1)?.habilidade_bncc, 'EF06MA01,EF06MA03', 'cópia local também guarda as habilidades');

  const store2 = await abrirApp();
  await store2.iniciar();
  igual(store2.avaliacao(id)?.questoes.find((q) => q.numero === 1)?.habilidade_bncc, 'EF06MA01,EF06MA03', 'reabrir a avaliação reconstrói as seleções');

  const ed = base('Com habilidades editada');
  ed.aplicacoes = dados.aplicacoes;
  ed.questoes[0] = { ...ed.questoes[0], habilidade_bncc: 'EF06MA01' };
  ed.questoes[1] = { ...ed.questoes[1], habilidade_bncc: 'EF06MA03,EF06MA20' };
  await store2.salvarAvaliacao({ ...ed, id });
  igual(questoesDe(id).find((q) => Number(q.numero) === 1)?.habilidade_bncc, 'EF06MA01', 'edição atualiza a seleção (removeu uma)');
  igual(questoesDe(id).find((q) => Number(q.numero) === 2)?.habilidade_bncc, 'EF06MA03,EF06MA20', 'edição grava a nova seleção múltipla');
  igual(questoesDe(id).length, 3, 'questões não são recriadas ao editar habilidades');
  semQuestoesDuplicadas();

  // Falha de leitura (RLS) ao reabrir: lista anterior continua no cache e a tela é avisada.
  fake.falhar({ metodo: 'GET', tabela: 'habilidades_planejamento', restantes: 2, tipo: 'antes', status: 403 });
  const store3 = await abrirApp();
  const r3 = await store3.iniciar();
  igual(r3.estado, 'pronto', 'app abre mesmo com falha de RLS nas habilidades');
  ok(Boolean(store3.erroDeHabilidades()), 'falha de leitura fica visível para a tela');
  ok(store3.habilidades().length > 0, 'não apaga as habilidades já carregadas (cópia local)');

  // Edição sem a propriedade habilidade_bncc (ex.: cache antigo) preserva o que está na nuvem.
  const store4 = await abrirApp();
  await store4.iniciar();
  const semHab = base('Sem tocar em habilidades');
  semHab.aplicacoes = dados.aplicacoes;
  semHab.questoes = [
    { numero: 1, enunciado: 'Q1', valor: 3, gabarito: 'A' },
    { numero: 2, enunciado: 'Q2', valor: 3, gabarito: 'B' },
    { numero: 3, enunciado: 'Q3', valor: 4, gabarito: 'C' },
  ];
  await store4.salvarAvaliacao({ ...semHab, id });
  igual(questoesDe(id).find((q) => Number(q.numero) === 1)?.habilidade_bncc, 'EF06MA01', 'entrada sem a propriedade não apaga a habilidade');
  igual(questoesDe(id).find((q) => Number(q.numero) === 2)?.habilidade_bncc, 'EF06MA03,EF06MA20', 'questão 2 mantém a seleção');
}

const cenarios = [
  cenarioCriacaoEdicaoOfflineEConflito,
  cenarioConflitoMantendoNuvem,
  cenarioFalhaParcial,
  cenarioRespostaPerdida,
  cenarioRecusaPreservaResultados,
  cenarioSided,
  cenarioServiceWorker,
  cenarioHabilidades,
];

for (const cenario of cenarios) {
  try {
    await cenario();
  } catch (e) {
    falhasDoTeste.push(`${cenario.name}: ${e?.stack || e}`);
    console.log(`  ✗ ERRO no cenário ${cenario.name}: ${e?.message || e}`);
  }
}

console.log(`\nRESULTADO: ${passaram}/${total} verificações passaram.`);
if (falhasDoTeste.length) {
  console.log('FALHAS:');
  falhasDoTeste.forEach((f) => console.log(' - ' + f));
  process.exitCode = 1;
} else {
  console.log('Todos os cenários simulados passaram.');
}

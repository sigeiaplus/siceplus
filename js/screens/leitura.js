import * as store from '../store.js';
import {
  el, esc, icon, toast, fmtNota, badge, situacaoBadge,
  barraDesempenho, desempenhoTexto,
} from '../ui.js';

let stream = null;
let tocha = false;

function pararCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  tocha = false;
}

const ETAPAS = {
  turma: '1 de 4 · Turma',
  aluno: '2 de 4 · Aluno',
  cartao: '3 de 4 · Cartão',
  conferencia: '4 de 4 · Correção',
  resultado: 'Resultado',
};

const SITUACOES_SEM_CARTAO = ['ausente', 'abstencao', 'nao_entregue', 'cartao_branco'];

export default function leitura(params) {
  pararCamera();

  const root = el('<div class="stack"></div>');
  const st = {
    etapa: 'turma',
    perfil: null,
    aba: 'estudantes',
    busca: '',
    turmaId: null,
    alunoId: null,
    avaliacaoId: params?.[0] || null,
    codigo: '',
    leituras: null,
    imagem: null,
    camOn: false,
    ativa: null,
    resultado: null,
  };

  const cam = el(`
    <div class="cam" data-cam hidden>
      <video playsinline muted autoplay aria-label="Imagem da câmera"></video>
      <img data-img alt="Cartão capturado" hidden />
      <div class="cam-empty" data-cam-empty>
        ${icon('camera', 26)}
        <span>Câmera desligada</span>
      </div>
      <div class="guide" data-guide hidden></div>
      <span class="corner tl" data-guide hidden></span>
      <span class="corner tr" data-guide hidden></span>
      <span class="corner bl" data-guide hidden></span>
      <span class="corner br" data-guide hidden></span>
      <button class="torch" type="button" data-torch hidden title="Lanterna">${icon('torch', 18)}</button>
      <span class="cam-badge" data-cam-badge hidden>Traseira</span>
    </div>
  `);

  const fileInput = el('<input type="file" accept="image/*" capture="environment" hidden data-file />');
  const body = el('<div class="stack"></div>');

  root.append(cam, fileInput, body);

  /* ---------------- Câmera ---------------- */

  function mensagemCamera(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      return 'Permissão de câmera negada. Autorize o acesso ou use "Fotografar cartão".';
    }
    if (n === 'NotFoundError' || n === 'OverconstrainedError') {
      return 'Nenhuma câmera compatível encontrada. Use "Fotografar cartão".';
    }
    if (n === 'NotReadableError') {
      return 'A câmera está em uso por outro aplicativo.';
    }
    return 'Não foi possível abrir a câmera' + (e?.message ? ': ' + e.message : '.') + ' Use "Fotografar cartão".';
  }

  async function ligarCamera() {
    const video = cam.querySelector('video');

    if (!window.isSecureContext) {
      toast('A câmera exige HTTPS (ou localhost). Use "Fotografar cartão".', 'err');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Este navegador não libera a câmera para a página. Use "Fotografar cartão".', 'err');
      return;
    }

    const tentativas = [
      { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
      { audio: false, video: { facingMode: 'environment' } },
      { audio: false, video: true },
    ];

    let ultimoErro = null;
    for (const restricoes of tentativas) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(restricoes);
        break;
      } catch (e) { ultimoErro = e; }
    }

    if (!stream) { toast(mensagemCamera(ultimoErro), 'err'); return; }

    try {
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.muted = true;
      await video.play();
    } catch (e) {
      console.warn('[SICEP+] play() bloqueado:', e);
    }

    cam.classList.add('on');
    cam.querySelector('[data-img]').hidden = true;
    cam.querySelector('[data-cam-empty]').hidden = true;
    cam.querySelectorAll('[data-guide]').forEach((n) => { n.hidden = false; });
    cam.querySelector('[data-cam-badge]').hidden = false;

    const track = stream.getVideoTracks()[0];
    const cap = track.getCapabilities ? track.getCapabilities() : null;
    cam.querySelector('[data-torch]').hidden = !(cap && 'torch' in cap && cap.torch);

    st.camOn = true;
    st.imagem = null;
    pintar();
  }

  function desligarCamera() {
    pararCamera();
    const video = cam.querySelector('video');
    if (video) video.srcObject = null;
    cam.classList.remove('on');
    cam.querySelector('[data-cam-empty]').hidden = false;
    cam.querySelectorAll('[data-guide]').forEach((n) => { n.hidden = true; });
    cam.querySelector('[data-torch]').hidden = true;
    cam.querySelector('[data-cam-badge]').hidden = true;
    st.camOn = false;
  }

  cam.querySelector('[data-torch]').addEventListener('click', async () => {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    try {
      tocha = !tocha;
      await track.applyConstraints({ advanced: [{ torch: tocha }] });
    } catch (e) {
      toast('Lanterna indisponível neste dispositivo.', 'err');
    }
  });

  fileInput.addEventListener('change', (ev) => {
    const arquivo = ev.target.files && ev.target.files[0];
    if (!arquivo) return;
    if (st.imagem) URL.revokeObjectURL(st.imagem);
    st.imagem = URL.createObjectURL(arquivo);
    desligarCamera();
    const img = cam.querySelector('[data-img]');
    img.src = st.imagem;
    img.hidden = false;
    cam.querySelector('[data-cam-empty]').hidden = true;
    toast('Foto capturada. Ela serve como referência da correção.', 'ok');
    pintar();
  });

  function capturarFrame() {
    const video = cam.querySelector('video');
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  /* ---------------- Dados auxiliares ---------------- */

  const avaliacao = () => (st.avaliacaoId ? store.avaliacao(st.avaliacaoId) : null);
  const aplicacao = () => {
    const av = avaliacao();
    return av && st.turmaId ? store.aplicacaoDe(av, st.turmaId) : null;
  };
  const alunos = () => (st.turmaId ? store.alunosDaTurma(st.turmaId) : []);
  const avaliacoesDaTurma = () => store.avaliacoes().filter((a) => store.aplicacaoDe(a, st.turmaId));

  const resultadoDoAlunoNaTurma = (avaliacaoId, alunoId) =>
    store.resultadoDoAluno(avaliacaoId, alunoId, st.turmaId);

  function infoTurma(turmaId) {
    const total = store.alunosDaTurma(turmaId).length;
    const feitos = new Set(
      store.resultados().filter((r) => r.turma_id === turmaId).map((r) => r.aluno_id)
    ).size;
    return { total, feitos, completo: total > 0 && feitos >= total };
  }

  function alunosFiltrados() {
    const termo = st.busca.trim().toLowerCase();
    if (!termo) return alunos();
    return alunos().filter((a) => String(a.nome_completo || '').toLowerCase().includes(termo));
  }

  function acharPorCodigo(texto) {
    const alvo = String(texto || '').trim().toLowerCase();
    if (!alvo) return null;
    const avs = avaliacoesDaTurma();
    const exato = avs.find((a) => String(a.layout?.codigo_caderno || '').trim().toLowerCase() === alvo);
    if (exato) return exato;
    // Avaliações antigas ainda sem layout gravado usam o código padrão do cartão.
    return avs.find((a) => String(a.layout?.codigo_caderno || 'SICEP-A').toLowerCase() === alvo) || null;
  }

  /* ---------------- Correção ---------------- */

  function iniciarLeituras() {
    const av = avaliacao();
    if (!av) return;
    st.leituras = av.questoes.map((q) => ({
      numero: q.numero,
      detectada: null,
      gabarito: q.gabarito,
      valor: q.anulada ? 0 : Number(q.valor) || 0,
      anulada: !!q.anulada,
    }));
  }

  function respostasObjeto() {
    const respostas = {};
    (st.leituras || []).forEach((l) => { if (l.detectada) respostas[l.numero] = l.detectada; });
    return respostas;
  }

  function resumoLeitura() {
    const av = avaliacao();
    const calc = store.calcularCorrecao(av, respostasObjeto());
    const emBranco = (st.leituras || []).filter((l) => !l.anulada && !l.detectada).length;
    return { ...calc, emBranco };
  }

  function tileHTML(l) {
    const classes = ['ans-tile'];
    if (l.anulada) classes.push('anulada');
    else if (l.detectada) classes.push('ok');
    return `<button type="button" class="${classes.join(' ')}" data-tile="${l.numero}">
      <span class="at-n">${l.numero}</span>
      <span class="at-a">${l.anulada ? 'X' : (l.detectada || '–')}</span>
    </button>`;
  }

  function editorHTML() {
    const l = (st.leituras || []).find((x) => x.numero === st.ativa);
    if (!l) return '';
    const av = avaliacao();
    const letras = store.ALTERNATIVAS.slice(0, av?.layout?.num_alternativas || 5);
    return `
      <div class="ans-editor" id="editor">
        <div class="row between">
          <span class="small strong">Questão ${l.numero}</span>
          <span class="xs muted">${l.anulada ? 'anulada' : fmtNota(l.valor) + ' ponto(s)'}</span>
        </div>
        ${l.anulada ? '<p class="xs muted">Questão anulada — creditada a todos os alunos.</p>' : `
        <div class="row wrap" style="gap:8px">
          ${letras.map((a) => `
            <button type="button" class="ans-opt ${l.detectada === a ? 'on' : ''}" data-opt="${a}">${a}</button>`).join('')}
          <button type="button" class="ans-opt ${!l.detectada ? 'on' : ''}" data-opt="">Em branco</button>
        </div>`}
        <div class="row between" style="gap:10px">
          <span class="xs muted">Toque em outra questão para corrigir.</span>
          <button type="button" class="btn btn-ghost btn-sm" data-fechar-editor>Fechar</button>
        </div>
      </div>`;
  }

  function scoreHTML() {
    const s = resumoLeitura();
    return `
      <div class="row between wrap" style="gap:12px">
        <div>
          <div class="xs muted">Nota parcial</div>
          <div class="result-big">
            <span class="rn">${fmtNota(s.nota)}</span>
            <span class="small muted">/ ${fmtNota(s.total)}</span>
          </div>
        </div>
        <div style="text-align:right">
          <div class="small strong">${s.percentual}%</div>
          <div class="xs muted">${s.emBranco} em branco · ${s.acertos} acerto(s)</div>
        </div>
      </div>`;
  }

  async function confirmarCorrecao() {
    const av = avaliacao();
    const apl = aplicacao();
    if (!av || !apl) { toast('Avaliação/turma não identificada.', 'err'); return; }

    const r = await store.salvarResultado({
      avaliacao: av,
      aplicacao: apl,
      alunoId: st.alunoId,
      respostas: respostasObjeto(),
      confianca: null,
      situacao: 'normal',
      imagemRef: st.imagem && st.imagem.startsWith('http') ? st.imagem : null,
      revisado: true,
    });

    if (!r.ok) { toast(r.erro, 'err'); return; }
    if (r.aviso) toast(r.aviso, 'err');

    st.resultado = r.resultado;
    st.etapa = 'resultado';
    pintar();
  }

  async function registrarSemCartao(situacao) {
    const av = avaliacao();
    const apl = aplicacao();
    if (!av || !apl || !st.alunoId) return;

    const r = await store.registrarSituacao({ avaliacao: av, aplicacao: apl, alunoId: st.alunoId, situacao });
    if (!r.ok) { toast(r.erro, 'err'); return; }
    st.resultado = r.resultado;
    st.etapa = 'resultado';
    pintar();
  }

  /* ---------------- Render ---------------- */

  function atualizarGrade() {
    const grade = body.querySelector('#grade');
    if (grade) grade.innerHTML = (st.leituras || []).map(tileHTML).join('');
    const box = body.querySelector('#scorebox');
    if (box) box.innerHTML = scoreHTML();
  }

  function abrirEditor(numero) {
    st.ativa = numero;
    const wrap = body.querySelector('#editor-box');
    if (!wrap) return;
    wrap.innerHTML = editorHTML();
    const editor = wrap.querySelector('#editor');
    if (!editor) return;

    editor.querySelectorAll('[data-opt]').forEach((b) => {
      b.addEventListener('click', () => {
        const l = (st.leituras || []).find((x) => x.numero === numero);
        if (!l) return;
        l.detectada = b.dataset.opt || null;
        st.ativa = null;
        wrap.innerHTML = '';
        atualizarGrade();
      });
    });
    editor.querySelector('[data-fechar-editor]').addEventListener('click', () => {
      st.ativa = null;
      wrap.innerHTML = '';
    });
  }

  function meta(extra = '') {
    const t = store.turma(st.turmaId);
    const a = store.aluno(st.alunoId);
    return `<div class="step-meta">
      <span class="small strong">${ETAPAS[st.etapa]}</span>
      <span class="xs muted">${esc([t?.nome, a?.nome_completo, extra].filter(Boolean).join(' · '))}</span>
    </div>`;
  }

  /* ---- Etapa 1: turma ---- */

  function etapaTurma() {
    const turmas = store.turmasDoProfessor(store.sessao().professor_id);
    const infos = turmas.map((t) => ({ t, ...infoTurma(t.id) }));
    const faltam = infos.filter((i) => !i.completo).length;

    body.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">Leitura</span>
        <h1>Selecione a turma</h1>
        <p>${esc(store.sessao()?.escola || 'Escola não informada')}</p>
      </div>

      ${infos.length ? `
        <div class="card stack tight list-card">
          ${infos.map(({ t, total, feitos, completo }) => `
            <button type="button" class="turma-row" data-turma="${esc(t.id)}">
              <span class="tr-check ${completo ? 'ok' : ''}">${completo ? icon('check', 15) : ''}</span>
              <span class="grow">
                <span class="tr-nome">${esc(t.nome)}</span>
                <span class="tr-sub">${completo ? 'Finalizado' : 'Em andamento'}</span>
              </span>
              <span class="tr-bars" aria-hidden="true">
                ${[0, 1, 2, 3, 4].map((i) => `<span class="${total && feitos / total > i / 5 ? 'on' : ''}"></span>`).join('')}
              </span>
              <span class="tr-cont">${feitos} de ${total}</span>
            </button>`).join('')}
        </div>

        <div class="row between wrap" style="gap:10px">
          <span class="small ${faltam ? 'strong' : 'muted'}">Faltam ${faltam} de ${infos.length} turmas para sincronizar</span>
          <button class="btn btn-outline btn-sm" type="button" data-recarregar>${icon('refresh', 15)} Recarregar</button>
        </div>
      ` : `
        <div class="empty">
          <div class="ei">${icon('users', 20)}</div>
          <h3>Nenhuma turma vinculada</h3>
          <p>Fale com a secretaria da escola.</p>
        </div>`}
    `;

    body.querySelectorAll('[data-turma]').forEach((b) => {
      b.addEventListener('click', () => {
        st.turmaId = b.dataset.turma;
        st.alunoId = null;
        st.avaliacaoId = null;
        st.leituras = null;
        st.aba = 'estudantes';
        st.busca = '';
        st.etapa = 'aluno';
        pintar();
      });
    });
    body.querySelector('[data-recarregar]')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      await store.recarregar();
      pintar();
    });
  }

  /* ---- Etapa 2: aluno / instrumento ---- */

  function abaEstudantes() {
    const lista = alunosFiltrados();
    const avs = avaliacoesDaTurma();

    return `
      <div class="field" style="margin:0">
        <label class="label sr-only" for="busca">Buscar estudante</label>
        <div class="search-box">
          ${icon('search', 16)}
          <input id="busca" class="input" type="search" placeholder="Buscar estudante" value="${esc(st.busca)}" data-busca />
        </div>
      </div>

      ${lista.length ? `
        <div class="card stack tight list-card" style="padding:0">
          ${lista.map((a) => {
            const corrigidos = avs.filter((av) => resultadoDoAlunoNaTurma(av.id, a.id)).length;
            const totalAvs = avs.length;
            return `
              <button type="button" class="aluno-row" data-aluno="${esc(a.id)}">
                <span class="grow">
                  <span class="al-nome">${esc(a.nome_completo)}</span>
                  <span class="al-sub">${totalAvs ? `${corrigidos} de ${totalAvs} avaliação(ões)` : 'Sem avaliação aplicada'}</span>
                </span>
                <span class="al-add">${icon('plus', 18)}</span>
              </button>`;
          }).join('')}
        </div>` : `
        <div class="empty">
          <div class="ei">${icon('users', 20)}</div>
          <h3>Nenhum estudante encontrado</h3>
          <p>${st.busca ? 'Tente outro nome.' : 'Esta turma não tem alunos cadastrados.'}</p>
        </div>`}
    `;
  }

  function abaInstrumentos() {
    const avs = avaliacoesDaTurma();
    return `
      ${avs.length ? `
        <div class="card stack tight list-card">
          ${avs.map((av) => {
            const prog = store.progresso(av, st.turmaId);
            return `
              <button type="button" class="inst-row" data-instrumento="${esc(av.id)}">
                <span class="grow">
                  <span class="al-nome">${esc(av.titulo)}</span>
                  <span class="al-sub mono">${esc(av.layout?.codigo_caderno || 'SICEP-A')} · ${av.questoes.length} questões</span>
                </span>
                <span class="tr-cont">${prog.registrados} de ${prog.total}</span>
              </button>`;
          }).join('')}
        </div>` : `
        <div class="empty">
          <div class="ei">${icon('cards', 20)}</div>
          <h3>Nenhuma avaliação aplicada</h3>
          <p>Crie uma avaliação para esta turma.</p>
        </div>`}
    `;
  }

  function etapaAluno() {
    const t = store.turma(st.turmaId);
    body.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">Leitura</span>
        <h1>Selecione um aluno</h1>
      </div>

      <div class="capture-head">
        <button class="icon-btn" type="button" data-voltar-turma aria-label="Voltar">${icon('left', 18)}</button>
        <span class="grow">
          <span class="strong">${esc(t?.nome || 'Turma')}</span>
          <span class="xs muted" style="display:block">${esc(store.sessao()?.escola || '')}</span>
        </span>
      </div>

      <div class="tabs" role="tablist">
        <button type="button" class="tab ${st.aba === 'estudantes' ? 'on' : ''}" data-aba="estudantes" role="tab">Estudantes</button>
        <button type="button" class="tab ${st.aba === 'instrumentos' ? 'on' : ''}" data-aba="instrumentos" role="tab">Instrumentos</button>
      </div>

      ${st.aba === 'estudantes' ? abaEstudantes() : abaInstrumentos()}
    `;

    body.querySelector('[data-voltar-turma]').addEventListener('click', () => {
      st.etapa = 'turma';
      st.turmaId = null;
      pintar();
    });

    body.querySelectorAll('[data-aba]').forEach((b) => {
      b.addEventListener('click', () => { st.aba = b.dataset.aba; pintar(); });
    });

    const busca = body.querySelector('[data-busca]');
    if (busca) {
      busca.addEventListener('input', () => {
        st.busca = busca.value;
        const pos = busca.selectionStart;
        pintar();
        const novo = body.querySelector('[data-busca]');
        if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
      });
    }

    body.querySelectorAll('[data-aluno]').forEach((b) => {
      b.addEventListener('click', () => {
        st.alunoId = b.dataset.aluno;
        st.codigo = '';
        st.leituras = null;
        st.avaliacaoId = avaliacoesDaTurma()[0]?.id || null;
        st.etapa = 'cartao';
        pintar();
      });
    });

    body.querySelectorAll('[data-instrumento]').forEach((b) => {
      b.addEventListener('click', () => {
        if (!st.alunoId) { toast('Escolha o estudante na aba Estudantes.', 'err'); return; }
        st.avaliacaoId = b.dataset.instrumento;
        st.leituras = null;
        st.etapa = 'cartao';
        pintar();
      });
    });
  }

  /* ---- Etapa 3: cartão ---- */

  function etapaCartao() {
    const av = avaliacao();
    const aluno = store.aluno(st.alunoId);
    const opcoes = avaliacoesDaTurma();
    const codigoAtual = av?.layout?.codigo_caderno || 'SICEP-A';

    body.innerHTML = `
      <div class="capture-head">
        <button class="icon-btn" type="button" data-voltar-aluno aria-label="Voltar">${icon('left', 18)}</button>
        <span class="grow">
          <span class="strong">${esc(aluno?.nome_completo || '')}</span>
          <span class="xs muted" style="display:block">${esc(store.turma(st.turmaId)?.nome || '')}</span>
        </span>
        ${badge('Caderno ' + codigoAtual, 'y')}
      </div>

      <div class="card stack">
        <div class="field" style="margin:0">
          <label class="label" for="codigo">Código do caderno (QR do cartão)</label>
          <div class="row" style="gap:8px">
            <input id="codigo" class="input mono" type="text" maxlength="50" data-codigo
                   value="${esc(st.codigo)}" placeholder="${esc(codigoAtual)}" autocapitalize="characters" spellcheck="false" />
            <button class="btn btn-outline btn-sm" type="button" data-aplicar>OK</button>
          </div>
          <span class="hint">Digite o código impresso no cartão. Ele identifica a avaliação.</span>
        </div>

        ${opcoes.length ? `
          <div class="field" style="margin:0">
            <label class="label" for="av-cad">Avaliação</label>
            <select id="av-cad" class="select" data-av-cad>
              ${opcoes.map((a) => `<option value="${esc(a.id)}" ${a.id === st.avaliacaoId ? 'selected' : ''}>${esc(a.titulo)}</option>`).join('')}
            </select>
          </div>` : `<div class="alert err">Nenhuma avaliação aplicada a esta turma.</div>`}

        <div class="kv-list">
          <div><span class="k">Questões</span><span class="v">${av?.questoes.length || 0}</span></div>
          <div><span class="k">Valor</span><span class="v">${fmtNota(av?.valor_total || 0)}</span></div>
          <div><span class="k">Alternativas</span><span class="v">${av?.layout?.num_alternativas || 5}</span></div>
        </div>
      </div>

      ${cam}

      <div class="card stack">
        <div class="btn-group">
          <button class="btn btn-outline" type="button" data-cam-toggle>
            ${icon('camera', 17)} ${st.camOn ? 'Desligar' : 'Ligar câmera'}
          </button>
          <button class="btn btn-outline" type="button" data-fotografar>${icon('print', 17)} Fotografar</button>
        </div>
        <button class="btn btn-primary btn-block" type="button" data-lancar ${opcoes.length ? '' : 'disabled'}>
          Lançar respostas
        </button>
      </div>
    `;

    body.querySelector('[data-voltar-aluno]').addEventListener('click', () => {
      st.etapa = 'aluno';
      pintar();
    });

    const campo = body.querySelector('[data-codigo]');
    body.querySelector('[data-aplicar]').addEventListener('click', () => {
      st.codigo = campo.value.trim();
      const achada = acharPorCodigo(st.codigo);
      if (!achada) { toast('Nenhuma avaliação desta turma usa esse código.', 'err'); return; }
      st.avaliacaoId = achada.id;
      st.leituras = null;
      toast('Caderno identificado: ' + achada.titulo, 'ok');
      pintar();
    });
    campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); body.querySelector('[data-aplicar]').click(); } });

    body.querySelector('[data-av-cad]')?.addEventListener('change', (e) => {
      st.avaliacaoId = e.target.value;
      st.leituras = null;
      pintar();
    });

    body.querySelector('[data-cam-toggle]').addEventListener('click', () => {
      if (st.camOn) { desligarCamera(); pintar(); } else ligarCamera();
    });
    body.querySelector('[data-fotografar]').addEventListener('click', () => fileInput.click());
    body.querySelector('[data-lancar]').addEventListener('click', () => {
      if (!av) { toast('Selecione a avaliação.', 'err'); return; }
      const frame = capturarFrame();
      if (frame) {
        if (st.imagem) URL.revokeObjectURL(st.imagem);
        st.imagem = frame;
      }
      desligarCamera();
      if (!st.leituras) iniciarLeituras();
      st.etapa = 'conferencia';
      pintar();
    });
  }

  /* ---- Etapa 4: conferência ---- */

  function etapaConferencia() {
    const av = avaliacao();
    const s = resumoLeitura();
    body.innerHTML = `
      <div class="capture-head">
        <button class="icon-btn" type="button" data-voltar-cartao aria-label="Voltar">${icon('left', 18)}</button>
        <span class="grow">
          <span class="strong">${esc(store.aluno(st.alunoId)?.nome_completo || '')}</span>
          <span class="xs muted" style="display:block">${esc(av?.titulo || '')} · ${esc(av?.layout?.codigo_caderno || '')}</span>
        </span>
        ${badge(`${s.emBranco} em branco`, s.emBranco ? 'warn' : 'ok')}
      </div>

      <div class="card">
        <p class="xs muted" style="margin-bottom:10px">Toque na questão para marcar a alternativa assinalada no cartão.</p>
        <div class="ans-grid" id="grade">${st.leituras.map(tileHTML).join('')}</div>
        <div id="editor-box"></div>
        <div id="scorebox" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
          ${scoreHTML()}
        </div>
      </div>

      <div class="alert y">
        ${icon('info', 16)}
        <span>Respostas em branco contam como erro. Nada é preenchido automaticamente.</span>
      </div>

      <div class="btn-group">
        <button class="btn btn-outline" type="button" data-voltar-cartao>Voltar</button>
        <button class="btn btn-primary" type="button" data-confirmar>Confirmar correção</button>
      </div>
    `;

    body.querySelectorAll('[data-tile]').forEach((b) => {
      b.addEventListener('click', () => abrirEditor(Number(b.dataset.tile)));
    });
    body.querySelectorAll('[data-voltar-cartao]').forEach((b) => {
      b.addEventListener('click', () => { st.etapa = 'cartao'; pintar(); });
    });
    body.querySelector('[data-confirmar]').addEventListener('click', confirmarCorrecao);
  }

  /* ---- Resultado ---- */

  function etapaResultado() {
    const av = avaliacao();
    const r = st.resultado || {};
    const faixa = store.faixaDe(av, r.percentual || 0);
    body.innerHTML = `
      <div class="card stack">
        <div class="card-head">
          <div>
            <h2>${esc(store.aluno(st.alunoId)?.nome_completo || '')}</h2>
            <p class="xs muted">${esc(av?.titulo || '')}</p>
          </div>
          ${situacaoBadge(r.situacao)}
        </div>

        <div class="row between wrap" style="gap:12px">
          <div>
            <div class="xs muted">Nota</div>
            <div class="result-big">
              <span class="rn">${r.nota == null ? '—' : fmtNota(r.nota)}</span>
              <span class="small muted">/ ${fmtNota(av?.valor_total || 0)}</span>
            </div>
          </div>
          <div style="text-align:right">${desempenhoTexto(r.percentual || 0, faixa)}</div>
        </div>

        ${barraDesempenho(r.percentual || 0, faixa)}

        <div class="kv-list" style="margin-top:12px">
          <div><span class="k">Acertos</span><span class="v">${r.acertos ?? '—'}</span></div>
          <div><span class="k">Erros</span><span class="v">${r.erros ?? '—'}</span></div>
          <div><span class="k">Situação</span><span class="v">${esc(store.SITUACOES[r.situacao]?.rotulo || r.situacao || '—')}</span></div>
          <div><span class="k">Registro</span><span class="v">${r.status === 'confirmado' ? 'Confirmado' : 'Revisão pendente'}</span></div>
        </div>
      </div>

      <div class="btn-group">
        <button class="btn btn-outline" type="button" data-outro>Corrigir outro</button>
        <button class="btn btn-primary" type="button" data-concluir>Concluir</button>
      </div>
    `;

    body.querySelector('[data-outro]').addEventListener('click', () => {
      st.alunoId = null;
      st.leituras = null;
      st.resultado = null;
      st.avaliacaoId = null;
      st.codigo = '';
      if (st.imagem) { URL.revokeObjectURL(st.imagem); st.imagem = null; }
      cam.querySelector('[data-img]').hidden = true;
      st.etapa = 'aluno';
      pintar();
    });
    body.querySelector('[data-concluir]').addEventListener('click', () => {
      st.etapa = 'turma';
      st.turmaId = null;
      st.alunoId = null;
      st.leituras = null;
      st.resultado = null;
      st.avaliacaoId = null;
      pintar();
    });
  }

  /* ---------------- Pintar ---------------- */

  function pintar() {
    cam.hidden = st.etapa !== 'cartao';
    if (st.etapa === 'cartao') {
      cam.querySelector('[data-cam-empty]').hidden = st.camOn || Boolean(st.imagem);
      if (st.imagem && !st.camOn) {
        const img = cam.querySelector('[data-img]');
        img.src = st.imagem;
        img.hidden = false;
      }
    }

    if (st.etapa === 'turma') return etapaTurma();
    if (st.etapa === 'aluno') return etapaAluno();
    if (st.etapa === 'cartao') return etapaCartao();
    if (st.etapa === 'conferencia') return etapaConferencia();
    return etapaResultado();
  }

  pintar();
  return { node: root, destroy: pararCamera };
}

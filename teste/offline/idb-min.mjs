/* ============================================================
   SICEP+ · IndexedDB mínimo para os testes em Node (não faz parte do app)

   Implementa só o subconjunto usado por js/offline/db.js:
   open/upgrade, object stores com keyPath e autoIncrement, índices,
   transaction (readonly/readwrite), get/put/add/delete/getAll,
   getAll/openKeyCursor por índice e IDBKeyRange.only.
   ============================================================ */

class Loja {
  constructor(nome, opcoes = {}) {
    this.name = nome;
    this.keyPath = opcoes.keyPath || 'k';
    this.autoIncrement = !!opcoes.autoIncrement;
    this.dados = new Map();
    this.indices = new Map();
    this.proximo = 1;
  }

  createIndex(nome, caminho) { this.indices.set(nome, caminho); }

  limpar() { this.dados.clear(); this.proximo = 1; }

  inserir(registro, falharSeExiste = false) {
    const copia = structuredClone(registro);
    let chave = copia[this.keyPath];
    if (chave === undefined && this.autoIncrement) {
      chave = this.proximo;
      this.proximo += 1;
      copia[this.keyPath] = chave;
    }
    if (falharSeExiste && this.dados.has(chave)) {
      const e = new Error('ConstraintError: chave já existe');
      e.name = 'ConstraintError';
      throw e;
    }
    this.dados.set(chave, copia);
    return chave;
  }

  porIndice(caminho, faixa) {
    const linhas = [...this.dados.values()];
    if (!faixa) return linhas;
    const alvo = faixa.only;
    return linhas.filter((l) => l[caminho] === alvo);
  }
}

class Indice {
  constructor(loja, caminho) { this.loja = loja; this.caminho = caminho; }
  getAll(faixa) { return this.loja.porIndice(this.caminho, faixa); }
  get(chave) { return this.loja.dados.get(chave); }
}

class Transacao {
  constructor(db, nomes, modo) {
    this.db = db;
    this.nomes = Array.isArray(nomes) ? nomes : [nomes];
    this.mode = modo;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this._ops = 0;
    this._timer = null;
    this._erro = null;
    this._fechada = false;
    this._agendar();
  }

  objectStore(nome) {
    const loja = this.db._lojas.get(nome);
    if (!loja) throw new Error(`Object store inexistente: ${nome}`);
    if (!this.nomes.includes(nome)) throw new Error(`Store fora da transação: ${nome}`);
    return new Acesso(this, loja);
  }

  _agendar() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (this._ops > 0 || this._fechada) return;
      this._fechada = true;
      if (this._erro) this.onabort?.({ target: this });
      else this.oncomplete?.({ target: this });
    }, 0);
  }

  _pedido(fn) {
    this._ops += 1;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    let resultado;
    let erro = null;
    try { resultado = fn(); } catch (e) { erro = e; }
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      this._ops -= 1;
      if (erro) {
        this._erro = this._erro || erro;
        req.error = erro;
        try { req.onerror?.({ target: req }); } catch (e) { /* ignora */ }
        this.onerror?.({ target: this });
      } else {
        req.result = resultado;
        try { req.onsuccess?.({ target: req }); } catch (e) { /* ignora */ }
      }
      this._agendar();
    });
    return req;
  }
}

class Acesso {
  constructor(tx, loja) { this.tx = tx; this.loja = loja; }
  get(chave) { return this.tx._pedido(() => (this.loja.dados.has(chave) ? structuredClone(this.loja.dados.get(chave)) : undefined)); }
  getAll(faixa) { return this.tx._pedido(() => this.loja.porIndice(this.loja.keyPath, faixa).map((l) => structuredClone(l))); }
  put(registro) { return this.tx._pedido(() => this.loja.inserir(registro)); }
  add(registro) { return this.tx._pedido(() => this.loja.inserir(registro, true)); }
  delete(chave) { return this.tx._pedido(() => { this.loja.dados.delete(chave); return undefined; }); }
  clear() { return this.tx._pedido(() => { this.loja.dados.clear(); return undefined; }); }
  index(nome) {
    const caminho = this.loja.indices.get(nome);
    if (!caminho) throw new Error(`Índice inexistente: ${nome}`);
    const indice = new Indice(this.loja, caminho);
    const tx = this.tx;
    return {
      getAll: (faixa) => tx._pedido(() => indice.getAll(faixa).map((l) => structuredClone(l))),
      openKeyCursor: (faixa) => {
        const chaves = [...this.loja.dados.keys()].filter((k) => {
          if (!faixa) return true;
          return this.loja.dados.get(k)[caminho] === faixa.only;
        });
        const req = { result: null, onsuccess: null, onerror: null };
        let i = 0;
        const passo = () => {
          if (i >= chaves.length) { req.result = null; req.onsuccess?.({ target: req }); return; }
          const chave = chaves[i];
          req.result = {
            primaryKey: chave,
            continue: () => { i += 1; queueMicrotask(passo); },
          };
          req.onsuccess?.({ target: req });
        };
        queueMicrotask(passo);
        return req;
      },
    };
  }
}

class Banco {
  constructor(nome, versao) {
    this.name = nome;
    this.version = versao;
    this._lojas = new Map();
    this.objectStoreNames = { contains: (n) => this._lojas.has(n) };
    this.onversionchange = null;
  }

  createObjectStore(nome, opcoes) {
    if (this._lojas.has(nome)) throw new Error(`Store já existe: ${nome}`);
    const loja = new Loja(nome, opcoes);
    this._lojas.set(nome, loja);
    return {
      createIndex: (indice, caminho) => loja.createIndex(indice, caminho),
      name: nome,
    };
  }

  transaction(nomes, modo = 'readonly') { return new Transacao(this, nomes, modo); }
  close() { this.fechado = true; }
}

const bancos = new Map();

export function instalarIndexedDB() {
  const indexedDB = {
    open(nome, versao = 1) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      setTimeout(() => {
        let db = bancos.get(nome);
        const novo = !db;
        if (!db) { db = new Banco(nome, versao); bancos.set(nome, db); }
        req.result = db;
        if (novo && req.onupgradeneeded) req.onupgradeneeded({ target: req });
        req.onsuccess?.({ target: req });
      }, 0);
      return req;
    },
    deleteDatabase(nome) {
      const req = { result: null, onsuccess: null, onerror: null };
      setTimeout(() => { bancos.delete(nome); req.onsuccess?.({ target: req }); }, 0);
      return req;
    },
  };

  const IDBKeyRange = { only: (valor) => ({ only: valor }) };

  /** Esvazia todas as lojas (mantém a conexão e a estrutura). */
  function reset() {
    bancos.forEach((db) => db._lojas.forEach((loja) => loja.limpar()));
  }

  return { indexedDB, IDBKeyRange, reset };
}

/* =============================================================================
   backup.js — Backup automático em uma pasta do computador.

   Você escolhe a pasta uma vez; a partir daí o app regrava o arquivo
   `crm_backup.json` sozinho a cada alteração (com uma pausa de alguns segundos
   para não gravar a cada tecla).

   Depende da File System Access API (Chrome/Edge) e de um contexto seguro —
   ou seja, abrindo pelo `iniciar.bat` (http://localhost). Abrindo o arquivo
   direto (file://) o navegador não deixa; aí o app cai no plano B: avisar
   quando o último backup manual estiver velho.
   ============================================================================= */

const Backup = (function () {
  'use strict';

  const IDB_NOME = 'crm_local_backup';
  const IDB_STORE = 'handles';
  const IDB_CHAVE = 'pasta';
  const ARQUIVO = 'crm_backup.json';
  const CHAVE_ULTIMO = 'crm_local_ultimo_backup';
  const ESPERA = 4000;          // pausa antes de gravar, em ms
  const DIAS_PARA_COBRAR = 7;   // sem backup por mais que isso, o app avisa

  let pasta = null;             // FileSystemDirectoryHandle
  let precisaAutorizar = false; // pasta lembrada, mas sem permissão nesta sessão
  let timer = null;
  let aoMudar = function () {};

  const suportado = typeof window.showDirectoryPicker === 'function';

  // ------------------------------------------------- IndexedDB (guarda o handle)

  function abrirIDB() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(IDB_NOME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGravar(valor) {
    return abrirIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(valor, IDB_CHAVE);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function idbLer() {
    return abrirIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(IDB_CHAVE);
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror = function () { db.close(); reject(req.error); };
      });
    });
  }

  function idbApagar() {
    return abrirIDB().then(function (db) {
      return new Promise(function (resolve) {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(IDB_CHAVE);
        tx.oncomplete = function () { db.close(); resolve(); };
      });
    });
  }

  // ------------------------------------------------------------------ gravação

  function conteudo() {
    return JSON.stringify({
      versao: 1,
      geradoEm: new Date().toISOString(),
      leads: DB.listar(),
      etapas: DB.etapas(),
      modelos: DB.modelos()
    }, null, 2);
  }

  function marcarFeito() {
    localStorage.setItem(CHAVE_ULTIMO, new Date().toISOString());
    aoMudar();
  }

  /** Com o cofre ligado, o arquivo de backup sai cifrado com a mesma senha —
      senão ele seria a porta dos fundos do cofre. */
  function conteudoParaArquivo() {
    const texto = conteudo();
    if (typeof Cofre === 'undefined' || !Cofre.aberto()) return Promise.resolve(texto);
    return Cofre.cifrarTexto(texto).then(function (pacote) {
      return JSON.stringify({
        cifrado: 1,
        aviso: 'Backup protegido por senha do CRM Local. Sem a senha não há como abrir.',
        iv: pacote.iv,
        dados: pacote.dados
      }, null, 2);
    });
  }

  /** Grava o arquivo na pasta autorizada. Resolve com true se conseguiu. */
  function gravarAgora() {
    if (!pasta) return Promise.resolve(false);
    return conteudoParaArquivo()
      .then(function (texto) {
        return pasta.getFileHandle(ARQUIVO, { create: true })
          .then(function (arquivo) { return arquivo.createWritable(); })
          .then(function (fluxo) {
            return fluxo.write(texto).then(function () { return fluxo.close(); });
          });
      })
      .then(function () { marcarFeito(); return true; })
      .catch(function (erro) {
        console.error('Backup automático falhou:', erro);
        // Perdemos a permissão (navegador reiniciado, pasta movida…)
        pasta = null;
        precisaAutorizar = true;
        aoMudar();
        return false;
      });
  }

  function agendarGravacao() {
    if (!pasta) return;
    clearTimeout(timer);
    timer = setTimeout(gravarAgora, ESPERA);
  }

  // -------------------------------------------------------------- permissões

  function permissao(handle, pedir) {
    const opcoes = { mode: 'readwrite' };
    if (!handle.queryPermission) return Promise.resolve('granted');
    return handle.queryPermission(opcoes).then(function (estado) {
      if (estado === 'granted') return 'granted';
      if (!pedir) return estado;
      return handle.requestPermission(opcoes);
    });
  }

  // ---------------------------------------------------------------------- API

  return {
    /** Liga o backup automático e devolve o estado inicial. */
    iniciar: function (callbackMudanca) {
      if (typeof callbackMudanca === 'function') aoMudar = callbackMudanca;
      DB.aoGravar(agendarGravacao);

      if (!suportado) return Promise.resolve(this.estado());

      return idbLer().then(function (handle) {
        if (!handle) return;
        return permissao(handle, false).then(function (estado) {
          if (estado === 'granted') pasta = handle;
          else precisaAutorizar = true;
        });
      }).catch(function (erro) {
        console.error('Não consegui recuperar a pasta de backup:', erro);
      }).then(function () {
        aoMudar();
        return true;
      });
    },

    /** Abre o seletor de pasta (precisa de clique do usuário). */
    escolherPasta: function () {
      if (!suportado) {
        return Promise.reject(new Error('Este navegador não permite gravar em pasta. ' +
          'Abra o CRM pelo iniciar.bat (http://localhost) no Chrome ou Edge.'));
      }
      return window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' })
        .then(function (handle) {
          return permissao(handle, true).then(function (estado) {
            if (estado !== 'granted') throw new Error('Permissão negada para a pasta.');
            pasta = handle;
            precisaAutorizar = false;
            return idbGravar(handle);
          });
        })
        .then(function () { return gravarAgora(); });
    },

    /** Reativa a pasta já escolhida (o navegador pede permissão de novo). */
    reautorizar: function () {
      return idbLer().then(function (handle) {
        if (!handle) throw new Error('Nenhuma pasta guardada.');
        return permissao(handle, true).then(function (estado) {
          if (estado !== 'granted') throw new Error('Permissão negada para a pasta.');
          pasta = handle;
          precisaAutorizar = false;
          return gravarAgora();
        });
      });
    },

    desligar: function () {
      pasta = null;
      precisaAutorizar = false;
      clearTimeout(timer);
      return idbApagar().then(function () { aoMudar(); });
    },

    gravarAgora: gravarAgora,

    /** Registra que houve um backup manual (download do .json). */
    registrarManual: marcarFeito,

    estado: function () {
      const ultimo = localStorage.getItem(CHAVE_ULTIMO);
      const dias = ultimo
        ? Math.floor((Date.now() - new Date(ultimo).getTime()) / 86400000)
        : null;
      return {
        suportado: suportado,
        ativo: Boolean(pasta),
        precisaAutorizar: precisaAutorizar,
        nomePasta: pasta ? pasta.name : null,
        ultimo: ultimo,
        diasDesde: dias,
        // Sem gravação automática e com backup velho (ou nenhum), o app cobra.
        atrasado: !pasta && (dias === null || dias > DIAS_PARA_COBRAR)
      };
    }
  };
})();

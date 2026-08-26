/* =============================================================================
   cofre.js — Senha e criptografia dos contatos.

   Com o cofre ligado, os contatos deixam de ficar em texto puro: o navegador
   guarda só texto embaralhado (AES-GCM 256), e a chave nasce da sua senha
   (PBKDF2-SHA256). Sem a senha, nem o arquivo do perfil do navegador nem o
   backup em pasta servem para alguém.

   O que isso protege: quem abre o Chrome na sua conta, quem copia a pasta de
   backup, quem vasculha o disco.
   O que não protege: alguém sentado na frente do app já destravado (por isso o
   travamento automático) e vírus com captura de teclado.

   ATENÇÃO: não existe recuperação de senha. Sem ela, os dados se perdem — por
   isso a tela de criação exige uma cópia de segurança antes de ligar.
   ============================================================================= */

const Cofre = (function () {
  'use strict';

  const CHAVE_COFRE = 'crm_local_cofre_v1';
  const CHAVE_DADOS = 'crm_local_leads_v1';
  const ITERACOES = 400000;          // PBKDF2: quanto maior, mais lento para quem tenta adivinhar
  const VERIFICACAO = 'crm-cofre-ok';
  const MINUTOS_INATIVO = 15;        // trava sozinho depois disso

  let chave = null;                  // CryptoKey em memória; some ao trancar
  let config = null;                 // { salt, iteracoes, verificacao }
  let timerInatividade = null;
  let filaGravacao = Promise.resolve();
  let aoDestravar = function () {};

  const suportado = Boolean(window.crypto && window.crypto.subtle);

  // ------------------------------------------------------------- utilidades

  function paraBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let texto = '';
    for (let i = 0; i < bytes.length; i++) texto += String.fromCharCode(bytes[i]);
    return btoa(texto);
  }

  function deBase64(texto) {
    const bruto = atob(texto);
    const bytes = new Uint8Array(bruto.length);
    for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
    return bytes;
  }

  function lerConfig() {
    if (config !== null) return config;
    try {
      config = JSON.parse(localStorage.getItem(CHAVE_COFRE) || 'null');
    } catch (erro) {
      console.error('Configuração do cofre ilegível:', erro);
      config = null;
    }
    return config;
  }

  // ------------------------------------------------------------- criptografia

  /** Deriva a chave AES a partir da senha e do sal guardado. */
  function derivar(senha, salt, iteracoes) {
    const codificador = new TextEncoder();
    return crypto.subtle.importKey('raw', codificador.encode(senha), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iteracoes, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  function cifrarCom(chaveAes, texto) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, chaveAes,
                                 new TextEncoder().encode(texto))
      .then(function (cifrado) {
        return { iv: paraBase64(iv), dados: paraBase64(cifrado) };
      });
  }

  function decifrarCom(chaveAes, pacote) {
    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: deBase64(pacote.iv) }, chaveAes, deBase64(pacote.dados)
    ).then(function (aberto) {
      return new TextDecoder().decode(aberto);
    });
  }

  // ------------------------------------------------------- inatividade / trava

  function reiniciarRelogio() {
    if (!chave) return;
    clearTimeout(timerInatividade);
    timerInatividade = setTimeout(function () {
      trancar('Cofre trancado por inatividade.');
    }, MINUTOS_INATIVO * 60000);
  }

  function vigiarAtividade() {
    ['mousedown', 'keydown', 'wheel', 'touchstart'].forEach(function (evento) {
      document.addEventListener(evento, reiniciarRelogio, { passive: true });
    });
    reiniciarRelogio();
  }

  /** Esquece a chave e recarrega — a forma mais segura de limpar a memória. */
  function trancar(mensagem) {
    chave = null;
    clearTimeout(timerInatividade);
    sessionStorage.setItem('crm_aviso_trava', mensagem || 'Cofre trancado.');
    location.reload();
  }

  // ------------------------------------------------------------------- telas

  function telaBase(conteudo) {
    let tela = document.getElementById('tela-cofre');
    if (!tela) {
      tela = document.createElement('div');
      tela.id = 'tela-cofre';
      tela.className = 'tela-cofre';
      document.body.appendChild(tela);
    }
    tela.innerHTML = '<div class="cofre-caixa">' + conteudo + '</div>';
    document.body.classList.add('sem-scroll');
    return tela;
  }

  function fecharTela() {
    const tela = document.getElementById('tela-cofre');
    if (tela) tela.remove();
    document.body.classList.remove('sem-scroll');
  }

  const CADEADO =
    '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

  /** Tela de destravar, mostrada antes de qualquer dado aparecer. */
  function telaDestravar() {
    const aviso = sessionStorage.getItem('crm_aviso_trava');
    sessionStorage.removeItem('crm_aviso_trava');

    const tela = telaBase(
      '<span class="cofre-icone">' + CADEADO + '</span>' +
      '<h1>CRM trancado</h1>' +
      '<p class="cofre-texto">Digite sua senha para abrir os contatos.</p>' +
      (aviso ? '<p class="cofre-aviso-topo">' + UI.esc(aviso) + '</p>' : '') +
      '<form class="cofre-form">' +
        '<input type="password" name="senha" placeholder="Sua senha" autocomplete="current-password" ' +
               'autofocus required>' +
        '<button type="submit" class="btn btn-primario">Abrir</button>' +
      '</form>' +
      '<p class="cofre-erro" id="cofre-erro" hidden></p>' +
      '<p class="cofre-rodape">Os contatos estão criptografados neste computador. ' +
        'Sem a senha não há como abri-los — nem por aqui, nem pelos arquivos.</p>'
    );

    const form = tela.querySelector('form');
    const erro = tela.querySelector('#cofre-erro');
    let tentativas = 0;

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      const campo = form.querySelector('[name="senha"]');
      const botao = form.querySelector('button');
      botao.disabled = true;
      botao.textContent = 'Abrindo…';
      erro.hidden = true;

      abrir(campo.value).then(function (texto) {
        if (texto === null) {
          tentativas++;
          botao.disabled = false;
          botao.textContent = 'Abrir';
          erro.textContent = tentativas >= 3
            ? 'Senha incorreta. Lembre-se: maiúsculas e espaços contam.'
            : 'Senha incorreta.';
          erro.hidden = false;
          campo.select();
          return;
        }
        fecharTela();
        vigiarAtividade();
        aoDestravar(texto);
      });
    });
  }

  /** Tela de criação da senha, com backup obrigatório antes de ligar. */
  function telaCriar(aoConcluir) {
    const tela = telaBase(
      '<span class="cofre-icone">' + CADEADO + '</span>' +
      '<h1>Proteger com senha</h1>' +
      '<p class="cofre-texto">Os contatos passam a ser gravados criptografados neste ' +
        'computador — inclusive o arquivo de backup. Quem não tiver a senha não abre nada.</p>' +

      '<div class="cofre-alerta">' +
        '<strong>Não existe recuperação.</strong> Esquecendo a senha, os dados se perdem para ' +
        'sempre. Baixe uma cópia sem senha e guarde num lugar seguro antes de continuar.' +
      '</div>' +

      '<button type="button" class="btn btn-fantasma cofre-backup" data-backup>' +
        'Baixar cópia sem senha</button>' +

      '<form class="cofre-form cofre-form-criar">' +
        '<input type="password" name="senha" placeholder="Sua senha (ou frase)" ' +
               'autocomplete="new-password" required>' +
        '<input type="password" name="repetir" placeholder="Repita a senha" ' +
               'autocomplete="new-password" required>' +
        '<label class="cofre-confirma">' +
          '<input type="checkbox" name="ciente" required>' +
          '<span>Guardei uma cópia e entendo que sem a senha os dados se perdem.</span>' +
        '</label>' +
        '<div class="cofre-acoes">' +
          '<button type="button" class="btn btn-fantasma" data-cancelar>Agora não</button>' +
          '<button type="submit" class="btn btn-primario">Ligar o cofre</button>' +
        '</div>' +
      '</form>' +
      '<p class="cofre-erro" id="cofre-erro" hidden></p>' +
      '<p class="cofre-rodape">Dica: uma frase curta (<i>pao com manteiga 42</i>) é fácil de ' +
        'lembrar e difícil de adivinhar — bem melhor que uma palavra só.</p>'
    );

    const form = tela.querySelector('form');
    const erro = tela.querySelector('#cofre-erro');

    tela.querySelector('[data-backup]').addEventListener('click', function () {
      Exportar.backupJSON();
      Backup.registrarManual();
    });

    tela.querySelector('[data-cancelar]').addEventListener('click', function () {
      fecharTela();
      if (aoConcluir) aoConcluir(false);
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      const senha = form.querySelector('[name="senha"]').value;
      const repetir = form.querySelector('[name="repetir"]').value;
      const ciente = form.querySelector('[name="ciente"]').checked;

      function falhar(mensagem) {
        erro.textContent = mensagem;
        erro.hidden = false;
      }

      if (senha.length < 6) return falhar('Use pelo menos 6 caracteres — de preferência uma frase.');
      if (senha !== repetir) return falhar('As duas senhas não são iguais.');
      if (!ciente) return falhar('Confirme que você guardou uma cópia.');

      const botao = form.querySelector('button[type="submit"]');
      botao.disabled = true;
      botao.textContent = 'Criptografando…';

      criar(senha).then(function (ok) {
        if (!ok) {
          botao.disabled = false;
          botao.textContent = 'Ligar o cofre';
          return falhar('Não consegui ligar o cofre neste navegador.');
        }
        fecharTela();
        vigiarAtividade();
        if (aoConcluir) aoConcluir(true);
      });
    });
  }

  // ---------------------------------------------------------------------- API

  /** Liga o cofre pela primeira vez, cifrando o que já está gravado. */
  function criar(senha) {
    if (!suportado) return Promise.resolve(false);
    const salt = crypto.getRandomValues(new Uint8Array(16));

    return derivar(senha, salt, ITERACOES).then(function (novaChave) {
      return cifrarCom(novaChave, VERIFICACAO).then(function (verificacao) {
        chave = novaChave;
        config = {
          versao: 1,
          salt: paraBase64(salt),
          iteracoes: ITERACOES,
          verificacao: verificacao,
          criadoEm: new Date().toISOString()
        };
        localStorage.setItem(CHAVE_COFRE, JSON.stringify(config));
        // Regrava o que está em memória, agora cifrado
        return gravar(CHAVE_DADOS, DB.paraTexto()).then(function () { return true; });
      });
    }).catch(function (erro) {
      console.error('Falha ao criar o cofre:', erro);
      return false;
    });
  }

  /** Confere a senha e devolve o conteúdo decifrado (ou null se errou). */
  function abrir(senha) {
    const cfg = lerConfig();
    if (!cfg) return Promise.resolve(null);

    return derivar(senha, deBase64(cfg.salt), cfg.iteracoes || ITERACOES)
      .then(function (possivel) {
        return decifrarCom(possivel, cfg.verificacao).then(function (texto) {
          if (texto !== VERIFICACAO) return null;
          chave = possivel;
          return lerTexto(CHAVE_DADOS);
        });
      })
      .catch(function () { return null; });   // GCM falha = senha errada
  }

  /** Lê e decifra uma chave do localStorage. Devolve '' se não houver nada. */
  function lerTexto(nomeChave) {
    const cru = localStorage.getItem(nomeChave);
    if (!cru) return Promise.resolve('');
    let pacote;
    try {
      pacote = JSON.parse(cru);
    } catch (erro) {
      return Promise.resolve(cru);
    }
    if (!pacote || !pacote.cifrado) return Promise.resolve(cru);   // ainda em texto puro
    return decifrarCom(chave, pacote);
  }

  /** Cifra e grava. As gravações entram numa fila para não se atropelarem. */
  function gravar(nomeChave, texto) {
    if (!chave) {
      localStorage.setItem(nomeChave, texto);
      return Promise.resolve();
    }
    filaGravacao = filaGravacao.then(function () {
      return cifrarCom(chave, texto).then(function (pacote) {
        localStorage.setItem(nomeChave, JSON.stringify({ cifrado: 1, iv: pacote.iv, dados: pacote.dados }));
      });
    }).catch(function (erro) {
      console.error('Falha ao gravar cifrado:', erro);
    });
    return filaGravacao;
  }

  /** Troca a senha: confere a atual, deriva a nova e regrava tudo. */
  function trocarSenha(atual, nova) {
    return abrir(atual).then(function (texto) {
      if (texto === null) return { ok: false, erro: 'A senha atual não confere.' };
      return criar(nova).then(function (ok) {
        return ok ? { ok: true } : { ok: false, erro: 'Não consegui aplicar a senha nova.' };
      });
    });
  }

  /** Desliga o cofre: volta a gravar em texto puro (pede a senha antes). */
  function desligar(senha) {
    return abrir(senha).then(function (texto) {
      if (texto === null) return { ok: false, erro: 'Senha incorreta.' };
      chave = null;
      config = null;
      localStorage.removeItem(CHAVE_COFRE);
      localStorage.setItem(CHAVE_DADOS, texto);
      clearTimeout(timerInatividade);
      return { ok: true };
    });
  }

  return {
    suportado: suportado,
    MINUTOS_INATIVO: MINUTOS_INATIVO,

    /** true se este navegador já tem cofre configurado. */
    ligado: function () { return Boolean(lerConfig()); },

    /** true se o cofre está ligado E já foi aberto nesta sessão. */
    aberto: function () { return Boolean(chave); },

    /** Ponto de entrada do app: decide entre destravar, seguir ou nada. */
    iniciar: function (callbackDestravar) {
      aoDestravar = callbackDestravar || function () {};
      if (!this.ligado()) return false;   // sem cofre: o app segue normal
      telaDestravar();
      return true;                        // com cofre: a tela cuida do resto
    },

    /** Cifra/decifra um texto avulso — usado pelo arquivo de backup. */
    cifrarTexto: function (texto) { return cifrarCom(chave, texto); },
    decifrarTexto: function (pacote) { return decifrarCom(chave, pacote); },

    /* Ferramentas de criptografia reaproveitadas pela sincronização na nuvem,
       que deriva as próprias chaves a partir da mesma senha. */
    derivarChave: derivar,
    cifrarComChave: cifrarCom,
    decifrarComChave: decifrarCom,
    aleatorio: function (bytes) { return crypto.getRandomValues(new Uint8Array(bytes)); },
    paraBase64: paraBase64,
    deBase64: deBase64,

    /** Usa uma chave vinda de fora (a nuvem) como chave do cofre local. */
    usarChave: function (novaChave) {
      chave = novaChave;
      vigiarAtividade();
    },

    criar: criar,
    abrir: abrir,
    telaBase: telaBase,
    fecharTela: fecharTela,
    CADEADO: CADEADO,
    telaCriar: telaCriar,
    trocarSenha: trocarSenha,
    desligar: desligar,
    trancar: trancar,
    gravar: gravar,
    lerTexto: lerTexto,
    /** Cópia local dos contatos, já decifrada (usada quando falta internet). */
    lerCache: function () { return lerTexto(CHAVE_DADOS); },
    criadoEm: function () { const c = lerConfig(); return c ? c.criadoEm : null; }
  };
})();

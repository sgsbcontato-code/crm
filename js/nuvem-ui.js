/* =============================================================================
   nuvem-ui.js — Telas da sincronização: conectar ao GitHub, entrar com a senha,
   indicador de estado e resolução de conflito.

   A lógica está em nuvem.js; aqui é só a parte visível.
   ============================================================================= */

const NuvemUI = (function () {
  'use strict';

  const ROTULOS = {
    desligada:    { texto: 'Só neste computador',  classe: '' },
    sincronizado: { texto: 'Sincronizado',         classe: 'nuvem-ok' },
    enviando:     { texto: 'Enviando…',            classe: 'nuvem-ativa' },
    pendente:     { texto: 'Pendente',             classe: 'nuvem-ativa' },
    offline:      { texto: 'Sem conexão',          classe: 'nuvem-alerta' },
    conflito:     { texto: 'Conflito',             classe: 'nuvem-alerta' }
  };

  const ICONE_NUVEM =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 9.2 4 4 0 0 0 7 19z"/></svg>';

  // ---------------------------------------------------------------- indicador

  function renderEstado() {
    const pill = document.getElementById('pill-nuvem');
    if (!pill) return;
    if (!Nuvem.configurada()) { pill.hidden = true; return; }

    const info = ROTULOS[Nuvem.estado()] || ROTULOS.desligada;
    pill.hidden = false;
    pill.className = 'pill-nuvem ' + info.classe;
    pill.innerHTML = ICONE_NUVEM + '<span>' + UI.esc(info.texto) + '</span>';
    pill.title = 'Sincronizando com ' + (Nuvem.onde() || 'GitHub') + ' — ' + info.texto;
  }

  // ------------------------------------------------- tela de entrada (senha)

  /** Tela cheia pedindo a senha quando este aparelho já está conectado. */
  function telaEntrar(aoAbrir) {
    const tela = Cofre.telaBase(
      '<span class="cofre-icone">' + Cofre.CADEADO + '</span>' +
      '<h1>CRM na nuvem</h1>' +
      '<p class="cofre-texto">Digite sua senha para baixar e abrir os contatos de ' +
        '<b>' + UI.esc(Nuvem.onde() || '') + '</b>.</p>' +
      '<form class="cofre-form">' +
        '<input type="password" name="senha" placeholder="Sua senha" ' +
               'autocomplete="current-password" autofocus required>' +
        '<button type="submit" class="btn btn-primario">Entrar</button>' +
      '</form>' +
      '<p class="cofre-erro" id="cofre-erro" hidden></p>' +
      '<div id="cofre-extra" hidden>' +
        '<button type="button" class="btn btn-fantasma cofre-backup" data-offline>' +
          'Seguir com a cópia deste computador</button>' +
      '</div>' +
      '<p class="cofre-rodape">Os dados viajam criptografados: o GitHub guarda um bloco ' +
        'embaralhado que só a sua senha abre.</p>'
    );

    const form = tela.querySelector('form');
    const erro = tela.querySelector('#cofre-erro');
    const extra = tela.querySelector('#cofre-extra');

    function seguir(texto) {
      Cofre.fecharTela();
      DB.carregarDeTexto(texto || '[]');
      aoAbrir();
    }

    tela.querySelector('[data-offline]').addEventListener('click', function () {
      Cofre.lerCache().then(function (texto) {
        Nuvem.seguirLocal();
        seguir(texto);
        UI.toast('Trabalhando offline — sincronizo quando a conexão voltar.', 'aviso');
      });
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      const botao = form.querySelector('button');
      botao.disabled = true;
      botao.textContent = 'Abrindo…';
      erro.hidden = true;

      Nuvem.entrar(form.querySelector('[name="senha"]').value).then(function (r) {
        botao.disabled = false;
        botao.textContent = 'Entrar';

        if (r.ok) {
          if (r.texto === null) {
            return Cofre.lerCache().then(function (local) {
              seguir(local);
              if (r.aviso) UI.toast(r.aviso, 'aviso');
            });
          }
          return seguir(r.texto);
        }
        erro.textContent = r.erro;
        erro.hidden = false;
        if (r.offline) extra.hidden = false;   // senha certa, faltou internet
      });
    });
  }

  // ------------------------------------------------------ tela de conexão

  function abrirConexao(aoConectar) {
    const html =
      '<form class="form-nuvem" novalidate>' +
        '<header class="modal-topo">' +
          '<div><h2>Conectar ao GitHub</h2>' +
            '<p class="modal-subtitulo">Seus contatos passam a viver num repositório ' +
              '<b>privado</b> seu, criptografados. Assim você abre o CRM de qualquer ' +
              'computador ou do celular, de graça.</p></div>' +
          '<button type="button" class="icone-btn" data-fechar title="Fechar">' + UI.ICONES.fechar + '</button>' +
        '</header>' +

        '<ol class="passos-nuvem">' +
          '<li>Crie um repositório <b>privado</b> no GitHub (ex.: <code>crm-dados</code>).</li>' +
          '<li>Gere um token em <b>Settings → Developer settings → Personal access tokens → ' +
            'Fine-grained tokens</b>, com acesso <b>só a esse repositório</b> e a permissão ' +
            '<b>Contents: Read and write</b>.</li>' +
          '<li>Preencha abaixo. O token fica guardado neste aparelho criptografado pela sua senha.</li>' +
        '</ol>' +

        '<div class="form-grade">' +
          '<label class="campo"><span>Seu usuário do GitHub</span>' +
            '<input type="text" name="dono" placeholder="ex.: sgsb" autocomplete="off" data-foco required></label>' +
          '<label class="campo"><span>Repositório privado</span>' +
            '<input type="text" name="repo" placeholder="crm-dados" autocomplete="off" required></label>' +
          '<label class="campo campo-largo"><span>Token de acesso</span>' +
            '<input type="password" name="token" placeholder="github_pat_…" autocomplete="off" required></label>' +
          '<label class="campo campo-largo"><span>Senha do CRM</span>' +
            '<input type="password" name="senha" placeholder="a mesma senha em todos os aparelhos" ' +
                   'autocomplete="new-password" required>' +
            '<small class="ajuda">É ela que abre os dados. Sem ela, nem você nem o GitHub conseguem ler.</small></label>' +
          '<label class="campo campo-largo"><span>Nome do arquivo</span>' +
            '<input type="text" name="arquivo" value="crm-dados.json" autocomplete="off"></label>' +
        '</div>' +

        '<div class="cofre-alerta">Se o repositório já tiver uma base do CRM, ela vence: os ' +
          'contatos de lá substituem os deste computador. Se estiver vazio, o que está aqui sobe.</div>' +

        '<p class="cofre-erro" id="erro-nuvem" hidden></p>' +
        '<footer class="modal-acoes">' +
          '<span class="espaco"></span>' +
          '<button type="button" class="btn btn-fantasma" data-fechar>Cancelar</button>' +
          '<button type="submit" class="btn btn-primario">Conectar</button>' +
        '</footer>' +
      '</form>';

    UI.abrirModal(html, function (caixa) {
      const form = caixa.querySelector('form');
      const erro = caixa.querySelector('#erro-nuvem');
      const botao = form.querySelector('button[type="submit"]');

      function falhar(mensagem) {
        erro.textContent = mensagem;
        erro.hidden = false;
        botao.disabled = false;
        botao.textContent = 'Conectar';
      }

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        const dados = {};
        new FormData(form).forEach(function (v, k) { dados[k] = String(v).trim(); });

        if (!dados.dono || !dados.repo || !dados.token) {
          return falhar('Preencha usuário, repositório e token.');
        }
        if (dados.senha.length < 6) return falhar('A senha precisa de pelo menos 6 caracteres.');

        botao.disabled = true;
        botao.textContent = 'Conferindo…';

        Nuvem.testarAcesso(dados).then(function (teste) {
          if (!teste.ok) return falhar(teste.erro);
          botao.textContent = 'Conectando…';

          return Nuvem.conectar(dados).then(function (r) {
            if (!r.ok) return falhar(r.erro);
            if (r.veioDoRepositorio && r.texto !== null) DB.carregarDeTexto(r.texto);
            UI.fecharModal();
            UI.toast(r.veioDoRepositorio
              ? 'Conectado — contatos baixados do repositório.'
              : 'Conectado — seus contatos foram enviados para o repositório.');
            renderEstado();
            aoConectar();
          });
        });
      });
    });
  }

  // --------------------------------------------- bloco dentro de Segurança

  function blocoHTML() {
    if (!Nuvem.configurada()) {
      return '<div class="backup-manual">' +
        '<h3>Usar em vários computadores</h3>' +
        '<p>Guarde os contatos criptografados num repositório privado do GitHub e abra o CRM ' +
          'de qualquer lugar, inclusive do celular. É gratuito, e cada gravação vira uma ' +
          'versão no histórico.</p>' +
        '<div class="backup-acoes">' +
          '<button type="button" class="btn btn-primario" data-conectar-nuvem>Conectar ao GitHub</button>' +
        '</div></div>';
    }

    const info = ROTULOS[Nuvem.estado()] || ROTULOS.desligada;
    return '<div class="backup-manual">' +
      '<h3>Sincronização</h3>' +
      '<p>Conectado a <b>' + UI.esc(Nuvem.onde()) + '</b> · ' + UI.esc(info.texto) + '. ' +
        'Cada gravação vira um commit — o histórico do repositório é o seu backup.</p>' +
      '<div class="backup-acoes">' +
        '<button type="button" class="btn btn-fantasma" data-enviar-nuvem>Enviar agora</button>' +
        '<button type="button" class="btn btn-fantasma" data-puxar-nuvem>Puxar do repositório</button>' +
        '<button type="button" class="btn btn-fantasma" data-trocar-nuvem>Trocar a senha</button>' +
        '<button type="button" class="btn btn-fantasma" data-sair-nuvem>Desconectar este aparelho</button>' +
      '</div></div>';
  }

  /** `acoes` traz { render, pedirSenhas } vindos do app. */
  function ligarBotoes(caixa, acoes) {
    function ligar(seletor, funcao) {
      const botao = caixa.querySelector(seletor);
      if (botao) botao.addEventListener('click', funcao);
    }

    ligar('[data-conectar-nuvem]', function () {
      UI.fecharModal();
      abrirConexao(acoes.render);
    });

    ligar('[data-enviar-nuvem]', function () {
      Nuvem.enviarAgora().then(function (ok) {
        UI.toast(ok ? 'Enviado para o repositório.' : 'Não consegui enviar agora.', ok ? 'ok' : 'erro');
        renderEstado();
      });
    });

    ligar('[data-puxar-nuvem]', function () {
      UI.confirmar('Puxar do repositório',
                   'O que está neste computador será substituído pelo que está no GitHub.',
                   'Puxar').then(function (ok) {
        if (!ok) return;
        Nuvem.puxarDoRepositorio().then(function (texto) {
          if (texto === null) { UI.toast('O repositório ainda não tem dados.', 'aviso'); return; }
          DB.carregarDeTexto(texto);
          DB.substituirTudo(DB.listar());   // regrava a cópia local
          UI.fecharModal();
          UI.toast('Contatos atualizados a partir do repositório.');
          acoes.render();
        });
      });
    });

    ligar('[data-trocar-nuvem]', function () {
      UI.fecharModal();
      acoes.pedirSenhas('Trocar a senha da nuvem',
                        'A nova senha vale em todos os aparelhos: nos outros será preciso ' +
                        'digitar a nova na próxima abertura.',
                        true, function (atual, nova, mostrarErro) {
        Nuvem.trocarSenha(atual, nova).then(function (r) {
          if (!r.ok) return mostrarErro(r.erro);
          UI.fecharModal();
          UI.toast('Senha trocada e dados regravados no repositório.');
        });
      });
    });

    ligar('[data-sair-nuvem]', function () {
      UI.confirmar('Desconectar este aparelho',
                   'O token guardado aqui será apagado e este computador para de sincronizar. ' +
                   'Os contatos continuam no repositório e na cópia local.',
                   'Desconectar').then(function (ok) {
        if (!ok) return;
        Nuvem.desconectar();
        UI.fecharModal();
        UI.toast('Aparelho desconectado.');
        renderEstado();
        acoes.render();
      });
    });
  }

  // -------------------------------------------------------------- conflito

  /** Outro aparelho gravou enquanto você editava aqui. */
  function tratarConflito(dados, aoResolver) {
    const meus = DB.listar().length;
    let deLa = 0;
    try { deLa = JSON.parse(dados.textoServidor).length; } catch (erro) { deLa = 0; }

    const html =
      '<div class="conflito">' +
        '<header class="modal-topo">' +
          '<div><h2>Duas versões diferentes</h2>' +
            '<p class="modal-subtitulo">Outro aparelho gravou no repositório enquanto você ' +
              'editava aqui. Escolha qual vale — a outra não se perde, fica no histórico ' +
              'do GitHub.</p></div>' +
        '</header>' +

        '<div class="conflito-lados">' +
          '<div class="conflito-lado">' +
            '<h3>Deste computador</h3>' +
            '<strong>' + meus + '</strong><span>contatos</span>' +
            '<button type="button" class="btn btn-primario" data-meu>Manter esta</button>' +
          '</div>' +
          '<div class="conflito-lado">' +
            '<h3>Do repositório</h3>' +
            '<strong>' + deLa + '</strong><span>contatos</span>' +
            (dados.atualizadoEm
              ? '<small>gravada em ' + UI.data(String(dados.atualizadoEm).slice(0, 10)) + '</small>'
              : '<small>&nbsp;</small>') +
            '<button type="button" class="btn btn-fantasma" data-servidor>Usar esta</button>' +
          '</div>' +
        '</div>' +

        '<p class="conflito-dica">Na dúvida, ' +
          '<button type="button" class="link-secundario" data-copia>baixe uma cópia do que está ' +
          'aqui</button> antes de decidir.</p>' +
      '</div>';

    UI.abrirModal(html, function (caixa) {
      caixa.querySelector('[data-copia]').addEventListener('click', function () {
        Exportar.backupJSON(true);
      });
      caixa.querySelector('[data-meu]').addEventListener('click', function () {
        Nuvem.resolverConflito('meu', dados).then(function () {
          UI.fecharModal();
          UI.toast('Sua versão foi enviada para o repositório.');
          aoResolver();
        });
      });
      caixa.querySelector('[data-servidor]').addEventListener('click', function () {
        Nuvem.resolverConflito('servidor', dados).then(function () {
          UI.fecharModal();
          UI.toast('Versão do repositório carregada.');
          aoResolver();
        });
      });
    });
  }

  return {
    renderEstado: renderEstado,
    telaEntrar: telaEntrar,
    abrirConexao: abrirConexao,
    blocoHTML: blocoHTML,
    ligarBotoes: ligarBotoes,
    tratarConflito: tratarConflito
  };
})();

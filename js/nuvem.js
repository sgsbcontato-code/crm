/* =============================================================================
   nuvem.js — Sincronização pelo GitHub, para usar o CRM em vários computadores
   e no celular com os mesmos dados.

   Não existe servidor: o app conversa direto com a API do GitHub e guarda um
   único arquivo num repositório privado seu. O conteúdo vai CRIPTOGRAFADO —
   o GitHub enxerga só um bloco embaralhado.

   O arquivo tem uma parte aberta e uma fechada:
     { versao, salt, iteracoes, verificacao, iv, dados }
   O `salt` precisa ficar visível porque é ele que permite a um computador novo
   derivar a mesma chave a partir da sua senha. Ele não é segredo — segredo é a
   senha, que nunca sai do navegador.

   Conflito: o GitHub exige o `sha` do arquivo atual para gravar por cima. Se
   outro aparelho gravou antes, a chamada falha e o app pergunta qual versão
   vale — em vez de sobrescrever calado.

   Sem internet o app segue funcionando com a cópia local e sobe as alterações
   quando a conexão voltar.
   ============================================================================= */

const Nuvem = (function () {
  'use strict';

  const CHAVE_CONFIG = 'crm_nuvem_v1';
  const ITERACOES = 400000;
  const ESPERA_ENVIO = 2000;     // agrupa alterações antes de subir (ms)
  const RETENTAR = 60000;        // nova tentativa quando está offline
  const VERIFICACAO = 'crm-nuvem-ok';
  const API = 'https://api.github.com';

  let config = null;      // { dono, repo, arquivo, tokenCifrado, salt, iteracoes }
  let token = null;       // só em memória, depois de decifrado
  let chave = null;       // CryptoKey derivada da senha
  let sha = null;         // sha do arquivo no GitHub (controle de versão)
  let ligada = false;
  let estado = 'desligada';   // desligada | sincronizado | enviando | pendente | offline | conflito
  let timerEnvio = null;
  let timerRetentar = null;
  let aoMudar = function () {};
  let aoConflito = function () {};

  // ------------------------------------------------------------- utilidades

  function definirEstado(novo) {
    if (estado === novo) return;
    estado = novo;
    aoMudar(estado);
  }

  function lerConfig() {
    if (config !== null) return config;
    try {
      config = JSON.parse(localStorage.getItem(CHAVE_CONFIG) || 'null');
    } catch (erro) {
      console.error('Configuração da nuvem ilegível:', erro);
      config = null;
    }
    return config;
  }

  function gravarConfig(nova) {
    config = nova;
    localStorage.setItem(CHAVE_CONFIG, JSON.stringify(nova));
  }

  /** Texto → base64 aguentando acento (o GitHub exige base64). */
  function paraBase64Utf8(texto) {
    return Cofre.paraBase64(new TextEncoder().encode(texto));
  }

  function deBase64Utf8(base64) {
    return new TextDecoder().decode(Cofre.deBase64(base64.replace(/\s/g, '')));
  }

  function chamarGitHub(caminho, opcoes) {
    const cfg = lerConfig();
    return fetch(API + '/repos/' + cfg.dono + '/' + cfg.repo + '/contents/' + cfg.arquivo + (caminho || ''),
      Object.assign({
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }, opcoes || {}));
  }

  // -------------------------------------------------------- ler e gravar

  /** Monta o arquivo que vai para o GitHub: parte aberta + conteúdo cifrado. */
  function empacotar(texto) {
    return Promise.all([
      Cofre.cifrarComChave(chave, texto),
      Cofre.cifrarComChave(chave, VERIFICACAO)
    ]).then(function (par) {
      return JSON.stringify({
        aviso: 'CRM Local — conteudo criptografado. Sem a senha nao ha como abrir.',
        versao: 1,
        salt: config.salt,
        iteracoes: config.iteracoes,
        verificacao: par[1],
        iv: par[0].iv,
        dados: par[0].dados,
        atualizadoEm: new Date().toISOString()
      }, null, 2);
    });
  }

  function desempacotar(arquivo) {
    if (!arquivo || !arquivo.dados) return Promise.resolve('[]');
    return Cofre.decifrarComChave(chave, { iv: arquivo.iv, dados: arquivo.dados });
  }

  /** Baixa o arquivo do repositório. Devolve { arquivo, sha } ou null se ainda
      não existe (repositório recém-criado). */
  function baixarArquivo() {
    return chamarGitHub('', { cache: 'no-store' }).then(function (resposta) {
      if (resposta.status === 404) return null;
      if (resposta.status === 401 || resposta.status === 403) {
        throw new Error('O GitHub recusou o token (' + resposta.status + ').');
      }
      if (!resposta.ok) throw new Error('GitHub respondeu ' + resposta.status + '.');
      return resposta.json().then(function (r) {
        let conteudo;
        try {
          conteudo = JSON.parse(deBase64Utf8(r.content));
        } catch (erro) {
          throw new Error('O arquivo no repositório não está no formato esperado.');
        }
        return { arquivo: conteudo, sha: r.sha };
      });
    });
  }

  /** Grava o arquivo. `sha` atual é obrigatório quando o arquivo já existe. */
  function gravarArquivo(texto, mensagem) {
    return empacotar(texto).then(function (conteudo) {
      const corpo = {
        message: mensagem || 'CRM: ' + new Date().toLocaleString('pt-BR'),
        content: paraBase64Utf8(conteudo)
      };
      if (sha) corpo.sha = sha;

      return chamarGitHub('', {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(corpo)
      });
    });
  }

  // ------------------------------------------------------------------ envio

  function enviarAgora() {
    if (!ligada) return Promise.resolve(false);
    definirEstado('enviando');

    return gravarArquivo(DB.paraTexto())
      .then(function (resposta) {
        // 409 = outro aparelho gravou depois de mim; 422 = sha desatualizado
        if (resposta.status === 409 || resposta.status === 422) {
          definirEstado('conflito');
          return baixarArquivo().then(function (r) {
            if (!r) { definirEstado('pendente'); return false; }
            return desempacotar(r.arquivo).then(function (texto) {
              aoConflito({ shaServidor: r.sha, textoServidor: texto,
                           atualizadoEm: r.arquivo.atualizadoEm });
              return false;
            });
          });
        }
        if (!resposta.ok) throw new Error('GitHub respondeu ' + resposta.status);

        return resposta.json().then(function (r) {
          sha = r.content.sha;
          definirEstado('sincronizado');
          return true;
        });
      })
      .catch(function (erro) {
        console.warn('Sincronização adiada:', erro.message);
        definirEstado('offline');
        agendarRetentativa();
        return false;
      });
  }

  function agendarEnvio() {
    if (!ligada) return;
    definirEstado('pendente');
    clearTimeout(timerEnvio);
    timerEnvio = setTimeout(enviarAgora, ESPERA_ENVIO);
  }

  function agendarRetentativa() {
    clearTimeout(timerRetentar);
    timerRetentar = setTimeout(function () {
      if (estado === 'offline' || estado === 'pendente') enviarAgora();
    }, RETENTAR);
  }

  // ---------------------------------------------------------------------- API

  return {
    ITERACOES: ITERACOES,

    configurada: function () { return Boolean(lerConfig()); },
    ligada: function () { return ligada; },
    estado: function () { return estado; },
    onde: function () {
      const c = lerConfig();
      return c ? c.dono + '/' + c.repo : null;
    },

    aoMudarEstado: function (fn) { aoMudar = fn || function () {}; },
    aoDetectarConflito: function (fn) { aoConflito = fn || function () {}; },

    /** Confere se o token enxerga o repositório antes de gravar qualquer coisa. */
    testarAcesso: function (dados) {
      return fetch(API + '/repos/' + dados.dono + '/' + dados.repo, {
        headers: {
          'Authorization': 'Bearer ' + dados.token,
          'Accept': 'application/vnd.github+json'
        }
      }).then(function (resposta) {
        if (resposta.status === 401) {
          return { ok: false, erro: 'Token inválido ou expirado.' };
        }
        if (resposta.status === 404) {
          return { ok: false, erro: 'Repositório não encontrado, ou o token não tem acesso a ele. ' +
                                    'Confira o dono e o nome, e se o token liberou este repositório.' };
        }
        if (!resposta.ok) return { ok: false, erro: 'GitHub respondeu ' + resposta.status + '.' };
        return resposta.json().then(function (r) {
          if (!r.private) {
            return { ok: false, erro: 'Este repositório é PÚBLICO. Use um repositório privado — ' +
                                      'mesmo criptografado, seus dados não devem ficar expostos.' };
          }
          if (!r.permissions || !r.permissions.push) {
            return { ok: false, erro: 'O token só tem leitura. Ele precisa de permissão de escrita ' +
                                      '(Contents: Read and write).' };
          }
          return { ok: true, repo: r.full_name };
        });
      }).catch(function (erro) {
        return { ok: false, erro: 'Não consegui falar com o GitHub: ' + erro.message };
      });
    },

    /** Primeira conexão neste aparelho. Se o repositório já tiver dados, eles
        vencem; se estiver vazio, sobe o que existe aqui. */
    conectar: function (dados) {
      const primeiraVez = !dados.salt;
      const salt = dados.salt || Cofre.paraBase64(Cofre.aleatorio(16));

      return Cofre.derivarChave(dados.senha, Cofre.deBase64(salt), ITERACOES)
        .then(function (novaChave) {
          chave = novaChave;
          token = dados.token;
          gravarConfig({
            dono: dados.dono,
            repo: dados.repo,
            arquivo: dados.arquivo || 'crm-dados.json',
            salt: salt,
            iteracoes: ITERACOES,
            tokenCifrado: null
          });
          return baixarArquivo();
        })
        .then(function (existente) {
          // O repositório já tem uma base: a senha precisa abri-la
          if (existente && existente.arquivo && existente.arquivo.verificacao) {
            const arquivo = existente.arquivo;
            return Cofre.derivarChave(dados.senha, Cofre.deBase64(arquivo.salt),
                                      arquivo.iteracoes || ITERACOES)
              .then(function (chaveDoArquivo) {
                return Cofre.decifrarComChave(chaveDoArquivo, arquivo.verificacao)
                  .then(function (texto) {
                    if (texto !== VERIFICACAO) throw new Error('verificacao');
                    chave = chaveDoArquivo;
                    sha = existente.sha;
                    config.salt = arquivo.salt;
                    config.iteracoes = arquivo.iteracoes || ITERACOES;
                    return desempacotar(arquivo);
                  })
                  .then(function (texto) {
                    return { ok: true, texto: texto, veioDoRepositorio: true };
                  });
              })
              .catch(function () {
                return { ok: false, erro: 'Este repositório já tem uma base do CRM, mas a senha ' +
                                          'digitada não abre. Use a mesma senha do outro computador.' };
              });
          }

          // Repositório vazio: sobe o que está aqui
          if (!primeiraVez) sha = null;
          return gravarArquivo(DB.paraTexto(), 'CRM: primeira gravacao')
            .then(function (resposta) {
              if (!resposta.ok) throw new Error('GitHub respondeu ' + resposta.status);
              return resposta.json();
            })
            .then(function (r) {
              sha = r.content.sha;
              return { ok: true, texto: null, veioDoRepositorio: false };
            });
        })
        .then(function (resultado) {
          if (!resultado.ok) return resultado;
          // Guarda o token cifrado com a mesma chave da senha
          return Cofre.cifrarComChave(chave, token).then(function (pacote) {
            config.tokenCifrado = pacote;
            gravarConfig(config);
            ligada = true;
            Cofre.usarChave(chave);
            definirEstado('sincronizado');
            return resultado;
          });
        })
        .catch(function (erro) {
          return { ok: false, erro: erro.message || 'Não consegui conectar.' };
        });
    },

    /** Abertura normal: senha → decifra o token → baixa a base. */
    entrar: function (senha) {
      const cfg = lerConfig();
      if (!cfg) return Promise.resolve({ ok: false, erro: 'Nenhuma nuvem configurada.' });

      return Cofre.derivarChave(senha, Cofre.deBase64(cfg.salt), cfg.iteracoes || ITERACOES)
        .then(function (novaChave) {
          chave = novaChave;
          return Cofre.decifrarComChave(chave, cfg.tokenCifrado);
        })
        .catch(function () { throw new Error('senha'); })
        .then(function (tokenAberto) {
          token = tokenAberto;
          // Senha conferida: a chave passa a valer para a cópia local também
          Cofre.usarChave(chave);
          return baixarArquivo();
        })
        .then(function (r) {
          if (!r) {   // arquivo sumiu do repositório
            ligada = true;
            sha = null;
            definirEstado('pendente');
            return { ok: true, texto: null, aviso: 'O arquivo não está mais no repositório. ' +
                                                   'O que estiver aqui será enviado.' };
          }
          sha = r.sha;
          return desempacotar(r.arquivo).then(function (texto) {
            ligada = true;
            Cofre.usarChave(chave);
            definirEstado('sincronizado');
            return { ok: true, texto: texto };
          });
        })
        .catch(function (erro) {
          if (erro.message === 'senha') return { ok: false, erro: 'Senha incorreta.' };
          // Sem rede: dá para seguir com a cópia local
          return { ok: false, offline: true, erro: erro.message };
        });
    },

    /** Segue offline com a cópia local já decifrada pela senha. */
    seguirLocal: function () {
      ligada = false;
      definirEstado('offline');
    },

    desconectar: function () {
      localStorage.removeItem(CHAVE_CONFIG);
      config = null;
      token = null;
      ligada = false;
      definirEstado('desligada');
    },

    agendarEnvio: agendarEnvio,
    enviarAgora: enviarAgora,
    baixarArquivo: baixarArquivo,
    desempacotar: desempacotar,

    /** Confere se outro aparelho gravou. Devolve { mudou, texto }. */
    conferirNovidades: function () {
      if (!ligada) return Promise.resolve({ mudou: false });
      return baixarArquivo().then(function (r) {
        if (!r || r.sha === sha) return { mudou: false };
        sha = r.sha;
        return desempacotar(r.arquivo).then(function (texto) {
          definirEstado('sincronizado');
          return { mudou: true, texto: texto, atualizadoEm: r.arquivo.atualizadoEm };
        });
      }).catch(function () {
        definirEstado('offline');
        return { mudou: false };
      });
    },

    /** Puxa o que estiver no repositório, descartando o que está aqui. */
    puxarDoRepositorio: function () {
      return baixarArquivo().then(function (r) {
        if (!r) return null;
        sha = r.sha;
        return desempacotar(r.arquivo).then(function (texto) {
          definirEstado('sincronizado');
          return texto;
        });
      });
    },

    /** Resolve o conflito: 'servidor' aceita o que veio, 'meu' sobrescreve. */
    resolverConflito: function (lado, dadosConflito) {
      if (lado === 'servidor') {
        sha = dadosConflito.shaServidor;
        DB.carregarDeTexto(dadosConflito.textoServidor);
        definirEstado('sincronizado');
        return Promise.resolve(true);
      }
      sha = dadosConflito.shaServidor;   // grava por cima da versão de lá
      return enviarAgora();
    },

    /** Troca a senha: nova chave, novo sal, arquivo e token regravados. */
    trocarSenha: function (senhaAtual, senhaNova) {
      const cfg = lerConfig();
      return Cofre.derivarChave(senhaAtual, Cofre.deBase64(cfg.salt), cfg.iteracoes || ITERACOES)
        .then(function (chaveAtual) {
          return Cofre.decifrarComChave(chaveAtual, cfg.tokenCifrado);
        })
        .catch(function () { throw new Error('senha'); })
        .then(function (tokenAberto) {
          token = tokenAberto;
          const saltNovo = Cofre.paraBase64(Cofre.aleatorio(16));
          return Cofre.derivarChave(senhaNova, Cofre.deBase64(saltNovo), ITERACOES)
            .then(function (chaveNova) {
              chave = chaveNova;
              config.salt = saltNovo;
              config.iteracoes = ITERACOES;
              return Cofre.cifrarComChave(chaveNova, token);
            })
            .then(function (pacote) {
              config.tokenCifrado = pacote;
              gravarConfig(config);
              return gravarArquivo(DB.paraTexto(), 'CRM: troca de senha');
            })
            .then(function (resposta) {
              if (!resposta.ok) throw new Error('GitHub respondeu ' + resposta.status);
              return resposta.json();
            })
            .then(function (r) {
              sha = r.content.sha;
              Cofre.usarChave(chave);
              return { ok: true };
            });
        })
        .catch(function (erro) {
          if (erro.message === 'senha') return { ok: false, erro: 'A senha atual não confere.' };
          return { ok: false, erro: erro.message };
        });
    }
  };
})();

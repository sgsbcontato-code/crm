/* =============================================================================
   exportar.js — Exportação CSV (para Excel pt-BR) e backup/restauração JSON.
   ============================================================================= */

const Exportar = (function () {
  'use strict';

  /* Colunas do CSV na mesma ordem da tabela. */
  const COLUNAS = [
    ['dataCriacao',       'Data de Criação'],
    ['nome',              'Nome'],
    ['email',             'E-mail'],
    ['telefone',          'Telefone'],
    ['cargo',             'Cargo'],
    ['empresa',           'Empresa/Origem'],
    ['cidade',            'Cidade'],
    ['uf',                'UF'],
    ['etapa',             'Etapa do Funil'],
    ['etapaDesde',        'Nesta Etapa Desde'],
    ['diasNaEtapa',       'Dias na Etapa'],       // calculado
    ['proximoContato',    'Próximo Contato'],
    ['ultimoContato',     'Último Contato'],     // calculado
    ['totalContatos',     'Contatos Registrados'],
    ['aniversario',       'Aniversário'],
    ['dataEspecial',      'Data Especial'],
    ['dataEspecialNome',  'O Que É a Data'],
    ['prazoIdeal',        'Prazo Ideal (dias)'],  // calculado
    ['situacao',          'Situação'],            // calculado
    ['observacoes',       'Observações']
  ];

  const ROTULO_SITUACAO = {
    atrasado: 'Fora do prazo',
    atencao:  'No limite',
    ok:       'Dentro do prazo',
    neutro:   'Sem prazo'
  };

  const SEP = ';'; // Excel em português usa ponto e vírgula como separador

  function celula(valor) {
    const s = String(valor == null ? '' : valor);
    if (s.indexOf(SEP) > -1 || s.indexOf('"') > -1 || /[\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function carimbo() {
    return new Date().toISOString().slice(0, 10);
  }

  function paraCSV(leads) {
    const linhas = [COLUNAS.map(function (c) { return celula(c[1]); }).join(SEP)];

    leads.forEach(function (lead) {
      linhas.push(COLUNAS.map(function (c) {
        const campo = c[0];
        if (campo === 'dataCriacao' || campo === 'etapaDesde') return celula(UI.data(lead[campo]));
        if (campo === 'proximoContato' || campo === 'dataEspecial' || campo === 'aniversario') {
          return celula(lead[campo] ? UI.data(lead[campo]) : '');
        }
        if (campo === 'ultimoContato') {
          const ultimo = DB.ultimoContato(lead);
          return celula(ultimo ? UI.data(ultimo.data) + ' (' + ultimo.canal + ')' : '');
        }
        if (campo === 'totalContatos') return celula(lead.contatos.length);
        if (campo === 'etapa') return celula(DB.nomeEtapa(lead.etapa));   // exporta o nome
        if (campo === 'diasNaEtapa') return celula(DB.diasNaEtapa(lead));
        if (campo === 'prazoIdeal') return celula(DB.prazoDe(lead.etapa) || '');
        if (campo === 'situacao') return celula(ROTULO_SITUACAO[DB.situacao(lead)]);
        return celula(lead[campo]);
      }).join(SEP));
    });

    // O BOM (U+FEFF) faz o Excel abrir o arquivo em UTF-8 e manter os acentos.
    return '\uFEFF' + linhas.join('\r\n');
  }

  return {
    /** Exporta a lista recebida (normalmente o resultado do filtro atual). */
    csv: function (leads) {
      if (!leads.length) { UI.toast('Nada para exportar com os filtros atuais.', 'aviso'); return; }
      UI.baixarArquivo('leads_' + carimbo() + '.csv', paraCSV(leads), 'text/csv;charset=utf-8');
      UI.toast(leads.length + (leads.length === 1 ? ' lead exportado' : ' leads exportados') + ' em CSV.');
    },

    /** Backup completo (ignora filtros) em JSON: contatos, etapas e mensagens.
        Com o cofre ligado o arquivo sai criptografado; `semSenha` força a cópia
        em texto puro (a saída de emergência, usada antes de criar a senha). */
    backupJSON: function (semSenha) {
      const dados = {
        versao: 1,
        geradoEm: new Date().toISOString(),
        leads: DB.listar(),
        etapas: DB.etapas(),
        modelos: DB.modelos()
      };
      const texto = JSON.stringify(dados, null, 2);
      const protegido = !semSenha && typeof Cofre !== 'undefined' && Cofre.aberto();

      const pronto = protegido
        ? Cofre.cifrarTexto(texto).then(function (p) {
            return JSON.stringify({
              cifrado: 1,
              aviso: 'Backup protegido pela senha do CRM Local. Sem ela não há como abrir.',
              iv: p.iv, dados: p.dados
            }, null, 2);
          })
        : Promise.resolve(texto);

      return pronto.then(function (conteudo) {
        UI.baixarArquivo('crm_backup_' + carimbo() + (protegido ? '' : '_sem_senha') + '.json',
                         conteudo, 'application/json;charset=utf-8');
        UI.toast('Backup gerado com ' + dados.leads.length + ' leads' +
                 (protegido ? ' (protegido pela senha).' : ' em texto puro — guarde bem.'));
      });
    },

    /** Restaura um backup: aceita {leads:[...]}, array puro ou arquivo cifrado.
        Devolve uma Promise com a lista (ou null se não deu). */
    importarJSON: function (texto) {
      let dados;
      try {
        dados = JSON.parse(texto);
      } catch (erro) {
        UI.toast('Arquivo inválido: não é um JSON.', 'erro');
        return Promise.resolve(null);
      }

      // Backup protegido: precisa do cofre aberto com a mesma senha
      if (dados && dados.cifrado) {
        if (typeof Cofre === 'undefined' || !Cofre.aberto()) {
          UI.toast('Este backup está protegido por senha. Abra o cofre antes de restaurar.', 'erro');
          return Promise.resolve(null);
        }
        return Cofre.decifrarTexto(dados)
          .then(function (aberto) { return Exportar.importarJSON(aberto); })
          .catch(function () {
            UI.toast('A senha atual não abre este backup.', 'erro');
            return null;
          });
      }

      const lista = Array.isArray(dados) ? dados : (dados && Array.isArray(dados.leads) ? dados.leads : null);
      if (!lista) {
        UI.toast('Arquivo inválido: não encontrei a lista de leads.', 'erro');
        return Promise.resolve(null);
      }

      // Etapas e mensagens vêm junto quando o backup foi gerado por este app
      if (dados && Array.isArray(dados.etapas) && dados.etapas.length) {
        DB.salvarEtapas(dados.etapas);
      }
      if (dados && dados.modelos) DB.salvarModelos(dados.modelos);
      return Promise.resolve(lista);
    }
  };
})();

/* =============================================================================
   app.js — Orquestrador: estado (aba, filtros, ordenação), render das
   visualizações, indicadores, formulário/detalhes e ações globais.
   ============================================================================= */

const App = (function () {
  'use strict';

  const estado = {
    aba: 'kanban',
    busca: '',
    etapa: '',
    empresa: '',
    uf: '',
    cidade: '',
    cobranca: '',   // '' | 'atrasado' (passou da hora) | 'atencao' (é hoje)
    // Começa pelo que pede atenção: quem está mais perto (ou já passou) da hora de falar
    ordem: { campo: 'proximoContato', dir: 'asc' }
  };

  const els = {}; // referências do DOM, preenchidas em `iniciar`

  // ------------------------------------------------------- filtros e ordenação

  function semAcento(texto) {
    return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  /** Aplica busca global + filtros (combinados com E) e a ordenação atual. */
  function leadsFiltrados() {
    const termo = semAcento(estado.busca.trim());

    const lista = DB.listar().filter(function (lead) {
      if (estado.etapa && lead.etapa !== estado.etapa) return false;
      if (estado.empresa && lead.empresa !== estado.empresa) return false;
      if (estado.uf && lead.uf !== estado.uf) return false;
      if (estado.cidade && lead.cidade !== estado.cidade) return false;
      if (estado.cobranca && DB.situacao(lead) !== estado.cobranca) return false;
      if (!termo) return true;

      // Busca global: varre os campos de texto do lead
      const alvo = semAcento([
        lead.nome, lead.empresa, lead.cidade, lead.uf, lead.etapa,
        lead.email, lead.telefone, lead.cargo, lead.observacoes
      ].join(' '));
      return alvo.indexOf(termo) > -1;
    });

    const campo = estado.ordem.campo;
    const sinal = estado.ordem.dir === 'asc' ? 1 : -1;

    lista.sort(function (a, b) {
      let r;
      if (campo === 'dataCriacao') {
        r = String(a[campo]).localeCompare(String(b[campo])); // ISO ordena como texto
      } else if (campo === 'proximoContato') {
        /* Urgência real: a data combinada ou, sem ela, o prazo da etapa.
           Quem não tem prazo nenhum fica sempre no fim, nos dois sentidos. */
        const ua = DB.diasParaCobranca(a);
        const ub = DB.diasParaCobranca(b);
        if (ua === null && ub === null) r = 0;
        else if (ua === null) return 1;
        else if (ub === null) return -1;
        else r = ua - ub;
      } else if (campo === 'etapaDesde') {
        r = DB.diasNaEtapa(a) - DB.diasNaEtapa(b);            // ordena pelos dias parados
      } else if (campo === 'etapa') {
        const ordemEtapas = DB.etapas().map(function (e) { return e.id; });
        r = ordemEtapas.indexOf(a.etapa) - ordemEtapas.indexOf(b.etapa);
      } else {
        r = String(a[campo] || '').localeCompare(String(b[campo] || ''), 'pt-BR', { sensitivity: 'base' });
      }
      if (r === 0) r = String(a.nome).localeCompare(String(b.nome), 'pt-BR');
      return r * sinal;
    });

    return lista;
  }

  function ordenarPor(campo) {
    if (estado.ordem.campo === campo) {
      estado.ordem.dir = estado.ordem.dir === 'asc' ? 'desc' : 'asc';
    } else {
      estado.ordem.campo = campo;
      // Datas e tempo parado começam do maior para o menor; textos, de A a Z.
      estado.ordem.dir = (campo === 'dataCriacao' || campo === 'etapaDesde') ? 'desc' : 'asc';
    }
    render();
  }

  // ---------------------------------------------------------------- render

  /** Primeiros nomes de uma lista, para caber na nota do indicador. */
  function nomesResumidos(leads) {
    const nomes = leads.map(function (l) { return String(l.nome).split(' ')[0]; });
    if (nomes.length <= 2) return nomes.join(' e ');
    return nomes.slice(0, 2).join(', ') + ' e +' + (nomes.length - 2);
  }

  function renderIndicadores() {
    const todos = DB.listar();
    // Hoje é o dia de falar; atrasado já passou da hora.
    const hoje = todos.filter(function (l) { return DB.situacao(l) === 'atencao'; });
    const atrasados = todos.filter(function (l) { return DB.situacao(l) === 'atrasado'; });
    // Métrica de relacionamento que não depende do nome de nenhuma etapa
    const semContato = todos.filter(function (l) { return l.contatos.length === 0; });

    const maisParado = atrasados.slice().sort(function (a, b) {
      return DB.diasNaEtapa(b) - DB.diasNaEtapa(a);
    })[0];

    els.kpiTotal.textContent = todos.length;
    els.kpiTotalNota.textContent = !todos.length ? '—'
      : (semContato.length
          ? semContato.length + (semContato.length === 1 ? ' sem contato registrado' : ' sem contato registrado')
          : 'todos já tiveram contato');

    els.kpiHoje.textContent = hoje.length;
    els.kpiHojeNota.textContent = hoje.length ? nomesResumidos(hoje) : 'ninguém no prazo de hoje';
    els.kpiCardHoje.classList.toggle('kpi-atencao', hoje.length > 0);

    els.kpiAtrasados.textContent = atrasados.length;
    els.kpiAtrasadosNota.textContent = maisParado
      ? 'o mais parado há ' + UI.textoDias(DB.diasNaEtapa(maisParado))
      : (todos.length ? 'tudo em dia' : '—');
    els.kpiCardAtrasados.classList.toggle('kpi-alerta', atrasados.length > 0);
  }

  /** Repovoa os selects de filtro preservando a escolha atual. */
  function renderOpcoesFiltro() {
    const todos = DB.listar();

    /* `valores` aceita textos simples ou pares {valor, rotulo} — as etapas
       usam id como valor e nome como rótulo. */
    function preencher(select, valores, rotuloVazio, selecionado) {
      select.innerHTML = '<option value="">' + rotuloVazio + '</option>' +
        valores.map(function (v) {
          const valor = typeof v === 'string' ? v : v.valor;
          const rotulo = typeof v === 'string' ? v : v.rotulo;
          return '<option value="' + UI.esc(valor) + '"' + (valor === selecionado ? ' selected' : '') +
                 '>' + UI.esc(rotulo) + '</option>';
        }).join('');
    }

    const cidades = Array.from(new Set(todos.map(function (l) { return l.cidade; }).filter(Boolean)))
                         .sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    const ufs = Array.from(new Set(todos.map(function (l) { return l.uf; }).filter(Boolean)))
                     .sort();

    const empresas = DB.empresas();

    const opcoesEtapa = DB.etapas().map(function (e) { return { valor: e.id, rotulo: e.nome }; });
    preencher(els.filtroEtapa, opcoesEtapa, 'Todas as etapas', estado.etapa);
    preencher(els.filtroEmpresa, empresas, 'Todas as empresas/origens', estado.empresa);
    preencher(els.filtroUf, ufs, 'Todas as UFs', estado.uf);
    preencher(els.filtroCidade, cidades, 'Todas as cidades', estado.cidade);

    // Se a empresa/cidade/UF filtrada deixou de existir, limpa o filtro órfão.
    if (estado.empresa && empresas.indexOf(estado.empresa) === -1) estado.empresa = '';
    if (estado.uf && ufs.indexOf(estado.uf) === -1) estado.uf = '';
    if (estado.cidade && cidades.indexOf(estado.cidade) === -1) estado.cidade = '';
  }

  function render() {
    renderIndicadores();
    renderOpcoesFiltro();

    const leads = leadsFiltrados();
    const total = DB.listar().length;

    els.contador.textContent = leads.length === total
      ? total + (total === 1 ? ' lead' : ' leads')
      : leads.length + ' de ' + total + ' leads';

    const dicas = {
      hoje: 'Sua rotina do dia: fale, registre e agende o próximo toque.',
      tabela: 'Clique em uma célula para editar direto na tabela.',
      kanban: 'Arraste os cards entre as colunas para mudar a etapa.'
    };
    els.dica.textContent = dicas[estado.aba];

    const soAtrasados = estado.cobranca === 'atrasado';
    els.btnAtrasados.classList.toggle('ativo', soAtrasados);
    els.btnAtrasados.setAttribute('aria-pressed', soAtrasados ? 'true' : 'false');
    els.kpiCardAtrasados.classList.toggle('kpi-filtrando', soAtrasados);
    els.kpiCardHoje.classList.toggle('kpi-filtrando', estado.cobranca === 'atencao');

    Hoje.render(els.viewHoje, leads);
    Tabela.render(els.viewTabela, leads, estado.ordem);
    if (leads.length) {
      Kanban.render(els.viewKanban, leads);
    } else {
      els.viewKanban.innerHTML = htmlVazio();
    }

    // Selo da aba Hoje: quantos pedem ação agora (atrasados + os de hoje)
    const pendentes = leads.filter(function (l) {
      const s = DB.situacao(l);
      return s === 'atrasado' || s === 'atencao';
    }).length;
    els.seloHoje.textContent = pendentes;
    els.seloHoje.hidden = pendentes === 0;

    renderAvisoBackup();

    NuvemUI.renderEstado();

    // O botão do topo mostra se os dados estão protegidos
    els.rotuloSeguranca.textContent = (Cofre.ligado() || Nuvem.configurada()) ? 'Protegido' : 'Senha';
    els.btnSeguranca.classList.toggle('protegido', Cofre.ligado());
  }

  /** Marca o botão de backup quando faz tempo demais que nada foi salvo. */
  function renderAvisoBackup() {
    const info = Backup.estado();
    els.seloBackup.hidden = !info.atrasado;
    els.seloBackup.title = info.ultimo
      ? 'Último backup há ' + info.diasDesde + ' dias'
      : 'Você ainda não fez nenhum backup';
  }

  function htmlVazio() {
    const temDados = DB.listar().length > 0;
    return '<div class="estado-vazio">' +
      '<svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>' +
      '<h3>' + (temDados ? 'Nenhum lead com esses filtros' : 'Nenhum lead cadastrado ainda') + '</h3>' +
      '<p>' + (temDados
        ? 'Ajuste a busca ou limpe os filtros para ver os demais leads.'
        : 'Cadastre o primeiro lead ou carregue exemplos para conhecer o app.') + '</p>' +
      '<div class="estado-vazio-acoes">' +
        (temDados
          ? '<button type="button" class="btn btn-primario" data-vazio="limpar">Limpar filtros</button>'
          : '<button type="button" class="btn btn-primario" data-vazio="novo">Cadastrar lead</button>' +
            '<button type="button" class="btn btn-fantasma" data-vazio="exemplos">Carregar exemplos</button>') +
      '</div></div>';
  }

  // -------------------------------------------------------- formulário (CRUD)

  function campoTexto(rotulo, campo, valor, opcoes) {
    opcoes = opcoes || {};
    return '<label class="campo' + (opcoes.largo ? ' campo-largo' : '') + '">' +
      '<span>' + UI.esc(rotulo) + (opcoes.obrigatorio ? ' <b class="obrig">*</b>' : '') + '</span>' +
      '<input type="' + (opcoes.tipo || 'text') + '" name="' + campo + '" value="' + UI.esc(valor) + '"' +
      (opcoes.obrigatorio ? ' required' : '') +
      (opcoes.placeholder ? ' placeholder="' + UI.esc(opcoes.placeholder) + '"' : '') +
      (opcoes.lista ? ' list="' + opcoes.lista + '" autocomplete="off"' : '') +
      (opcoes.foco ? ' data-foco' : '') + '>' +
      (opcoes.lista ? '<datalist id="' + opcoes.lista + '">' + (opcoes.sugestoes || []).map(function (o) {
        return '<option value="' + UI.esc(o) + '"></option>';
      }).join('') + '</datalist>' : '') +
      (opcoes.ajuda ? '<small class="ajuda">' + UI.esc(opcoes.ajuda) + '</small>' : '') +
    '</label>';
  }

  /** `opcoes` aceita textos ou pares {valor, rotulo}. */
  function campoSelect(rotulo, campo, valor, opcoes, rotuloVazio) {
    return '<label class="campo"><span>' + UI.esc(rotulo) + '</span><select name="' + campo + '">' +
      (rotuloVazio ? '<option value="">' + UI.esc(rotuloVazio) + '</option>' : '') +
      opcoes.map(function (op) {
        const v = typeof op === 'string' ? op : op.valor;
        const r = typeof op === 'string' ? op : op.rotulo;
        return '<option value="' + UI.esc(v) + '"' + (v === valor ? ' selected' : '') + '>' + UI.esc(r) + '</option>';
      }).join('') +
    '</select></label>';
  }

  function abrirFormulario(id) {
    const editando = Boolean(id);
    const lead = editando ? DB.obter(id) : Object.assign({}, DB.CAMPOS, { dataCriacao: DB.hoje() });
    if (!lead) return;

    const html =
      '<form class="form-lead" novalidate>' +
        '<header class="modal-topo">' +
          '<h2>' + (editando ? 'Editar lead' : 'Novo lead') + '</h2>' +
          '<button type="button" class="icone-btn" data-fechar title="Fechar">' + UI.ICONES.fechar + '</button>' +
        '</header>' +
        '<div class="form-grade">' +
          campoTexto('Data de criação', 'dataCriacao', lead.dataCriacao, { tipo: 'date', obrigatorio: true }) +
          campoTexto('Nome', 'nome', lead.nome, { obrigatorio: true, foco: true, placeholder: 'Nome do contato' }) +
          campoTexto('E-mail', 'email', lead.email, { tipo: 'email', placeholder: 'contato@empresa.com.br' }) +
          campoTexto('Telefone', 'telefone', lead.telefone, { placeholder: '(11) 99999-0000' }) +
          campoTexto('Cargo', 'cargo', lead.cargo, { placeholder: 'Diretor comercial' }) +
          campoTexto('Empresa / origem', 'empresa', lead.empresa,
                     { placeholder: 'Governo do Estado, Construtora X…', lista: 'empresas-form',
                       sugestoes: DB.empresas(),
                       ajuda: 'De onde vem o contato — agrupa quem é do mesmo lugar.' }) +
          campoSelect('UF', 'uf', lead.uf, DB.UFS, '—') +
          campoTexto('Cidade', 'cidade', lead.cidade,
                     { placeholder: 'Escolha a UF para ver as cidades', lista: 'cidades-form',
                       sugestoes: lead.uf ? DB.cidadesDe(lead.uf) : [] }) +
          campoSelect('Etapa do funil', 'etapa', lead.etapa,
                      DB.etapas().map(function (e) { return { valor: e.id, rotulo: e.nome }; })) +
          campoTexto('Nesta etapa desde', 'etapaDesde', lead.etapaDesde || lead.dataCriacao,
                     { tipo: 'date' }) +
          campoTexto('Próximo contato', 'proximoContato', lead.proximoContato,
                     { tipo: 'date', ajuda: 'Deixe vazio para seguir o prazo da etapa.' }) +
          campoTexto('Aniversário', 'aniversario', lead.aniversario,
                     { tipo: 'date', ajuda: 'O app lembra você 15 dias antes.' }) +
          campoTexto('Outra data especial', 'dataEspecial', lead.dataEspecial,
                     { tipo: 'date', ajuda: 'Fundação da empresa, renovação de contrato…' }) +
          campoTexto('O que é essa data', 'dataEspecialNome', lead.dataEspecialNome,
                     { placeholder: 'Aniversário da empresa, renovação…' }) +
          '<div class="campo aviso-etapa" id="aviso-etapa" hidden>' +
            UI.ICONES.relogio + '<span>Etapa alterada: a contagem de dias recomeça hoje.</span></div>' +
          '<label class="campo campo-largo"><span>Observações</span>' +
            '<textarea name="observacoes" rows="4" placeholder="Contexto, próximos passos, histórico…">' +
              UI.esc(lead.observacoes) + '</textarea></label>' +
        '</div>' +
        '<footer class="modal-acoes">' +
          (editando ? '<button type="button" class="btn btn-perigo-suave" data-excluir>Excluir</button>' : '') +
          '<span class="espaco"></span>' +
          '<button type="button" class="btn btn-fantasma" data-fechar>Cancelar</button>' +
          '<button type="submit" class="btn btn-primario">' + (editando ? 'Salvar alterações' : 'Cadastrar lead') + '</button>' +
        '</footer>' +
      '</form>';

    UI.abrirModal(html, function (caixa) {
      const form = caixa.querySelector('form');
      const selEtapa = form.querySelector('[name="etapa"]');
      const inpDesde = form.querySelector('[name="etapaDesde"]');
      const inpCriacao = form.querySelector('[name="dataCriacao"]');
      const aviso = caixa.querySelector('#aviso-etapa');

      /* Trocar a etapa reinicia a contagem: a data de entrada vira hoje.
         Voltando para a etapa original, a data original volta junto. */
      selEtapa.addEventListener('change', function () {
        const mudou = selEtapa.value !== lead.etapa;
        inpDesde.value = mudou ? DB.hoje() : (lead.etapaDesde || lead.dataCriacao);
        aviso.hidden = !mudou;
      });

      // Em lead novo, a data de entrada na etapa acompanha a data de criação.
      inpCriacao.addEventListener('change', function () {
        if (!editando && selEtapa.value === lead.etapa) inpDesde.value = inpCriacao.value;
      });

      /* Escolher a UF carrega os municípios daquele estado no autocompletar
         da cidade (lista do IBGE embutida no app). */
      const selUf = form.querySelector('[name="uf"]');
      const inpCidade = form.querySelector('[name="cidade"]');
      const listaCidades = caixa.querySelector('#cidades-form');

      function carregarCidades(limparCidade) {
        const cidades = selUf.value ? DB.cidadesDe(selUf.value) : [];
        listaCidades.innerHTML = cidades.map(function (c) {
          return '<option value="' + UI.esc(c) + '"></option>';
        }).join('');
        inpCidade.placeholder = selUf.value
          ? cidades.length + ' cidades de ' + selUf.value
          : 'Escolha a UF para ver as cidades';
        // Trocou de estado: a cidade antiga não vale mais
        if (limparCidade && cidades.indexOf(inpCidade.value) === -1) inpCidade.value = '';
      }

      selUf.addEventListener('change', function () { carregarCidades(true); });
      carregarCidades(false);

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        const dados = {};
        new FormData(form).forEach(function (valor, chave) { dados[chave] = String(valor).trim(); });

        if (!dados.nome) {
          UI.toast('Informe pelo menos o nome do lead.', 'erro');
          form.querySelector('[name="nome"]').focus();
          return;
        }
        if (dados.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) {
          UI.toast('E-mail em formato inválido.', 'erro');
          form.querySelector('[name="email"]').focus();
          return;
        }

        if (editando) {
          DB.atualizar(id, dados);
          UI.toast('Lead atualizado.');
        } else {
          DB.criar(dados);
          UI.toast('Lead cadastrado.');
        }
        UI.fecharModal();
        render();
      });

      const btnExcluir = caixa.querySelector('[data-excluir]');
      if (btnExcluir) btnExcluir.addEventListener('click', function () { excluir(id); });
    });
  }

  // --------------------------------------------------------------- detalhes

  /** Frase pronta sobre a cobrança do lead, para a tela de detalhes. */
  function textoSituacao(lead) {
    // Data combinada manda mais que o prazo da etapa
    if (DB.temContatoAgendado(lead)) {
      const faltam = DB.diasParaContato(lead);
      if (faltam < 0) return 'Contato combinado passou há ' + UI.textoDias(-faltam) + ' — retome hoje';
      if (faltam === 0) return 'É hoje o contato combinado';
      return 'Contato combinado em ' + UI.textoDias(faltam);
    }
    const prazo = DB.prazoDe(lead.etapa);
    const dias = DB.diasNaEtapa(lead);
    switch (DB.situacao(lead)) {
      case 'atrasado': return 'Atrasado ' + UI.textoDias(dias - prazo) + ' — hora de retomar o contato';
      case 'atencao':  return 'No limite do prazo — contate ainda hoje';
      case 'ok':       return 'Dentro do prazo (faltam ' + UI.textoDias(prazo - dias) + ')';
      default:         return 'Etapa sem prazo definido';
    }
  }

  /** Histórico de contatos do lead, do mais recente para o mais antigo. */
  function historicoHTML(lead) {
    const total = lead.contatos.length;
    const resumo = total
      ? total + (total === 1 ? ' contato registrado' : ' contatos registrados') +
        ' · o último ' + UI.textoHa(DB.diasDesdeUltimoContato(lead))
      : 'Nenhum contato registrado ainda';

    const itens = lead.contatos.map(function (c, i) {
      return '<li class="historico-item">' +
        '<span class="historico-data">' + UI.data(c.data) + '</span>' +
        '<span class="historico-canal">' + UI.esc(c.canal) + '</span>' +
        '<span class="historico-nota">' + (c.nota ? UI.esc(c.nota) : '<i>sem anotação</i>') + '</span>' +
        '<span class="historico-acoes">' +
          '<button type="button" class="icone-btn" data-editar-contato="' + i + '" ' +
                  'title="Corrigir este registro">' + UI.ICONES.lapis + '</button>' +
          '<button type="button" class="icone-btn perigo" data-apagar-contato="' + i + '" ' +
                  'title="Apagar este registro">' + UI.ICONES.lixeira + '</button>' +
        '</span>' +
      '</li>';
    }).join('');

    return '<div class="historico">' +
      '<div class="historico-topo">' +
        '<h3>' + UI.ICONES.historico + 'Histórico</h3>' +
        '<span>' + resumo + '</span>' +
      '</div>' +
      (total ? '<ul class="historico-lista">' + itens + '</ul>' : '') +
    '</div>';
  }

  function itemDetalhe(icone, rotulo, valor) {
    return '<div class="detalhe-item"><span class="detalhe-rotulo">' + icone + UI.esc(rotulo) + '</span>' +
           '<span class="detalhe-valor">' + (valor ? UI.esc(valor) : '—') + '</span></div>';
  }

  function abrirDetalhes(id) {
    const lead = DB.obter(id);
    if (!lead) return;
    const etapa = DB.etapa(lead.etapa);
    const irmaos = DB.daEmpresa(lead.empresa, id);   // outros contatos do mesmo lugar

    const html =
      '<div class="detalhes">' +
        '<header class="modal-topo">' +
          '<div class="detalhe-identidade">' +
            '<span class="avatar avatar-g" style="background:' + etapa.fundo + ';color:' + etapa.cor + '">' +
              UI.esc(UI.iniciais(lead.nome)) + '</span>' +
            '<div><h2>' + UI.esc(lead.nome || 'Sem nome') + '</h2>' +
              '<p>' + UI.esc([lead.cargo, lead.empresa].filter(Boolean).join(' · ') || 'Sem cargo/empresa') + '</p>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="icone-btn" data-fechar title="Fechar">' + UI.ICONES.fechar + '</button>' +
        '</header>' +

        '<div class="detalhe-faixa">' +
          '<span class="detalhe-faixa-etapa">' + UI.badgeEtapa(lead.etapa) + UI.pillDias(lead) +
            (DB.temContatoAgendado(lead) ? UI.pillContato(lead) : '') + '</span>' +
        '</div>' +

        (lead.empresa
          ? '<div class="detalhe-origem">' +
              '<span class="chip-origem">' + UI.esc(lead.empresa) + '</span>' +
              (irmaos.length
                ? '<button type="button" class="link-origem" data-ver-origem>mais ' + irmaos.length +
                  (irmaos.length === 1 ? ' contato' : ' contatos') + ' daqui: ' +
                  UI.esc(irmaos.slice(0, 3).map(function (l) { return String(l.nome).split(' ')[0]; }).join(', ')) +
                  (irmaos.length > 3 ? '…' : '') + '</button>'
                : '<span class="detalhe-origem-nota">único contato daqui</span>') +
            '</div>'
          : '') +

        '<div class="detalhe-grade">' +
          itemDetalhe(UI.ICONES.mail, 'E-mail', lead.email) +
          itemDetalhe(UI.ICONES.fone, 'Telefone', UI.telefone(lead.telefone)) +
          itemDetalhe(UI.ICONES.cracha, 'Cargo', lead.cargo) +
          itemDetalhe(UI.ICONES.predio, 'Empresa', lead.empresa) +
          itemDetalhe(UI.ICONES.pin, 'Cidade / UF', [lead.cidade, lead.uf].filter(Boolean).join(' / ')) +
          itemDetalhe(UI.ICONES.relogio, 'Criado em',
                      UI.data(lead.dataCriacao) + ' · ' + UI.textoHa(DB.diasDesdeCriacao(lead))) +
          itemDetalhe(UI.ICONES.relogio, 'Nesta etapa desde',
                      UI.data(lead.etapaDesde) + ' · ' + UI.textoDias(DB.diasNaEtapa(lead)) +
                      (DB.prazoDe(lead.etapa) ? ' de ' + DB.prazoDe(lead.etapa) : '')) +
          itemDetalhe(UI.ICONES.agenda, 'Próximo contato',
                      lead.proximoContato ? UI.data(lead.proximoContato) : 'sem data combinada') +
          itemDetalhe(UI.ICONES.relogio, 'Situação', textoSituacao(lead)) +
          DB.datasDoLead(lead).map(function (d) {
            return itemDetalhe(UI.ICONES.presente, d.rotulo,
                               UI.data(d.data) + ' · ' +
                               (d.faltam === 0 ? 'é hoje!' : 'em ' + UI.textoDias(d.faltam)));
          }).join('') +
        '</div>' +

        historicoHTML(lead) +

        '<label class="campo campo-largo nota-rapida"><span>Observações — nota rápida</span>' +
          '<textarea name="observacoes" rows="4" placeholder="Anote aqui o que rolou na conversa…">' +
            UI.esc(lead.observacoes) + '</textarea>' +
          '<small class="ajuda">Salva ao sair do campo ou com Ctrl+Enter.</small>' +
        '</label>' +

        '<div class="detalhe-etapa-rapida">' +
          '<span>Mover para:</span>' +
          '<select name="etapa">' + DB.etapas().map(function (e) {
            return '<option value="' + UI.esc(e.id) + '"' + (e.id === lead.etapa ? ' selected' : '') +
                   '>' + UI.esc(e.nome) + '</option>';
          }).join('') + '</select>' +
        '</div>' +

        '<footer class="modal-acoes modal-acoes-ficha">' +
          '<button type="button" class="btn btn-perigo-suave" data-excluir>Excluir</button>' +
          '<span class="espaco"></span>' +
          (Zap.temWhatsApp(lead)
            ? '<span class="grupo-zap">' +
                '<button type="button" class="btn btn-zap" data-zap title="' + UI.esc(Zap.dica(lead)) + '">' +
                  UI.ICONES.whatsapp + 'WhatsApp</button>' +
                '<button type="button" class="link-secundario" data-zap-vazio ' +
                        'title="Abrir a conversa sem texto nenhum">sem texto</button>' +
              '</span>'
            : '') +
          '<button type="button" class="btn btn-fantasma" data-falei>' + UI.ICONES.check + 'Falei hoje</button>' +
          '<button type="button" class="btn btn-fantasma" data-adiar>' + UI.ICONES.adiar + 'Adiar</button>' +
          '<button type="button" class="btn btn-primario" data-editar>Editar</button>' +
        '</footer>' +
      '</div>';

    UI.abrirModal(html, function (caixa) {
      const nota = caixa.querySelector('textarea[name="observacoes"]');

      function salvarNota() {
        if (nota.value === lead.observacoes) return;
        DB.atualizar(id, { observacoes: nota.value });
        lead.observacoes = nota.value;
        UI.toast('Observações salvas.');
        render();
      }
      nota.addEventListener('blur', salvarNota);
      nota.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && ev.ctrlKey) { ev.preventDefault(); nota.blur(); }
      });

      caixa.querySelector('select[name="etapa"]').addEventListener('change', function (ev) {
        const atualizado = DB.atualizar(id, { etapa: ev.target.value }); // reinicia a contagem
        UI.toast('Movido para ' + DB.nomeEtapa(atualizado.etapa) + ' — contagem de dias reiniciada.');
        render();
        // Etapa de faixa lenta sem data de retomada: já pergunto quando voltar.
        if (DB.etapa(atualizado.etapa).perguntarRetomada && !atualizado.proximoContato) abrirAdiar(id, true);
        else abrirDetalhes(id); // recarrega para atualizar cores/etiqueta
      });

      caixa.querySelector('[data-editar]').addEventListener('click', function () { abrirFormulario(id); });
      caixa.querySelector('[data-excluir]').addEventListener('click', function () { excluir(id); });
      caixa.querySelector('[data-adiar]').addEventListener('click', function () { abrirAdiar(id, true); });
      caixa.querySelector('[data-falei]').addEventListener('click', function () { abrirRegistro(id, true); });

      const btnZap = caixa.querySelector('[data-zap]');
      if (btnZap) btnZap.addEventListener('click', function () { abrirWhatsApp(id); });
      const btnZapVazio = caixa.querySelector('[data-zap-vazio]');
      if (btnZapVazio) btnZapVazio.addEventListener('click', function () { abrirWhatsApp(id, true); });

      // Corrigir ou apagar um registro do histórico
      caixa.querySelectorAll('[data-editar-contato]').forEach(function (botao) {
        botao.addEventListener('click', function () {
          abrirRegistro(id, true, null, Number(botao.dataset.editarContato));
        });
      });
      caixa.querySelectorAll('[data-apagar-contato]').forEach(function (botao) {
        botao.addEventListener('click', function () {
          DB.removerContato(id, Number(botao.dataset.apagarContato));
          UI.toast('Registro apagado.');
          render();
          abrirDetalhes(id);
        });
      });

      // "mais N contatos daqui" → filtra a lista por essa empresa/origem
      const verOrigem = caixa.querySelector('[data-ver-origem]');
      if (verOrigem) verOrigem.addEventListener('click', function () {
        estado.empresa = lead.empresa;
        UI.fecharModal();
        render();
        UI.toast('Mostrando os contatos de ' + lead.empresa + '.');
      });
    });
  }

  // ---------------------------------------------------------------- WhatsApp

  /** Abre a conversa no WhatsApp e, em seguida, oferece registrar o contato.
      Quem não falou é só fechar — nada é gravado sem confirmar. */
  function abrirWhatsApp(id, semTexto) {
    const lead = DB.obter(id);
    if (!lead) return;

    if (!Zap.abrir(lead, semTexto)) {
      UI.toast('Sem WhatsApp: ' + Zap.analisar(lead.telefone).motivo + '.', 'aviso');
      return;
    }
    abrirRegistro(id, false, 'WhatsApp');
  }

  // -------------------------------------------------- registrar contato feito

  /** Histórico curto mostrado dentro do registro, para você lembrar do que já
      foi conversado antes de anotar a conversa de agora. */
  function historicoResumoHTML(lead, indiceEmEdicao) {
    const total = lead.contatos.length;
    if (!total) {
      return '<div class="historico historico-vazio">' +
        UI.ICONES.historico + '<span>Primeiro contato registrado com essa pessoa.</span></div>';
    }

    const itens = lead.contatos.slice(0, 6).map(function (c, i) {
      return '<li class="historico-item' + (i === indiceEmEdicao ? ' historico-editando' : '') + '">' +
        '<span class="historico-data">' + UI.data(c.data) + '</span>' +
        '<span class="historico-canal">' + UI.esc(c.canal) + '</span>' +
        '<span class="historico-nota">' + (c.nota ? UI.esc(c.nota) : '<i>sem anotação</i>') + '</span>' +
      '</li>';
    }).join('');

    return '<div class="historico historico-compacto">' +
      '<div class="historico-topo">' +
        '<h3>' + UI.ICONES.historico + 'O que já rolou</h3>' +
        '<span>' + total + (total === 1 ? ' contato' : ' contatos') +
          ' · o último ' + UI.textoHa(DB.diasDesdeUltimoContato(lead)) +
          (total > 6 ? ' · mostrando os 6 mais recentes' : '') + '</span>' +
      '</div>' +
      '<ul class="historico-lista">' + itens + '</ul>' +
    '</div>';
  }

  /** "Falei hoje": guarda o contato no histórico e já agenda o próximo toque.
      Passando `indice`, a mesma tela serve para corrigir um registro antigo. */
  function abrirRegistro(id, voltarParaDetalhes, canalSugerido, indice) {
    const lead = DB.obter(id);
    if (!lead) return;

    const corrigindo = typeof indice === 'number' && lead.contatos[indice];
    const registro = corrigindo ? lead.contatos[indice] : null;

    const prazo = DB.prazoDe(lead.etapa);
    const proximaSugerida = corrigindo ? lead.proximoContato
                                       : (prazo ? DB.somarDias(DB.hoje(), prazo) : '');
    const canal = corrigindo ? registro.canal : (canalSugerido || 'WhatsApp');
    const primeiroNome = String(lead.nome).split(' ')[0];

    const html =
      '<form class="form-registro" novalidate>' +
        '<header class="modal-topo">' +
          '<div><h2>' + (corrigindo ? 'Corrigir registro' : 'Falou com ' + UI.esc(primeiroNome) + '?') + '</h2>' +
            '<p class="modal-subtitulo">' + (corrigindo
              ? 'Ajuste a data, o canal ou a anotação deste contato com ' + UI.esc(primeiroNome) + '.'
              : 'Registre o contato para o histórico e já deixe o próximo marcado. ' +
                'Se ainda não falou, é só fechar.') + '</p></div>' +
          '<button type="button" class="icone-btn" data-fechar title="Fechar">' + UI.ICONES.fechar + '</button>' +
        '</header>' +

        historicoResumoHTML(lead, corrigindo ? indice : -1) +

        '<div class="form-grade">' +
          '<label class="campo"><span>Quando</span>' +
            '<input type="date" name="data" value="' + UI.esc(corrigindo ? registro.data : DB.hoje()) +
                   '" max="' + DB.hoje() + '"></label>' +
          '<label class="campo"><span>Como</span><select name="canal">' +
            DB.CANAIS.map(function (c) {
              return '<option value="' + UI.esc(c) + '"' + (c === canal ? ' selected' : '') + '>' + UI.esc(c) + '</option>';
            }).join('') +
          '</select></label>' +
          '<label class="campo campo-largo"><span>O que ficou combinado</span>' +
            '<textarea name="nota" rows="3" placeholder="Resumo em uma linha: o que rolou e o que ficou de fazer." ' +
                      'data-foco>' + UI.esc(corrigindo ? registro.nota : '') + '</textarea>' +
            '<small class="ajuda">Vira uma linha do histórico, com a data de hoje.</small></label>' +

          '<label class="campo campo-largo"><span>Observações sobre ' + UI.esc(primeiroNome) + '</span>' +
            '<textarea name="observacoes" rows="3" placeholder="O que vale lembrar sempre: contexto, ' +
                      'preferências, quem indicou.">' + UI.esc(lead.observacoes) + '</textarea>' +
            '<small class="ajuda">Anotação fixa da ficha — não entra no histórico. ' +
              'Edite aqui e ela é salva junto.</small></label>' +
          '<label class="campo"><span>Próximo contato</span>' +
            '<input type="date" name="proximoContato" value="' + UI.esc(proximaSugerida) + '">' +
            '<small class="ajuda">' + (corrigindo
              ? 'A data combinada com ' + UI.esc(primeiroNome) + ' — mexa só se precisar.'
              : (prazo ? 'Sugerido pelo prazo de ' + UI.esc(DB.nomeEtapa(lead.etapa)) + ' (' + prazo + ' dias).'
                       : 'Etapa sem prazo — escolha uma data se quiser.')) + '</small></label>' +
        '</div>' +

        '<footer class="modal-acoes">' +
          '<span class="espaco"></span>' +
          '<button type="button" class="btn btn-fantasma" data-fechar>' +
            (corrigindo ? 'Cancelar' : 'Ainda não falei') + '</button>' +
          '<button type="submit" class="btn btn-primario">' +
            (corrigindo ? 'Salvar correção' : 'Registrar contato') + '</button>' +
        '</footer>' +
      '</form>';

    UI.abrirModal(html, function (caixa) {
      const form = caixa.querySelector('form');
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        const dados = {};
        new FormData(form).forEach(function (v, k) { dados[k] = String(v).trim(); });

        if (corrigindo) {
          DB.editarContato(id, indice, {
            data: dados.data || registro.data,
            canal: dados.canal,
            nota: dados.nota
          });
          DB.atualizar(id, { proximoContato: dados.proximoContato,
                             observacoes: dados.observacoes });
          UI.toast('Registro corrigido.');
        } else {
          DB.registrarContato(id, {
            data: dados.data || DB.hoje(),
            canal: dados.canal,
            nota: dados.nota,
            proximoContato: dados.proximoContato
          });
          if (dados.observacoes !== lead.observacoes) {
            DB.atualizar(id, { observacoes: dados.observacoes });
          }
          UI.toast('Contato registrado' +
            (dados.proximoContato ? ' — próximo em ' + UI.data(dados.proximoContato) + '.' : '.'));
        }

        UI.fecharModal();
        render();
        if (voltarParaDetalhes) abrirDetalhes(id);
      });
    });
  }

  // ------------------------------------------------- modelos de mensagem

  /** Tela das mensagens que abrem no WhatsApp, uma por etapa. */
  function abrirModelos() {
    const modelos = DB.modelos();

    const campos = DB.etapas().map(function (etapa) {
      return '<label class="campo campo-largo modelo-campo" style="--cor:' + etapa.cor + '">' +
        '<span>' + UI.esc(etapa.nome) + '</span>' +
        '<textarea name="' + UI.esc(etapa.id) + '" rows="3">' + UI.esc(modelos[etapa.id] || '') + '</textarea>' +
      '</label>';
    }).join('');

    const html =
      '<form class="form-modelos" novalidate>' +
        '<header class="modal-topo">' +
          '<div><h2>Mensagens do WhatsApp</h2>' +
            '<p class="modal-subtitulo">O texto abre digitado na conversa — você confere e envia. ' +
              'Use <b>{nome}</b>, <b>{empresa}</b> e <b>{cidade}</b> para preencher com os dados do lead.</p></div>' +
          '<button type="button" class="icone-btn" data-fechar title="Fechar">' + UI.ICONES.fechar + '</button>' +
        '</header>' +

        '<label class="opcao-linha">' +
          '<input type="checkbox" name="_semTexto"' + (modelos._semTexto ? ' checked' : '') + '>' +
          '<span>Abrir sempre a conversa em branco, sem texto nenhum</span>' +
        '</label>' +

        '<div class="form-grade modelos-lista">' + campos + '</div>' +

        '<footer class="modal-acoes">' +
          '<button type="button" class="btn btn-fantasma" data-padrao>Restaurar padrão</button>' +
          '<span class="espaco"></span>' +
          '<button type="button" class="btn btn-fantasma" data-fechar>Cancelar</button>' +
          '<button type="submit" class="btn btn-primario">Salvar mensagens</button>' +
        '</footer>' +
      '</form>';

    UI.abrirModal(html, function (caixa) {
      const form = caixa.querySelector('form');

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        const novos = { _semTexto: form.querySelector('[name="_semTexto"]').checked };
        form.querySelectorAll('textarea').forEach(function (t) { novos[t.name] = t.value; });
        DB.salvarModelos(novos);
        UI.fecharModal();
        UI.toast('Mensagens atualizadas.');
        render();
      });

      caixa.querySelector('[data-padrao]').addEventListener('click', function () {
        form.querySelectorAll('textarea').forEach(function (t) {
          t.value = DB.MODELOS_PADRAO[t.name] || '';
        });
      });
    });
  }

  // ------------------------------------------------------------ adiar contato

  const ATALHOS_ADIAR = [
    { rotulo: 'Amanhã',    dias: 1 },
    { rotulo: '+7 dias',   dias: 7 },
    { rotulo: '+15 dias',  dias: 15 },
    { rotulo: '+30 dias',  dias: 30 }
  ];

  /** Agenda (ou remove) a data de retomada do contato.
      `voltarParaDetalhes` reabre a ficha depois de salvar, para quem chegou por lá. */
  function abrirAdiar(id, voltarParaDetalhes) {
    const lead = DB.obter(id);
    if (!lead) return;

    const agendado = DB.temContatoAgendado(lead);
    const atual = agendado
      ? 'Hoje o combinado é <b>' + UI.data(lead.proximoContato) + '</b> (' +
        (DB.diasParaContato(lead) < 0
          ? 'passou há ' + UI.textoDias(-DB.diasParaContato(lead))
          : (DB.diasParaContato(lead) === 0 ? 'é hoje' : 'em ' + UI.textoDias(DB.diasParaContato(lead)))) + ').'
      : 'Sem data combinada — vale o prazo da etapa <b>' + UI.esc(DB.nomeEtapa(lead.etapa)) + '</b> (' +
        (DB.prazoDe(lead.etapa) ? UI.textoDias(DB.prazoDe(lead.etapa)) : 'sem prazo') + ').';

    const html =
      '<div class="adiar">' +
        '<header class="modal-topo">' +
          '<div><h2>Quando retomar o contato?</h2>' +
            '<p class="modal-subtitulo">' + UI.esc(lead.nome) +
              (lead.empresa ? ' · ' + UI.esc(lead.empresa) : '') + '<br>' + atual + '</p></div>' +
          '<button type="button" class="icone-btn" data-fechar title="Fechar">' + UI.ICONES.fechar + '</button>' +
        '</header>' +

        '<div class="adiar-atalhos">' +
          ATALHOS_ADIAR.map(function (a) {
            return '<button type="button" class="btn btn-fantasma" data-dias="' + a.dias + '">' +
                   UI.esc(a.rotulo) + '<small>' + UI.data(DB.somarDias(DB.hoje(), a.dias)) + '</small></button>';
          }).join('') +
        '</div>' +

        '<div class="form-grade adiar-campos">' +
          '<label class="campo"><span>Daqui a quantos dias</span>' +
            '<span class="campo-dias">' +
              '<input type="number" name="dias" min="0" max="3650" step="1" inputmode="numeric" ' +
                     'placeholder="ex.: 45" data-foco>' +
              '<small>dias</small>' +
            '</span></label>' +
          '<label class="campo"><span>Ou escolha a data</span>' +
            '<input type="date" name="proximoContato" value="' + UI.esc(lead.proximoContato) + '" ' +
                   'min="' + DB.hoje() + '"></label>' +
        '</div>' +
        '<p class="adiar-previa" id="adiar-previa">&nbsp;</p>' +

        '<footer class="modal-acoes">' +
          (agendado ? '<button type="button" class="btn btn-fantasma" data-limpar>Remover data</button>' : '') +
          '<span class="espaco"></span>' +
          '<button type="button" class="btn btn-fantasma" data-fechar>Cancelar</button>' +
          '<button type="button" class="btn btn-primario" data-salvar>Salvar</button>' +
        '</footer>' +
      '</div>';

    UI.abrirModal(html, function (caixa) {
      const campoData = caixa.querySelector('input[name="proximoContato"]');
      const campoDias = caixa.querySelector('input[name="dias"]');
      const previa = caixa.querySelector('#adiar-previa');

      /* Os dois campos andam juntos: digitar os dias preenche a data, e
         escolher a data mostra quantos dias faltam. */
      function mostrarPrevia() {
        if (!campoData.value) { previa.innerHTML = '&nbsp;'; return; }
        const p = campoData.value.split('-');
        const semana = new Date(+p[0], +p[1] - 1, +p[2], 12)
          .toLocaleDateString('pt-BR', { weekday: 'long' });
        const faltam = DB.diasEntre(DB.hoje(), campoData.value);
        previa.innerHTML = 'Retomar <b>' + UI.esc(semana) + ', ' + UI.data(campoData.value) + '</b>' +
          (faltam > 0 ? ' · daqui a ' + UI.textoDias(faltam) : (faltam === 0 ? ' · hoje' : ''));
      }

      campoDias.addEventListener('input', function () {
        const n = parseInt(campoDias.value, 10);
        if (isFinite(n) && n >= 0) campoData.value = DB.somarDias(DB.hoje(), n);
        mostrarPrevia();
      });

      campoData.addEventListener('input', function () {
        const faltam = campoData.value ? DB.diasEntre(DB.hoje(), campoData.value) : NaN;
        campoDias.value = isFinite(faltam) && faltam >= 0 ? faltam : '';
        mostrarPrevia();
      });

      [campoDias, campoData].forEach(function (campo) {
        campo.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); caixa.querySelector('[data-salvar]').click(); }
        });
      });

      // Já tinha data combinada: mostra os dias que faltam
      if (lead.proximoContato) {
        const faltam = DB.diasEntre(DB.hoje(), lead.proximoContato);
        if (faltam >= 0) campoDias.value = faltam;
        mostrarPrevia();
      }

      function concluir(mensagem) {
        UI.fecharModal();
        UI.toast(mensagem);
        render();
        if (voltarParaDetalhes) abrirDetalhes(id);
      }

      caixa.querySelectorAll('[data-dias]').forEach(function (botao) {
        botao.addEventListener('click', function () {
          const lead2 = DB.adiar(id, Number(botao.dataset.dias));
          concluir('Retomar ' + lead2.nome.split(' ')[0] + ' em ' + UI.data(lead2.proximoContato) + '.');
        });
      });

      caixa.querySelector('[data-salvar]').addEventListener('click', function () {
        if (!campoData.value) {
          UI.toast('Digite os dias, escolha a data ou use um dos atalhos.', 'aviso');
          campoDias.focus();
          return;
        }
        DB.atualizar(id, { proximoContato: campoData.value });
        concluir('Contato agendado para ' + UI.data(campoData.value) + '.');
      });

      const btnLimpar = caixa.querySelector('[data-limpar]');
      if (btnLimpar) btnLimpar.addEventListener('click', function () {
        DB.atualizar(id, { proximoContato: '' });
        concluir('Data removida — voltou a valer o prazo da etapa.');
      });
    });
  }

  // ------------------------------------------------------- importar planilha

  /** Mostra o que foi entendido do arquivo antes de gravar qualquer coisa. */
  function abrirImportacao(analise, nomeArquivo) {
    const campos = {
      nome: 'Nome', email: 'E-mail', telefone: 'Telefone', cargo: 'Cargo',
      empresa: 'Empresa/origem', cidade: 'Cidade', uf: 'UF', etapa: 'Etapa',
      observacoes: 'Observações', dataCriacao: 'Data de criação',
      proximoContato: 'Próximo contato', aniversario: 'Aniversário',
      dataEspecial: 'Data especial', dataEspecialNome: 'Nome da data'
    };

    const html =
      '<div class="importacao">' +
        '<header class="modal-topo">' +
          '<div><h2>Importar planilha</h2>' +
            '<p class="modal-subtitulo">' + UI.esc(nomeArquivo) + ' · ' + analise.totalLinhas +
              (analise.totalLinhas === 1 ? ' linha lida' : ' linhas lidas') +
              ' · separador <b>' + (analise.separador === ';' ? 'ponto e vírgula' : 'vírgula') + '</b></p></div>' +
          '<button type="button" class="icone-btn" data-fechar title="Fechar">' + UI.ICONES.fechar + '</button>' +
        '</header>' +

        '<div class="importacao-resumo">' +
          '<div class="importacao-numero importacao-ok"><strong>' + analise.novos.length + '</strong>' +
            '<span>' + (analise.novos.length === 1 ? 'contato novo' : 'contatos novos') + '</span></div>' +
          '<div class="importacao-numero"><strong>' + analise.repetidos.length + '</strong>' +
            '<span>já existiam</span></div>' +
          '<div class="importacao-numero"><strong>' + analise.semNome.length + '</strong>' +
            '<span>sem nome</span></div>' +
        '</div>' +

        '<div class="importacao-colunas">' +
          '<h3>Colunas reconhecidas</h3>' +
          '<ul>' + analise.reconhecidas.map(function (r) {
            return '<li><b>' + UI.esc(r.coluna) + '</b> → ' + UI.esc(campos[r.campo] || r.campo) + '</li>';
          }).join('') + '</ul>' +
          (analise.ignoradas.length
            ? '<p class="importacao-ignoradas">Ignoradas: ' +
              analise.ignoradas.map(UI.esc).join(', ') + '</p>'
            : '') +
        '</div>' +

        (analise.repetidos.length
          ? '<div class="importacao-aviso">' + analise.repetidos.length +
            ' linha(s) não serão importadas por já existirem aqui (mesmo telefone ou e-mail): ' +
            UI.esc(analise.repetidos.slice(0, 5).map(function (r) { return r.nome; }).join(', ')) +
            (analise.repetidos.length > 5 ? '…' : '') + '</div>'
          : '') +

        (analise.novos.length
          ? '<div class="importacao-previa"><h3>Primeiros contatos</h3>' +
            '<ul>' + analise.novos.slice(0, 5).map(function (l) {
              return '<li><b>' + UI.esc(l.nome) + '</b>' +
                (l.empresa ? ' · ' + UI.esc(l.empresa) : '') +
                (l.telefone ? ' · ' + UI.esc(l.telefone) : '') +
                ' · ' + UI.esc(DB.nomeEtapa(l.etapa)) + '</li>';
            }).join('') + '</ul></div>'
          : '') +

        '<footer class="modal-acoes">' +
          '<span class="espaco"></span>' +
          '<button type="button" class="btn btn-fantasma" data-fechar>Cancelar</button>' +
          '<button type="button" class="btn btn-primario" data-importar' +
            (analise.novos.length ? '' : ' disabled') + '>Importar ' + analise.novos.length + '</button>' +
        '</footer>' +
      '</div>';

    UI.abrirModal(html, function (caixa) {
      const botao = caixa.querySelector('[data-importar]');
      if (!botao || botao.disabled) return;
      botao.addEventListener('click', function () {
        const quantos = Importar.aplicar(analise.novos);
        UI.fecharModal();
        UI.toast(quantos + (quantos === 1 ? ' contato importado.' : ' contatos importados.'));
        render();
      });
    });
  }

  // -------------------------------------------------------------- segurança

  /** Tela da senha: ligar, trocar, trancar agora ou desligar o cofre. */
  function abrirSeguranca() {
    const ligado = Cofre.ligado();
    const total = DB.listar().length;

    const estado = !Cofre.suportado
      ? { classe: 'status-atencao',
          texto: 'Este navegador não oferece criptografia para páginas locais. Abra o CRM pelo ' +
                 '<b>iniciar.bat</b> (http://localhost) no Chrome ou no Edge.' }
      : (ligado
          ? { classe: 'status-ok',
              texto: 'Cofre <b>ligado</b>. Os ' + total + ' contatos e o backup em pasta são gravados ' +
                     'criptografados; sem a senha ninguém os abre, nem pelos arquivos. ' +
                     'Tranca sozinho após ' + Cofre.MINUTOS_INATIVO + ' minutos parado.' }
          : { classe: 'status-neutro',
              texto: 'Cofre <b>desligado</b>. Os contatos estão em texto puro no perfil do navegador — ' +
                     'quem entrar nesta conta do Windows consegue lê-los.' });

    const html =
      '<div class="backup">' +
        '<header class="modal-topo">' +
          '<div><h2>Senha e proteção dos dados</h2>' +
            '<p class="modal-subtitulo">Este app não manda nada para a internet. A questão aqui é ' +
              'quem tem acesso a este computador.</p></div>' +
          '<button type="button" class="icone-btn" data-fechar title="Fechar">' + UI.ICONES.fechar + '</button>' +
        '</header>' +

        '<div class="backup-status ' + estado.classe + '"><p>' + estado.texto + '</p>' +
          (ligado && Cofre.criadoEm()
            ? '<p class="backup-ultimo">Senha criada em ' + UI.data(Cofre.criadoEm().slice(0, 10)) + '.</p>'
            : '') +
        '</div>' +

        '<div class="backup-acoes">' +
          (ligado
            ? '<button type="button" class="btn btn-fantasma" data-trancar>Trancar agora</button>' +
              '<button type="button" class="btn btn-fantasma" data-trocar-senha>Trocar a senha</button>' +
              '<button type="button" class="btn btn-fantasma" data-desligar-cofre>Desligar o cofre</button>'
            : '<button type="button" class="btn btn-primario" data-criar-senha' +
              (Cofre.suportado ? '' : ' disabled') + '>Criar senha e criptografar</button>') +
        '</div>' +

        NuvemUI.blocoHTML() +

        '<div class="backup-manual">' +
          '<h3>O que a senha alcança</h3>' +
          '<ul class="lista-seguranca">' +
            '<li><b>Protege:</b> quem abre o navegador nesta máquina, quem copia a pasta de backup, ' +
              'quem vasculha o disco ou olha o F12.</li>' +
            '<li><b>Não protege:</b> alguém na sua frente com o app já aberto (use <kbd>Win</kbd>+<kbd>L</kbd> ' +
              'ao sair da mesa) nem vírus com captura de teclado.</li>' +
            '<li><b>Fica de fora:</b> o que você exporta em <b>CSV</b> sai em texto puro por natureza — ' +
              'é planilha para o Excel. Guarde esses arquivos com o mesmo cuidado.</li>' +
          '</ul>' +
        '</div>' +

        '<footer class="modal-acoes">' +
          '<span class="espaco"></span>' +
          '<button type="button" class="btn btn-fantasma" data-fechar>Fechar</button>' +
        '</footer>' +
      '</div>';

    UI.abrirModal(html, function (caixa) {
      function ligar(seletor, acao) {
        const botao = caixa.querySelector(seletor);
        if (botao && !botao.disabled) botao.addEventListener('click', acao);
      }

      NuvemUI.ligarBotoes(caixa, { render: render, pedirSenhas: pedirSenhas });

      ligar('[data-criar-senha]', function () {
        UI.fecharModal();
        Cofre.telaCriar(function (criou) {
          if (criou) UI.toast('Cofre ligado — os contatos agora são gravados criptografados.');
          render();
        });
      });

      ligar('[data-trancar]', function () { Cofre.trancar('Você trancou o CRM.'); });

      ligar('[data-trocar-senha]', function () {
        UI.fecharModal();
        pedirSenhas('Trocar a senha', 'Digite a senha atual e escolha a nova.',
                    true, function (atual, nova, mostrarErro) {
          Cofre.trocarSenha(atual, nova).then(function (r) {
            if (!r.ok) return mostrarErro(r.erro);
            UI.fecharModal();
            UI.toast('Senha trocada.');
          });
        });
      });

      ligar('[data-desligar-cofre]', function () {
        UI.fecharModal();
        pedirSenhas('Desligar o cofre',
                    'Os contatos voltam a ser gravados em texto puro neste computador. ' +
                    'Digite a senha atual para confirmar.',
                    false, function (atual, _nova, mostrarErro) {
          Cofre.desligar(atual).then(function (r) {
            if (!r.ok) return mostrarErro(r.erro);
            UI.fecharModal();
            UI.toast('Cofre desligado. Os dados voltaram a ficar em texto puro.', 'aviso');
            render();
          });
        });
      });
    });
  }

  /** Caixa reaproveitada para trocar senha e para desligar o cofre. */
  function pedirSenhas(titulo, texto, pedirNova, aoConfirmar) {
    const html =
      '<form class="form-senha" novalidate>' +
        '<header class="modal-topo">' +
          '<div><h2>' + UI.esc(titulo) + '</h2>' +
            '<p class="modal-subtitulo">' + UI.esc(texto) + '</p></div>' +
          '<button type="button" class="icone-btn" data-fechar title="Fechar">' + UI.ICONES.fechar + '</button>' +
        '</header>' +
        '<div class="form-grade">' +
          '<label class="campo campo-largo"><span>Senha atual</span>' +
            '<input type="password" name="atual" autocomplete="current-password" data-foco></label>' +
          (pedirNova
            ? '<label class="campo campo-largo"><span>Nova senha</span>' +
                '<input type="password" name="nova" autocomplete="new-password"></label>' +
              '<label class="campo campo-largo"><span>Repita a nova senha</span>' +
                '<input type="password" name="repetir" autocomplete="new-password"></label>'
            : '') +
        '</div>' +
        '<p class="cofre-erro" id="erro-senha" hidden></p>' +
        '<footer class="modal-acoes">' +
          '<span class="espaco"></span>' +
          '<button type="button" class="btn btn-fantasma" data-fechar>Cancelar</button>' +
          '<button type="submit" class="btn btn-primario">Confirmar</button>' +
        '</footer>' +
      '</form>';

    UI.abrirModal(html, function (caixa) {
      const form = caixa.querySelector('form');
      const erro = caixa.querySelector('#erro-senha');

      function mostrarErro(mensagem) {
        erro.textContent = mensagem;
        erro.hidden = false;
        form.querySelector('button[type="submit"]').disabled = false;
      }

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        const atual = form.querySelector('[name="atual"]').value;
        const nova = pedirNova ? form.querySelector('[name="nova"]').value : '';
        const repetir = pedirNova ? form.querySelector('[name="repetir"]').value : '';

        if (!atual) return mostrarErro('Digite a senha atual.');
        if (pedirNova && nova.length < 6) return mostrarErro('A nova senha precisa de pelo menos 6 caracteres.');
        if (pedirNova && nova !== repetir) return mostrarErro('A nova senha e a repetição não batem.');

        form.querySelector('button[type="submit"]').disabled = true;
        erro.hidden = true;
        aoConfirmar(atual, nova, mostrarErro);
      });
    });
  }

  // ------------------------------------------------------------------ backup

  /** Tela de backup: baixar agora, ligar a gravação automática numa pasta
      e restaurar um arquivo salvo. */
  function abrirBackup() {
    const info = Backup.estado();
    const total = DB.listar().length;

    let statusClasse = 'status-neutro';
    let statusTexto;
    if (info.ativo) {
      statusClasse = 'status-ok';
      statusTexto = 'Gravando sozinho na pasta <b>' + UI.esc(info.nomePasta) + '</b>, ' +
                    'poucos segundos depois de cada alteração.';
    } else if (info.precisaAutorizar) {
      statusClasse = 'status-atencao';
      statusTexto = 'A pasta está lembrada, mas o navegador precisa da sua autorização de novo ' +
                    '(isso acontece quando ele é reiniciado).';
    } else if (!info.suportado) {
      statusClasse = 'status-atencao';
      statusTexto = 'Este navegador não grava em pasta. Abra o CRM pelo <b>iniciar.bat</b> ' +
                    '(http://localhost) no Chrome ou no Edge para liberar o backup automático.';
    } else {
      statusTexto = 'Backup automático desligado — seus dados existem só neste navegador.';
    }

    const ultimo = info.ultimo
      ? 'Último backup: <b>' + UI.data(info.ultimo.slice(0, 10)) + '</b>' +
        (info.diasDesde === 0 ? ' (hoje)' : ' · há ' + UI.textoDias(info.diasDesde))
      : 'Nenhum backup feito até agora.';

    const html =
      '<div class="backup">' +
        '<header class="modal-topo">' +
          '<div><h2>Backup dos dados</h2>' +
            '<p class="modal-subtitulo">Os ' + total + ' contatos vivem no armazenamento deste navegador. ' +
              'Limpar os dados de navegação apaga tudo — por isso vale ter uma cópia em pasta.</p></div>' +
          '<button type="button" class="icone-btn" data-fechar title="Fechar">' + UI.ICONES.fechar + '</button>' +
        '</header>' +

        '<div class="backup-status ' + statusClasse + '">' +
          '<p>' + statusTexto + '</p>' +
          '<p class="backup-ultimo">' + ultimo + '</p>' +
        '</div>' +

        '<div class="backup-acoes">' +
          (info.ativo
            ? '<button type="button" class="btn btn-fantasma" data-gravar>Gravar agora</button>' +
              '<button type="button" class="btn btn-fantasma" data-trocar>Trocar de pasta</button>' +
              '<button type="button" class="btn btn-fantasma" data-desligar>Desligar automático</button>'
            : (info.precisaAutorizar
                ? '<button type="button" class="btn btn-primario" data-reautorizar>Reativar backup automático</button>' +
                  '<button type="button" class="btn btn-fantasma" data-trocar>Escolher outra pasta</button>'
                : '<button type="button" class="btn btn-primario" data-trocar' + (info.suportado ? '' : ' disabled') +
                  '>Escolher pasta e ligar automático</button>')) +
        '</div>' +

        '<div class="backup-manual">' +
          '<h3>Cópia manual</h3>' +
          '<p>Um arquivo <b>.json</b> com contatos, prazos e mensagens — serve para levar para outro computador.</p>' +
          '<div class="backup-acoes">' +
            '<button type="button" class="btn btn-fantasma" data-baixar>Baixar arquivo' +
              (Cofre.aberto() ? ' (protegido)' : '') + '</button>' +
            (Cofre.aberto()
              ? '<button type="button" class="btn btn-fantasma" data-baixar-puro>Baixar sem senha</button>'
              : '') +
            '<button type="button" class="btn btn-fantasma" data-restaurar>Restaurar de um arquivo</button>' +
          '</div>' +
        '</div>' +

        '<footer class="modal-acoes">' +
          '<span class="espaco"></span>' +
          '<button type="button" class="btn btn-fantasma" data-fechar>Fechar</button>' +
        '</footer>' +
      '</div>';

    UI.abrirModal(html, function (caixa) {
      function ligar(seletor, acao) {
        const botao = caixa.querySelector(seletor);
        if (botao) botao.addEventListener('click', acao);
      }

      function apos(promessa, mensagem) {
        promessa.then(function (ok) {
          if (ok === false) return;
          UI.toast(mensagem);
          renderAvisoBackup();
          abrirBackup();   // reabre com o estado novo
        }).catch(function (erro) {
          if (erro && erro.name === 'AbortError') return;   // fechou o seletor de pasta
          UI.toast(erro.message || 'Não consegui concluir.', 'erro');
        });
      }

      ligar('[data-trocar]', function () {
        apos(Backup.escolherPasta(), 'Backup automático ligado.');
      });
      ligar('[data-reautorizar]', function () {
        apos(Backup.reautorizar(), 'Backup automático reativado.');
      });
      ligar('[data-gravar]', function () {
        apos(Backup.gravarAgora(), 'Backup gravado na pasta.');
      });
      ligar('[data-desligar]', function () {
        apos(Backup.desligar(), 'Backup automático desligado.');
      });
      ligar('[data-baixar]', function () {
        Exportar.backupJSON().then(function () {
          Backup.registrarManual();
          renderAvisoBackup();
        });
      });
      ligar('[data-baixar-puro]', function () {
        UI.confirmar('Baixar sem senha',
                     'O arquivo sai legível por qualquer um. Use só para levar os dados para ' +
                     'outro lugar — e apague depois.',
                     'Baixar mesmo assim').then(function (ok) {
          if (ok) Exportar.backupJSON(true);
        });
      });
      ligar('[data-restaurar]', function () {
        document.getElementById('input-importar').click();
      });
    });
  }

  // ------------------------------------------------------- etapas do funil

  /* A tela de etapas trabalha sobre uma cópia em memória; só o botão Salvar
     grava. Assim dá para renomear, reordenar, criar e remover à vontade e
     desistir de tudo fechando a janela. */
  let etapasEmEdicao = null;

  function abrirEtapas() {
    if (!etapasEmEdicao) etapasEmEdicao = DB.etapas();
    const contagem = DB.contarPorEtapa();
    const todos = DB.listar();

    const linhas = etapasEmEdicao.map(function (etapa, i) {
      const quantos = contagem[etapa.id] || 0;
      const atrasados = todos.filter(function (l) {
        return l.etapa === etapa.id && DB.situacao(l) === 'atrasado';
      }).length;
      const novaEtapa = quantos === 0 && !DB.etapas().some(function (e) { return e.id === etapa.id; });

      return '<div class="etapa-linha" data-i="' + i + '" style="--cor:' + etapa.cor + '">' +
        '<div class="etapa-ordem">' +
          '<button type="button" class="icone-btn" data-subir title="Subir"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button type="button" class="icone-btn" data-descer title="Descer"' +
            (i === etapasEmEdicao.length - 1 ? ' disabled' : '') + '>▼</button>' +
        '</div>' +

        '<input type="color" class="etapa-cor" value="' + UI.esc(etapa.cor) + '" ' +
               'list="cores-sugeridas" aria-label="Cor da etapa" data-cor>' +

        '<div class="etapa-dados">' +
          '<input type="text" class="etapa-nome" value="' + UI.esc(etapa.nome) + '" ' +
                 'maxlength="28" placeholder="Nome da etapa" aria-label="Nome da etapa" data-nome>' +
          '<span class="etapa-info">' +
            (novaEtapa ? '<b class="etapa-nova">nova</b>' :
              quantos + (quantos === 1 ? ' lead' : ' leads') +
              (atrasados ? ' · <b>' + atrasados + ' fora do prazo</b>' : '')) +
          '</span>' +
        '</div>' +

        '<label class="etapa-prazo">' +
          '<input type="number" min="0" max="365" step="1" value="' + etapa.prazo + '" ' +
                 'aria-label="Dias ideais nesta etapa" data-prazo>' +
          '<small>dias</small>' +
        '</label>' +

        '<label class="etapa-retomada" title="Ao mover um lead para cá, o app pergunta quando retomar o contato">' +
          '<input type="checkbox"' + (etapa.perguntarRetomada ? ' checked' : '') + ' data-retomada>' +
          '<span>perguntar retomada</span>' +
        '</label>' +

        '<button type="button" class="icone-btn perigo" data-remover ' +
          (quantos > 0
            ? 'disabled title="Tem ' + quantos + (quantos === 1 ? ' lead' : ' leads') + ' aqui — mova antes de remover"'
            : (etapasEmEdicao.length <= 1 ? 'disabled title="O funil precisa de pelo menos uma etapa"'
                                          : 'title="Remover esta etapa"')) +
          '>' + UI.ICONES.lixeira + '</button>' +
      '</div>';
    }).join('');

    const html =
      '<div class="form-etapas">' +
        '<header class="modal-topo">' +
          '<div><h2>Etapas do funil</h2>' +
            '<p class="modal-subtitulo">Renomeie, reordene, crie e remova etapas. ' +
              'O <b>prazo</b> é quantos dias alguém pode ficar parado ali antes de virar cobrança ' +
              '(0 = sem prazo). Só dá para remover etapa vazia.</p></div>' +
          '<button type="button" class="icone-btn" data-fechar title="Fechar">' + UI.ICONES.fechar + '</button>' +
        '</header>' +

        '<datalist id="cores-sugeridas">' +
          ['#2E8BE6','#3FA986','#248A69','#14513E','#124E86','#7C8F89','#B7791F','#C0392B']
            .map(function (c) { return '<option value="' + c + '">'; }).join('') +
        '</datalist>' +

        '<div class="etapas-lista">' + linhas + '</div>' +

        '<button type="button" class="btn btn-fantasma btn-nova-etapa" data-nova>' +
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
          'Adicionar etapa</button>' +

        '<footer class="modal-acoes">' +
          '<button type="button" class="btn btn-fantasma" data-padrao>Restaurar funil padrão</button>' +
          '<span class="espaco"></span>' +
          '<button type="button" class="btn btn-fantasma" data-cancelar>Cancelar</button>' +
          '<button type="button" class="btn btn-primario" data-salvar>Salvar etapas</button>' +
        '</footer>' +
      '</div>';

    UI.abrirModal(html, function (caixa) {
      /* Antes de qualquer ação, recolhe o que está digitado na tela — assim
         renomear e depois reordenar não perde o texto. */
      const jaSalvas = {};
      DB.etapas().forEach(function (e) { jaSalvas[e.id] = true; });

      function coletar() {
        caixa.querySelectorAll('.etapa-linha').forEach(function (linha) {
          const i = Number(linha.dataset.i);
          const etapa = etapasEmEdicao[i];
          etapa.nome = linha.querySelector('[data-nome]').value.trim() || etapa.nome;
          etapa.cor = linha.querySelector('[data-cor]').value;
          etapa.prazo = Number(linha.querySelector('[data-prazo]').value) || 0;
          etapa.perguntarRetomada = linha.querySelector('[data-retomada]').checked;
          // Etapa ainda não gravada: o id acompanha o nome que está sendo digitado
          if (!jaSalvas[etapa.id]) etapa.id = '';
        });
      }

      caixa.querySelectorAll('.etapa-linha').forEach(function (linha) {
        const i = Number(linha.dataset.i);

        linha.querySelector('[data-subir]').addEventListener('click', function () {
          coletar();
          const troca = etapasEmEdicao[i - 1];
          etapasEmEdicao[i - 1] = etapasEmEdicao[i];
          etapasEmEdicao[i] = troca;
          abrirEtapas();
        });
        linha.querySelector('[data-descer]').addEventListener('click', function () {
          coletar();
          const troca = etapasEmEdicao[i + 1];
          etapasEmEdicao[i + 1] = etapasEmEdicao[i];
          etapasEmEdicao[i] = troca;
          abrirEtapas();
        });
        linha.querySelector('[data-remover]').addEventListener('click', function () {
          coletar();
          etapasEmEdicao.splice(i, 1);
          abrirEtapas();
        });
        // A cor muda na hora, para dar para ver o resultado
        linha.querySelector('[data-cor]').addEventListener('input', function (ev) {
          linha.style.setProperty('--cor', ev.target.value);
        });
      });

      caixa.querySelector('[data-nova]').addEventListener('click', function () {
        coletar();
        etapasEmEdicao.push(DB.novaEtapa('Nova etapa'));
        abrirEtapas();
      });

      caixa.querySelector('[data-padrao]').addEventListener('click', function () {
        etapasEmEdicao = DB.etapasPadrao();
        abrirEtapas();
      });

      caixa.querySelector('[data-cancelar]').addEventListener('click', function () {
        etapasEmEdicao = null;
        UI.fecharModal();
      });

      caixa.querySelector('[data-salvar]').addEventListener('click', function () {
        coletar();
        const resultado = DB.salvarEtapas(etapasEmEdicao);
        if (!resultado.ok) { UI.toast(resultado.erro, 'erro'); return; }
        etapasEmEdicao = null;
        UI.fecharModal();
        UI.toast('Etapas atualizadas.');
        render();
      });

      // Fechar pelo X ou pelo fundo também descarta a edição
      caixa.querySelector('[data-fechar]').addEventListener('click', function () { etapasEmEdicao = null; });
    });
  }

  function excluir(id) {
    const lead = DB.obter(id);
    if (!lead) return;
    UI.confirmar('Excluir lead',
                 'O lead "' + (lead.nome || 'sem nome') + '" será removido definitivamente.',
                 'Excluir').then(function (ok) {
      if (!ok) return;
      DB.remover(id);
      UI.fecharModal();
      UI.toast('Lead excluído.');
      render();
    });
  }

  // ------------------------------------------------------------ dados exemplo

  function carregarExemplos() {
    /* Datas relativas a hoje, para os exemplos sempre mostrarem tempos de
       etapa realistas (uns dentro do prazo, outros já atrasados). */
    function diasAtras(n) {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
             '-' + String(d.getDate()).padStart(2, '0');
    }

    /* Vários contatos repetem a origem de propósito: é o caso do "tenho 5
       contatos no Governo do Estado, mas falo com 2". */
    const exemplos = [
      { dataCriacao: diasAtras(40), etapaDesde: diasAtras(8), nome: 'Marina Alves',
        email: 'marina.alves@sefaz.rs.gov.br', telefone: '11987654321',
        cargo: 'Diretora de Operações', empresa: 'Governo do Estado — Sefaz', cidade: 'Porto Alegre', uf: 'RS',
        etapa: 'sinal-de-compra',
        observacoes: 'Pediu orçamento com 3 cenários. Prometeu retorno e sumiu — cobrar.',
        contatos: [
          { data: diasAtras(8),  canal: 'E-mail',   nota: 'Enviei o orçamento com os 3 cenários.' },
          { data: diasAtras(22), canal: 'Presencial', nota: 'Visita na secretaria. Gostou da proposta de manutenção.' },
          { data: diasAtras(38), canal: 'WhatsApp', nota: 'Primeiro contato, pediu para mandar material.' }
        ] },
      { dataCriacao: diasAtras(20), etapaDesde: diasAtras(3), nome: 'Rafael Menezes',
        email: 'rafael@detran.rs.gov.br', telefone: '4199887766',
        cargo: 'Chefe de Gabinete', empresa: 'Governo do Estado — Detran', cidade: 'Porto Alegre', uf: 'RS',
        etapa: 'relacionamento',
        aniversario: diasAtras(-6),
        observacoes: 'Conversa fluindo bem, é quem abre portas nas outras pastas.',
        contatos: [
          { data: diasAtras(3),  canal: 'WhatsApp', nota: 'Combinamos de falar de novo depois do feriado.' },
          { data: diasAtras(15), canal: 'Ligação',  nota: 'Apresentou a Juliana, da Saúde.' }
        ] },
      { dataCriacao: diasAtras(4), etapaDesde: diasAtras(4), nome: 'Juliana Prado',
        email: 'ju.prado@saude.rs.gov.br', telefone: '31988776655',
        cargo: 'Assessora', empresa: 'Governo do Estado — Saúde', cidade: 'Porto Alegre', uf: 'RS',
        etapa: 'novo-lead',
        observacoes: 'Apresentada pelo Rafael. Ainda não houve primeiro contato.' },
      { dataCriacao: diasAtras(30), etapaDesde: diasAtras(6), nome: 'Carlos Tavares',
        email: 'carlos.tavares@agrosul.com', telefone: '5499776655',
        cargo: 'Comprador', empresa: 'AgroSul Insumos', cidade: 'Passo Fundo', uf: 'RS',
        etapa: 'relacionamento',
        observacoes: 'Indicado pela Patrícia. Pediu para retomar depois da safra.' },
      { dataCriacao: diasAtras(90), etapaDesde: diasAtras(12), nome: 'Patrícia Gomes',
        email: 'patricia@lumierdesign.com.br', telefone: '2133445566',
        cargo: 'CEO', empresa: 'Lumiér Design', cidade: 'Rio de Janeiro', uf: 'RJ',
        etapa: 'cliente',
        observacoes: 'Cliente desde março. Sempre indica gente nova.' },
      { dataCriacao: diasAtras(210), etapaDesde: diasAtras(45), nome: 'Eduardo Lima',
        email: 'eduardo.lima@techpar.com', telefone: '4832221100',
        cargo: 'Diretor', empresa: 'TechPar Sistemas', cidade: 'Florianópolis', uf: 'SC',
        etapa: 'pos-venda',
        dataEspecial: diasAtras(-11), dataEspecialNome: 'Aniversário da empresa',
        observacoes: 'Cliente antigo, sem contato há tempo demais. Ligar.',
        contatos: [
          { data: diasAtras(45),  canal: 'E-mail', nota: 'Mandei a nota fiscal do último serviço.' },
          { data: diasAtras(120), canal: 'Ligação', nota: 'Tudo certo com a entrega.' }
        ] },
      { dataCriacao: diasAtras(0), etapaDesde: diasAtras(0), nome: 'Bianca Rocha',
        email: 'bianca@moveisrocha.com.br', telefone: '8532101122',
        cargo: 'Proprietária', empresa: 'Móveis Rocha', cidade: 'Fortaleza', uf: 'CE',
        etapa: 'novo-lead',
        observacoes: 'Indicação da Patrícia. Entrou hoje.' },
      { dataCriacao: diasAtras(25), etapaDesde: diasAtras(5), nome: 'Otávio Fernandes',
        email: 'otavio@prefeitura.salvador.ba.gov.br', telefone: '7133445566',
        cargo: 'Secretário adjunto', empresa: 'Prefeitura de Salvador — Obras', cidade: 'Salvador', uf: 'BA',
        etapa: 'sinal-de-compra',
        observacoes: 'Pediu prazo de entrega por escrito. Decide esta semana.' },
      // Esfriou com data combinada: fica quieto até a data e some do "fora do prazo".
      { dataCriacao: diasAtras(120), etapaDesde: diasAtras(60), proximoContato: diasAtras(-75),
        nome: 'Helena Barros', email: 'helena@barrosadvogados.com.br', telefone: '6132224455',
        cargo: 'Sócia', empresa: 'Barros Advogados', cidade: 'Brasília', uf: 'DF',
        etapa: 'esfriou',
        observacoes: 'Sem verba neste orçamento. Pediu para procurar no próximo semestre.' },
      // Esfriou sem data: aparece cobrando pelo prazo longo da etapa.
      { dataCriacao: diasAtras(300), etapaDesde: diasAtras(140), nome: 'Sérgio Nunes',
        email: 'sergio@transnunes.com', telefone: '1938776644',
        cargo: 'Diretor', empresa: 'Trans Nunes', cidade: 'Campinas', uf: 'SP',
        etapa: 'esfriou',
        observacoes: 'Trocou de fornecedor no ano passado. Vale um contato de aniversário da empresa.' }
    ];
    exemplos.forEach(function (e) { DB.criar(e); });
    UI.toast(exemplos.length + ' leads de exemplo carregados.');
    render();
  }

  // ------------------------------------------------------------------ eventos

  function trocarAba(aba) {
    estado.aba = aba;
    document.querySelectorAll('.aba').forEach(function (b) {
      const ativa = b.dataset.aba === aba;
      b.classList.toggle('ativa', ativa);
      b.setAttribute('aria-selected', ativa ? 'true' : 'false');
    });
    els.viewHoje.classList.toggle('ativa', aba === 'hoje');
    els.viewTabela.classList.toggle('ativa', aba === 'tabela');
    els.viewKanban.classList.toggle('ativa', aba === 'kanban');
    render();
  }

  function limparFiltros() {
    estado.busca = ''; estado.etapa = ''; estado.empresa = '';
    estado.uf = ''; estado.cidade = ''; estado.cobranca = '';
    els.busca.value = '';
    render();
  }

  /** Liga/desliga o filtro de cobrança ('atrasado' ou 'atencao'). */
  function alternarCobranca(qual) {
    estado.cobranca = estado.cobranca === qual ? '' : qual;
    render();
  }

  function ligarEventosGlobais() {
    document.querySelectorAll('.aba').forEach(function (b) {
      b.addEventListener('click', function () { trocarAba(b.dataset.aba); });
    });

    // Busca com pequeno atraso para não re-renderizar a cada tecla
    let timer = null;
    els.busca.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { estado.busca = els.busca.value; render(); }, 120);
    });

    els.filtroEtapa.addEventListener('change', function (e) { estado.etapa = e.target.value; render(); });
    els.filtroEmpresa.addEventListener('change', function (e) { estado.empresa = e.target.value; render(); });
    els.filtroUf.addEventListener('change', function (e) { estado.uf = e.target.value; render(); });
    els.filtroCidade.addEventListener('change', function (e) { estado.cidade = e.target.value; render(); });
    document.getElementById('btn-limpar-filtros').addEventListener('click', limparFiltros);

    // Filtros de cobrança: botão da barra e cliques nos indicadores do topo
    els.btnAtrasados.addEventListener('click', function () { alternarCobranca('atrasado'); });
    els.kpiCardAtrasados.addEventListener('click', function () { alternarCobranca('atrasado'); });
    els.kpiCardHoje.addEventListener('click', function () { alternarCobranca('atencao'); });

    document.getElementById('btn-etapas').addEventListener('click', abrirEtapas);
    document.getElementById('btn-modelos').addEventListener('click', abrirModelos);
    document.getElementById('btn-novo').addEventListener('click', function () { abrirFormulario(null); });
    document.getElementById('btn-exportar-csv').addEventListener('click', function () { Exportar.csv(leadsFiltrados()); });

    // Importar planilha .csv
    document.getElementById('btn-importar-csv').addEventListener('click', function () {
      document.getElementById('input-csv').click();
    });
    document.getElementById('input-csv').addEventListener('change', function (ev) {
      const arquivo = ev.target.files && ev.target.files[0];
      ev.target.value = '';   // permite reimportar o mesmo arquivo
      if (!arquivo) return;

      /* Planilha salva pelo Excel costuma vir em Windows-1252. Leio como UTF-8
         e, se aparecer caractere quebrado (), releio na outra codificação. */
      function ler(codificacao, aoTerminar) {
        const leitor = new FileReader();
        leitor.onload = function () { aoTerminar(String(leitor.result)); };
        leitor.onerror = function () { UI.toast('Não consegui ler o arquivo.', 'erro'); };
        leitor.readAsText(arquivo, codificacao);
      }

      function processar(texto) {
        const analise = Importar.analisar(texto);
        if (!analise.ok) { UI.toast(analise.erro, 'erro'); return; }
        abrirImportacao(analise, arquivo.name);
      }

      ler('utf-8', function (texto) {
        if (texto.indexOf('�') > -1) ler('windows-1252', processar);
        else processar(texto);
      });
    });
    document.getElementById('btn-backup').addEventListener('click', abrirBackup);
    document.getElementById('btn-seguranca').addEventListener('click', abrirSeguranca);

    document.getElementById('input-importar').addEventListener('change', function (ev) {
      const arquivo = ev.target.files && ev.target.files[0];
      if (!arquivo) return;
      const leitor = new FileReader();
      leitor.onload = function () {
        Exportar.importarJSON(String(leitor.result)).then(function (lista) {
          if (!lista) return;
          UI.confirmar('Restaurar backup',
                       'Os ' + DB.listar().length + ' contatos atuais serão substituídos pelos ' +
                       lista.length + ' do arquivo.',
                       'Restaurar').then(function (ok) {
            if (!ok) return;
            DB.substituirTudo(lista);
            UI.toast(lista.length + ' contatos restaurados.');
            render();
          });
        });
      };
      leitor.readAsText(arquivo, 'utf-8');
      ev.target.value = ''; // permite reimportar o mesmo arquivo
    });

    document.getElementById('btn-apagar-tudo').addEventListener('click', function () {
      UI.confirmar('Apagar todos os dados',
                   'Todos os leads salvos neste navegador serão removidos. Faça um backup antes se precisar.',
                   'Apagar tudo').then(function (ok) {
        if (!ok) return;
        DB.substituirTudo([]);
        UI.toast('Todos os leads foram apagados.');
        render();
      });
    });

    // Fechar modal: clique fora, botão X / Cancelar, tecla Esc.
    // Fechar de qualquer jeito descarta a edição de etapas em andamento.
    function fechar() { etapasEmEdicao = null; UI.fecharModal(); }

    document.getElementById('modal-fundo').addEventListener('mousedown', function (ev) {
      if (ev.target.id === 'modal-fundo') fechar();
    });
    document.getElementById('modal').addEventListener('click', function (ev) {
      if (ev.target.closest('[data-fechar]')) fechar();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && UI.modalAberto()) fechar();
    });

    // Botões dos estados vazios (existem só quando a lista está vazia)
    document.querySelector('.painel').addEventListener('click', function (ev) {
      const botao = ev.target.closest('[data-vazio]');
      if (!botao) return;
      if (botao.dataset.vazio === 'novo') abrirFormulario(null);
      if (botao.dataset.vazio === 'exemplos') carregarExemplos();
      if (botao.dataset.vazio === 'limpar') limparFiltros();
    });

    Hoje.ligarEventos(els.viewHoje);
    Tabela.ligarEventos(els.viewTabela);
    Kanban.ligarEventos(els.viewKanban);
  }

  function iniciar() {
    els.kpiTotal = document.getElementById('kpi-total');
    els.kpiTotalNota = document.getElementById('kpi-total-nota');
    els.kpiHoje = document.getElementById('kpi-hoje');
    els.kpiHojeNota = document.getElementById('kpi-hoje-nota');
    els.kpiCardHoje = document.getElementById('kpi-card-hoje');
    els.kpiAtrasados = document.getElementById('kpi-atrasados');
    els.kpiAtrasadosNota = document.getElementById('kpi-atrasados-nota');
    els.kpiCardAtrasados = document.getElementById('kpi-card-atrasados');
    els.btnAtrasados = document.getElementById('btn-filtro-atrasados');
    els.busca = document.getElementById('busca');
    els.filtroEtapa = document.getElementById('filtro-etapa');
    els.filtroEmpresa = document.getElementById('filtro-empresa');
    els.filtroUf = document.getElementById('filtro-uf');
    els.filtroCidade = document.getElementById('filtro-cidade');
    els.contador = document.getElementById('contador-resultados');
    els.dica = document.getElementById('dica-view');
    els.viewHoje = document.getElementById('view-hoje');
    els.viewTabela = document.getElementById('view-tabela');
    els.viewKanban = document.getElementById('view-kanban');
    els.seloHoje = document.getElementById('selo-hoje');
    els.seloBackup = document.getElementById('selo-backup');
    els.btnSeguranca = document.getElementById('btn-seguranca');
    els.rotuloSeguranca = document.getElementById('rotulo-seguranca');

    ligarEventosGlobais();
    render();

    // Sincronização: indicador, conflito e conferência ao voltar para a aba
    Nuvem.aoMudarEstado(NuvemUI.renderEstado);
    Nuvem.aoDetectarConflito(function (dados) {
      NuvemUI.tratarConflito(dados, render);
    });
    document.getElementById('pill-nuvem').addEventListener('click', abrirSeguranca);
    window.addEventListener('focus', function () {
      if (!Nuvem.ligada()) return;
      Nuvem.conferirNovidades().then(function (r) {
        if (!r.mudou) return;
        DB.carregarDeTexto(r.texto);
        render();
        UI.toast('Contatos atualizados por outro aparelho.');
      });
    });

    // Backup automático: reconecta a pasta autorizada e passa a gravar sozinho
    Backup.iniciar(renderAvisoBackup);
  }

  return {
    iniciar: iniciar,
    render: render,
    ordenarPor: ordenarPor,
    abrirFormulario: abrirFormulario,
    abrirDetalhes: abrirDetalhes,
    abrirEtapas: abrirEtapas,
    abrirModelos: abrirModelos,
    abrirBackup: abrirBackup,
    abrirAdiar: abrirAdiar,
    abrirWhatsApp: abrirWhatsApp,
    abrirRegistro: abrirRegistro,
    abrirImportacao: abrirImportacao,
    excluir: excluir,
    leadsFiltrados: leadsFiltrados,
    htmlVazio: htmlVazio
  };
})();

/* Com o cofre ligado, a tela de senha aparece antes de qualquer dado ser
   carregado; sem cofre, o app começa direto. */
document.addEventListener('DOMContentLoaded', function () {
  // Aparelho já conectado ao repositório: senha, download e só então o app
  if (Nuvem.configurada()) {
    NuvemUI.telaEntrar(App.iniciar);
    return;
  }
  const trancado = Cofre.iniciar(function (textoDecifrado) {
    DB.carregarDeTexto(textoDecifrado);
    App.iniciar();
  });
  if (!trancado) App.iniciar();
});

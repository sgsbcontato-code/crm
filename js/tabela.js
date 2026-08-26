/* =============================================================================
   tabela.js — Visualização em tabela, com ordenação e edição direta na célula.
   Clicar numa célula abre o editor adequado ao tipo do campo (texto, data,
   origem, select de UF/etapa ou textarea de observações).
   ============================================================================= */

const Tabela = (function () {
  'use strict';

  /* Definição das colunas: tipo controla como a célula é exibida e editada. */
  const COLUNAS = [
    { campo: 'dataCriacao',       titulo: 'Criado em',   tipo: 'data',   classe: 'col-data' },
    { campo: 'nome',              titulo: 'Nome',        tipo: 'texto',  classe: 'col-nome' },
    { campo: 'email',             titulo: 'E-mail',      tipo: 'email',  classe: 'col-email' },
    { campo: 'telefone',          titulo: 'Telefone',    tipo: 'tel',    classe: 'col-tel' },
    { campo: 'empresa',           titulo: 'Empresa / origem', tipo: 'empresa', classe: 'col-origem' },
    { campo: 'uf',                titulo: 'UF',          tipo: 'uf',     classe: 'col-uf' },
    { campo: 'cidade',            titulo: 'Cidade',      tipo: 'cidade', classe: 'col-cidade' },
    { campo: 'etapa',             titulo: 'Etapa do funil',     tipo: 'etapa', classe: 'col-etapa' },
    // Coluna calculada: mostra os dias na etapa, mas edita a data de entrada.
    { campo: 'etapaDesde',        titulo: 'Dias na etapa',      tipo: 'dias',  classe: 'col-dias' },
    { campo: 'proximoContato',    titulo: 'Próximo contato',    tipo: 'contato', classe: 'col-contato' },
    { campo: 'observacoes',       titulo: 'Observações', tipo: 'nota',   classe: 'col-obs' }
  ];

  let container = null;

  // ------------------------------------------------------------------ conteúdo

  function conteudoCelula(lead, col) {
    const valor = lead[col.campo];
    switch (col.tipo) {
      case 'data':  return UI.data(valor);
      case 'empresa': return valor ? '<span class="chip-origem">' + UI.esc(valor) + '</span>' : vazio();
      case 'etapa': return UI.badgeEtapa(valor);
      case 'dias':  return UI.pillDias(lead);
      case 'contato': return UI.pillContato(lead);
      case 'email': return valor ? '<span class="celula-truncada" title="' + UI.esc(valor) + '">' + UI.esc(valor) + '</span>' : vazio();
      case 'tel':   return valor ? UI.esc(UI.telefone(valor)) : vazio();
      case 'nota':  return valor
        ? '<span class="celula-truncada" title="' + UI.esc(valor) + '">' + UI.esc(valor) + '</span>'
        : '<span class="vazio">+ nota</span>';
      case 'uf':    return valor ? UI.esc(valor) : vazio();
      default:      return valor ? UI.esc(valor) : vazio();
    }
  }

  function vazio() { return '<span class="vazio">—</span>'; }

  function cabecalho(ordem) {
    return COLUNAS.map(function (col) {
      const ativo = ordem.campo === col.campo;
      const seta = ativo ? (ordem.dir === 'asc' ? '▲' : '▼') : '';
      return '<th class="' + col.classe + (ativo ? ' ordenado' : '') + '" data-ordenar="' + col.campo + '" ' +
             'title="Ordenar por ' + UI.esc(col.titulo) + '">' +
             UI.esc(col.titulo) + '<span class="seta">' + seta + '</span></th>';
    }).join('') + '<th class="col-acoes">Ações</th>';
  }

  function linha(lead) {
    const celulas = COLUNAS.map(function (col) {
      return '<td class="' + col.classe + ' editavel" data-campo="' + col.campo + '" data-tipo="' + col.tipo + '">' +
             conteudoCelula(lead, col) + '</td>';
    }).join('');

    const acoes =
      '<td class="col-acoes"><div class="acoes-linha">' +
        (Zap.temWhatsApp(lead)
          ? '<button type="button" class="icone-btn zap" data-acao="zap" title="' + UI.esc(Zap.dica(lead)) + '">' +
              UI.ICONES.whatsapp + '</button>'
          : '<span class="icone-btn vazio-zap" title="' + UI.esc(Zap.dica(lead)) + '">' + UI.ICONES.whatsapp + '</span>') +
        '<button type="button" class="icone-btn" data-acao="falei" title="Registrar contato">' + UI.ICONES.check + '</button>' +
        '<button type="button" class="icone-btn" data-acao="adiar" title="Adiar contato">' + UI.ICONES.adiar + '</button>' +
        '<button type="button" class="icone-btn" data-acao="ver" title="Ver detalhes">' + UI.ICONES.olho + '</button>' +
        '<button type="button" class="icone-btn" data-acao="editar" title="Editar">' + UI.ICONES.lapis + '</button>' +
        '<button type="button" class="icone-btn perigo" data-acao="excluir" title="Excluir">' + UI.ICONES.lixeira + '</button>' +
      '</div></td>';

    return '<tr data-id="' + lead.id + '">' + celulas + acoes + '</tr>';
  }

  // -------------------------------------------------------------------- render

  function render(el, leads, ordem) {
    container = el;

    if (!leads.length) {
      el.innerHTML = App.htmlVazio();
      return;
    }

    el.innerHTML =
      '<div class="tabela-wrapper"><table class="tabela">' +
        '<thead><tr>' + cabecalho(ordem) + '</tr></thead>' +
        '<tbody>' + leads.map(linha).join('') + '</tbody>' +
      '</table></div>';
  }

  // ----------------------------------------------------- edição direta na célula

  function editarCelula(td) {
    if (td.classList.contains('editando')) return;

    const tr = td.closest('tr');
    const id = tr.dataset.id;
    const campo = td.dataset.campo;
    const tipo = td.dataset.tipo;
    const lead = DB.obter(id);
    if (!lead) return;

    const original = td.innerHTML;
    let editor;
    let extra = null;   // elemento auxiliar (datalist), inserido junto do editor

    if (tipo === 'etapa' || tipo === 'uf') {
      editor = document.createElement('select');
      const opcoes = tipo === 'etapa'
        ? DB.etapas().map(function (e) { return { valor: e.id, rotulo: e.nome }; })
        : [''].concat(DB.UFS).map(function (u) { return { valor: u, rotulo: u === '' ? '—' : u }; });
      opcoes.forEach(function (op) {
        const o = document.createElement('option');
        o.value = op.valor;
        o.textContent = op.rotulo;
        if (op.valor === lead[campo]) o.selected = true;
        editor.appendChild(o);
      });
    } else if (tipo === 'nota') {
      editor = document.createElement('textarea');
      editor.rows = 3;
      editor.value = lead[campo];
      editor.placeholder = 'Nota rápida… (Esc cancela)';
    } else {
      editor = document.createElement('input');
      editor.type = (tipo === 'data' || tipo === 'dias' || tipo === 'contato') ? 'date'
                                                         : (tipo === 'email' ? 'email' : 'text');
      editor.value = lead[campo];
      // Na coluna de dias o que se edita é a data de entrada na etapa.
      if (tipo === 'dias') editor.title = 'Data em que o lead entrou na etapa atual';
      /* Sugestões: empresa/origem puxa o que já existe (para não nascerem três
         grafias da mesma coisa) e cidade puxa os municípios da UF do lead. */
      if (tipo === 'empresa' || tipo === 'cidade') {
        extra = document.createElement('datalist');
        extra.id = 'sugestoes-celula';
        const valores = tipo === 'empresa' ? DB.empresas() : DB.cidadesDe(lead.uf);
        valores.forEach(function (v) {
          const op = document.createElement('option');
          op.value = v;
          extra.appendChild(op);
        });
        editor.setAttribute('list', extra.id);
        if (tipo === 'cidade' && !lead.uf) editor.title = 'Preencha a UF para ver as cidades do estado';
      }
    }

    editor.className = 'editor-celula';
    td.classList.add('editando');
    td.innerHTML = '';
    if (extra) td.appendChild(extra);
    td.appendChild(editor);
    editor.focus();
    if (editor.select) editor.select();

    let encerrado = false;

    function salvar() {
      if (encerrado) return;
      encerrado = true;
      const valor = editor.value.trim();
      if (String(valor) !== String(lead[campo])) {
        const mudancas = {};
        mudancas[campo] = valor;
        DB.atualizar(id, mudancas);
        App.render();
      } else {
        td.classList.remove('editando');
        td.innerHTML = original;
      }
    }

    function cancelar() {
      if (encerrado) return;
      encerrado = true;
      td.classList.remove('editando');
      td.innerHTML = original;
    }

    editor.addEventListener('blur', salvar);
    editor.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelar();
      } else if (ev.key === 'Enter' && (tipo !== 'nota' || ev.ctrlKey)) {
        ev.preventDefault();
        salvar();
      }
    });
    // Nos selects, escolher já confirma.
    if (editor.tagName === 'SELECT') {
      editor.addEventListener('change', salvar);
    }
  }

  // ----------------------------------------------------------------- eventos

  function ligarEventos(el) {
    el.addEventListener('click', function (ev) {
      const th = ev.target.closest('th[data-ordenar]');
      if (th) { App.ordenarPor(th.dataset.ordenar); return; }

      const botao = ev.target.closest('button[data-acao]');
      if (botao) {
        const id = botao.closest('tr').dataset.id;
        if (botao.dataset.acao === 'zap') App.abrirWhatsApp(id);
        if (botao.dataset.acao === 'falei') App.abrirRegistro(id);
        if (botao.dataset.acao === 'adiar') App.abrirAdiar(id);
        if (botao.dataset.acao === 'ver') App.abrirDetalhes(id);
        if (botao.dataset.acao === 'editar') App.abrirFormulario(id);
        if (botao.dataset.acao === 'excluir') App.excluir(id);
        return;
      }

      const td = ev.target.closest('td.editavel');
      if (td && el.contains(td)) editarCelula(td);
    });
  }

  return { render: render, ligarEventos: ligarEventos, COLUNAS: COLUNAS };
})();

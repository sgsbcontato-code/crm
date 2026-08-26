/* =============================================================================
   kanban.js — Visualização em colunas por etapa do funil, com arrastar e soltar.
   Soltar o card em outra coluna grava a nova etapa direto no banco local.
   ============================================================================= */

const Kanban = (function () {
  'use strict';

  let idArrastado = null;

  // -------------------------------------------------------------------- render

  function card(lead) {
    const etapa = DB.etapa(lead.etapa);
    const linhaEmpresa = lead.empresa
      ? '<span class="card-linha">' + UI.ICONES.predio + UI.esc(lead.empresa) + '</span>' : '';
    const local = [lead.cidade, lead.uf].filter(Boolean).join(' / ');
    const linhaLocal = local
      ? '<span class="card-linha">' + UI.ICONES.pin + UI.esc(local) + '</span>' : '';
    const nota = lead.observacoes
      ? '<span class="card-nota" title="' + UI.esc(lead.observacoes) + '">' + UI.ICONES.nota +
        UI.esc(lead.observacoes) + '</span>' : '';

    return '' +
      '<article class="card" draggable="true" data-id="' + lead.id + '" style="--cor:' + etapa.cor + '">' +
        '<header class="card-topo">' +
          '<span class="avatar" style="background:' + etapa.fundo + ';color:' + etapa.cor + '">' +
            UI.esc(UI.iniciais(lead.nome)) + '</span>' +
          '<div class="card-identidade">' +
            '<strong>' + UI.esc(lead.nome || 'Sem nome') + '</strong>' +
            (lead.cargo ? '<span>' + UI.esc(lead.cargo) + '</span>' : '') +
          '</div>' +
          (Zap.temWhatsApp(lead)
            ? '<button type="button" class="icone-btn card-acao zap" data-acao="zap" title="' +
                UI.esc(Zap.dica(lead)) + '">' + UI.ICONES.whatsapp + '</button>'
            : '') +
          '<button type="button" class="icone-btn card-acao" data-acao="adiar" title="Adiar contato">' +
            UI.ICONES.adiar + '</button>' +
        '</header>' +
        '<div class="card-corpo">' + linhaEmpresa + linhaLocal + '</div>' +
        nota +
        '<footer class="card-rodape">' +
          (DB.ultimoContato(lead)
            ? '<span class="card-ultimo" title="Último contato registrado">' + UI.ICONES.historico +
              UI.textoHa(DB.diasDesdeUltimoContato(lead)) + '</span>'
            : '<span class="card-ultimo card-sem-contato" title="Nenhum contato registrado">' +
              UI.ICONES.historico + 'sem contato</span>') +
          // Uma pílula só: a data combinada, quando existe, é o que vale.
          (DB.temContatoAgendado(lead) ? UI.pillContato(lead, true) : UI.pillDias(lead, true)) +
        '</footer>' +
      '</article>';
  }

  function coluna(etapa, leads) {
    const prazo = etapa.prazo;
    const atrasados = leads.filter(function (l) { return DB.situacao(l) === 'atrasado'; }).length;

    return '' +
      '<section class="coluna" data-etapa="' + UI.esc(etapa.id) + '" style="--cor:' + etapa.cor + '">' +
        '<header class="coluna-topo">' +
          '<span class="coluna-titulo">' + UI.esc(etapa.nome) + '</span>' +
          '<span class="coluna-contador">' + leads.length + '</span>' +
        '</header>' +
        '<div class="coluna-resumo">' +
          '<span class="coluna-prazo" title="Prazo ideal nesta etapa (clique para alterar)">' +
            UI.ICONES.relogio + (prazo ? 'ideal ' + prazo + 'd' : 'sem prazo') + '</span>' +
          (atrasados ? '<span class="coluna-atrasados">' + atrasados + ' atrasado' +
                       (atrasados > 1 ? 's' : '') + '</span>' : '') +
        '</div>' +
        '<div class="coluna-lista" data-etapa="' + UI.esc(etapa.id) + '">' +
          (leads.length ? leads.map(card).join('')
                        : '<p class="coluna-vazia">Arraste leads para cá</p>') +
        '</div>' +
      '</section>';
  }

  function render(el, leads) {
    const etapas = DB.etapas();
    const porEtapa = {};
    etapas.forEach(function (e) { porEtapa[e.id] = []; });
    leads.forEach(function (lead) { (porEtapa[lead.etapa] || porEtapa[etapas[0].id]).push(lead); });

    el.innerHTML = '<div class="quadro">' +
      etapas.map(function (etapa) { return coluna(etapa, porEtapa[etapa.id]); }).join('') +
      '</div>';
  }

  // ------------------------------------------------------- arrastar e soltar

  function ligarEventos(el) {
    el.addEventListener('click', function (ev) {
      // O prazo no topo da coluna leva direto à configuração de prazos.
      if (ev.target.closest('.coluna-prazo')) { App.abrirEtapas(); return; }

      const card = ev.target.closest('.card');
      if (!card) return;
      if (ev.target.closest('[data-acao="zap"]')) { App.abrirWhatsApp(card.dataset.id); return; }
      if (ev.target.closest('[data-acao="adiar"]')) { App.abrirAdiar(card.dataset.id); return; }
      App.abrirDetalhes(card.dataset.id);
    });

    el.addEventListener('dragstart', function (ev) {
      const card = ev.target.closest('.card');
      if (!card) return;
      idArrastado = card.dataset.id;
      card.classList.add('arrastando');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', idArrastado);
    });

    el.addEventListener('dragend', function (ev) {
      const card = ev.target.closest('.card');
      if (card) card.classList.remove('arrastando');
      el.querySelectorAll('.coluna-lista.sobre').forEach(function (c) { c.classList.remove('sobre'); });
      idArrastado = null;
    });

    el.addEventListener('dragover', function (ev) {
      const lista = ev.target.closest('.coluna-lista');
      if (!lista) return;
      ev.preventDefault();                 // libera o drop nesta coluna
      ev.dataTransfer.dropEffect = 'move';
      if (!lista.classList.contains('sobre')) lista.classList.add('sobre');
    });

    el.addEventListener('dragleave', function (ev) {
      const lista = ev.target.closest('.coluna-lista');
      if (lista && !lista.contains(ev.relatedTarget)) lista.classList.remove('sobre');
    });

    el.addEventListener('drop', function (ev) {
      const lista = ev.target.closest('.coluna-lista');
      if (!lista) return;
      ev.preventDefault();
      lista.classList.remove('sobre');

      const id = idArrastado || ev.dataTransfer.getData('text/plain');
      const novaEtapa = lista.dataset.etapa;
      const lead = id ? DB.obter(id) : null;
      if (!lead || lead.etapa === novaEtapa) return;

      DB.atualizar(id, { etapa: novaEtapa });
      App.render();
      UI.toast(lead.nome + ' → ' + DB.nomeEtapa(novaEtapa));

      /* Etapa marcada como "perguntar quando retomar" (a faixa lenta) sem data
         combinada é o jeito mais fácil de esquecer alguém — então já pergunto. */
      if (DB.etapa(novaEtapa).perguntarRetomada && !lead.proximoContato) App.abrirAdiar(id);
    });
  }

  return { render: render, ligarEventos: ligarEventos };
})();

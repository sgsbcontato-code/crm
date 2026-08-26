/* =============================================================================
   hoje.js — A aba "Hoje": a rotina da manhã em uma tela.

   Mostra, em ordem de urgência, quem passou da hora, quem é para hoje, as datas
   especiais chegando e o que vence nos próximos dias — cada um com os botões
   de agir ali mesmo (WhatsApp, registrar contato, adiar).
   ============================================================================= */

const Hoje = (function () {
  'use strict';

  const JANELA_PROXIMOS = 7;   // dias à frente que aparecem em "próximos"
  const JANELA_DATAS = 15;     // antecedência para avisar de aniversários

  // ------------------------------------------------------------------ agrupar

  function agrupar(leads) {
    const grupos = { atrasados: [], hoje: [], datas: [], proximos: [] };

    leads.forEach(function (lead) {
      const situacao = DB.situacao(lead);
      if (situacao === 'atrasado') grupos.atrasados.push(lead);
      else if (situacao === 'atencao') grupos.hoje.push(lead);
      else {
        const faltam = DB.diasParaCobranca(lead);
        if (faltam !== null && faltam > 0 && faltam <= JANELA_PROXIMOS) grupos.proximos.push(lead);
      }

      // Aniversário e data especial entram na lista própria, mesmo em dia
      const proxima = DB.proximaData(lead);
      if (proxima && proxima.faltam <= JANELA_DATAS) grupos.datas.push(lead);
    });

    grupos.atrasados.sort(function (a, b) { return DB.diasParaCobranca(a) - DB.diasParaCobranca(b); });
    grupos.proximos.sort(function (a, b) { return DB.diasParaCobranca(a) - DB.diasParaCobranca(b); });
    grupos.datas.sort(function (a, b) { return DB.proximaData(a).faltam - DB.proximaData(b).faltam; });
    grupos.hoje.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
    return grupos;
  }

  // -------------------------------------------------------------------- linha

  /** Frase curta explicando por que o lead está nesta lista. */
  function motivo(lead, tipo) {
    if (tipo === 'data') {
      const proxima = DB.proximaData(lead);
      if (!proxima) return '';
      if (proxima.faltam === 0) return UI.esc(proxima.rotulo) + ' é <b>hoje</b>';
      return UI.esc(proxima.rotulo) + ' em <b>' + UI.textoDias(proxima.faltam) + '</b>';
    }

    const faltam = DB.diasParaCobranca(lead);
    const agendado = DB.temContatoAgendado(lead);

    if (faltam === null) return 'sem prazo definido';
    if (faltam < 0) {
      return agendado
        ? 'combinado para ' + UI.data(lead.proximoContato) + ' — <b>passou há ' + UI.textoDias(-faltam) + '</b>'
        : '<b>parado há ' + UI.textoDias(DB.diasNaEtapa(lead)) + '</b> em ' + UI.esc(DB.nomeEtapa(lead.etapa)) +
          ' (ideal ' + DB.prazoDe(lead.etapa) + ')';
    }
    if (faltam === 0) return agendado ? '<b>combinado para hoje</b>' : '<b>último dia</b> do prazo de ' + UI.esc(DB.nomeEtapa(lead.etapa));
    return 'em ' + UI.textoDias(faltam) + (agendado ? ' (combinado)' : ' pelo prazo da etapa');
  }

  function linha(lead, tipo) {
    const etapa = DB.etapa(lead.etapa);
    const ultimo = DB.ultimoContato(lead);
    const diasUltimo = DB.diasDesdeUltimoContato(lead);
    const temZap = Zap.temWhatsApp(lead);

    const rodape = [];
    if (lead.empresa) rodape.push('<span class="chip-origem">' + UI.esc(lead.empresa) + '</span>');
    rodape.push(UI.badgeEtapa(lead.etapa));
    if (ultimo) {
      rodape.push('<span class="hoje-ultimo" title="' + UI.esc(ultimo.nota || 'sem anotação') + '">' +
        UI.ICONES.historico + 'último: ' + UI.esc(ultimo.canal) + ' ' + UI.textoHa(diasUltimo) + '</span>');
    } else {
      rodape.push('<span class="hoje-ultimo hoje-nunca">' + UI.ICONES.historico + 'nenhum contato registrado</span>');
    }

    return '' +
      '<article class="hoje-linha" data-id="' + lead.id + '" style="--cor:' + etapa.cor + '">' +
        '<span class="avatar" style="background:' + etapa.fundo + ';color:' + etapa.cor + '">' +
          UI.esc(UI.iniciais(lead.nome)) + '</span>' +

        '<div class="hoje-corpo">' +
          '<div class="hoje-topo">' +
            '<strong>' + UI.esc(lead.nome || 'Sem nome') + '</strong>' +
            (lead.empresa ? '<span class="hoje-empresa">' + UI.esc(lead.empresa) + '</span>' : '') +
          '</div>' +
          '<div class="hoje-motivo">' + motivo(lead, tipo) + '</div>' +
          '<div class="hoje-rodape">' + rodape.join('') + '</div>' +
        '</div>' +

        '<div class="hoje-acoes">' +
          (temZap
            ? '<button type="button" class="btn btn-zap" data-acao="zap" title="' + UI.esc(Zap.dica(lead)) + '">' +
                UI.ICONES.whatsapp + 'WhatsApp</button>'
            : '<span class="btn btn-zap desabilitado" title="' + UI.esc(Zap.dica(lead)) + '">' +
                UI.ICONES.whatsapp + 'sem zap</span>') +
          '<button type="button" class="btn btn-fantasma" data-acao="falei" title="Registrar que você falou com essa pessoa">' +
            UI.ICONES.check + 'Falei</button>' +
          '<button type="button" class="icone-btn" data-acao="adiar" title="Adiar contato">' + UI.ICONES.adiar + '</button>' +
          '<button type="button" class="icone-btn" data-acao="ver" title="Abrir a ficha">' + UI.ICONES.olho + '</button>' +
        '</div>' +
      '</article>';
  }

  function bloco(titulo, descricao, leads, tipo, classe) {
    if (!leads.length) return '';
    return '<section class="hoje-bloco ' + classe + '">' +
      '<header class="hoje-bloco-topo">' +
        '<h3>' + UI.esc(titulo) + '<span class="hoje-contador">' + leads.length + '</span></h3>' +
        '<p>' + UI.esc(descricao) + '</p>' +
      '</header>' +
      leads.map(function (l) { return linha(l, tipo); }).join('') +
    '</section>';
  }

  // ------------------------------------------------------------------- render

  function render(el, leads) {
    const g = agrupar(leads);
    const vazio = !g.atrasados.length && !g.hoje.length && !g.datas.length && !g.proximos.length;

    if (vazio) {
      el.innerHTML = '<div class="estado-vazio hoje-limpo">' +
        '<svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
        '<h3>Nada pendente por aqui</h3>' +
        '<p>' + (leads.length
          ? 'Todos os ' + leads.length + ' contatos desta lista estão dentro do prazo. Bom dia livre.'
          : 'Nenhum lead nesta seleção — ajuste os filtros ou cadastre alguém.') + '</p>' +
      '</div>';
      return;
    }

    el.innerHTML = '<div class="hoje">' +
      bloco('Passou da hora', 'Deviam ter sido contatados e não foram.', g.atrasados, 'cobranca', 'bloco-atrasado') +
      bloco('Falar hoje', 'É o dia combinado ou o último dia do prazo.', g.hoje, 'cobranca', 'bloco-hoje') +
      bloco('Datas especiais', 'Uma mensagem aqui vale por dez follow-ups.', g.datas, 'data', 'bloco-data') +
      bloco('Próximos dias', 'Chegando nos próximos ' + JANELA_PROXIMOS + ' dias — dá para adiantar.',
            g.proximos, 'cobranca', 'bloco-proximo') +
    '</div>';
  }

  // ----------------------------------------------------------------- eventos

  function ligarEventos(el) {
    el.addEventListener('click', function (ev) {
      const botao = ev.target.closest('[data-acao]');
      if (!botao) return;
      const id = botao.closest('.hoje-linha').dataset.id;
      const lead = DB.obter(id);
      if (!lead) return;

      switch (botao.dataset.acao) {
        case 'zap':   App.abrirWhatsApp(id); break;
        case 'falei': App.abrirRegistro(id); break;
        case 'adiar': App.abrirAdiar(id); break;
        case 'ver':   App.abrirDetalhes(id); break;
      }
    });
  }

  return { render: render, ligarEventos: ligarEventos };
})();

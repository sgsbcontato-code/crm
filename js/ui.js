/* =============================================================================
   ui.js — Helpers de interface: formatação, ícones, modal, toast e confirmação.
   ============================================================================= */

const UI = (function () {
  'use strict';

  // ------------------------------------------------------------- formatadores

  function esc(valor) {
    return String(valor == null ? '' : valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 'YYYY-MM-DD' -> 'DD/MM/YYYY' (sem passar por Date, para não pegar fuso). */
  function data(iso) {
    if (!iso || iso.length < 10) return '—';
    const p = iso.slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  /** Máscara leve de telefone brasileiro; devolve o original se não bater. */
  function telefone(valor) {
    const d = String(valor || '').replace(/\D/g, '');
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return String(valor || '');
  }

  function iniciais(nome) {
    const partes = String(nome || '?').trim().split(/\s+/);
    const a = partes[0] ? partes[0][0] : '?';
    const b = partes.length > 1 ? partes[partes.length - 1][0] : '';
    return (a + b).toUpperCase();
  }

  /** Etiqueta colorida da etapa do funil (recebe o id da etapa). */
  function badgeEtapa(idEtapa) {
    const e = DB.etapa(idEtapa);
    return '<span class="badge" style="color:' + e.cor + ';background:' + e.fundo +
           ';border-color:' + e.cor + '33">' + esc(e.nome) + '</span>';
  }

  /** "3 dias", "hoje", "1 dia" — tempo em texto curto. */
  function textoDias(dias) {
    if (dias <= 0) return 'hoje';
    return dias + (dias === 1 ? ' dia' : ' dias');
  }

  /** Tempo passado: "hoje", "ontem", "há 5 dias". */
  function textoHa(dias) {
    if (dias <= 0) return 'hoje';
    if (dias === 1) return 'ontem';
    return 'há ' + dias + ' dias';
  }

  /** Pílula de tempo na etapa, colorida conforme o prazo ideal configurado.
      `curta` deixa só o número (para caber no card do Kanban).
      Havendo data combinada de retomada, esta pílula fica neutra: quem manda
      na cobrança passa a ser o próximo contato. */
  function pillDias(lead, curta) {
    const dias = DB.diasNaEtapa(lead);
    const prazo = DB.prazoDe(lead.etapa);
    const agendado = DB.temContatoAgendado(lead);
    const situacao = agendado ? 'neutro' : DB.situacao(lead);
    const titulo = 'Na etapa desde ' + data(lead.etapaDesde) +
                   (prazo ? ' · prazo ideal de ' + textoDias(prazo) : ' · etapa sem prazo definido') +
                   (agendado ? ' · prazo da etapa substituído pelo contato de ' + data(lead.proximoContato)
                             : (situacao === 'atrasado' ? ' · atrasado, retome o contato' : ''));
    const conteudo = curta
      ? (dias <= 0 ? 'hoje' : dias + 'd') + (prazo ? '<small>/' + prazo + 'd</small>' : '')
      : textoDias(dias) + (prazo ? ' <small>de ' + prazo + '</small>' : '');
    return '<span class="pill-dias pill-' + situacao + '" title="' + esc(titulo) + '">' + conteudo + '</span>';
  }

  /** Pílula do próximo contato combinado. Sem data, devolve um convite a
      agendar (na tabela) ou nada (no card do Kanban). */
  function pillContato(lead, curta) {
    if (!DB.temContatoAgendado(lead)) {
      return curta ? '' : '<span class="vazio">+ agendar</span>';
    }
    const faltam = DB.diasParaContato(lead);
    const situacao = DB.situacao(lead);
    const titulo = 'Retomar o contato em ' + data(lead.proximoContato) +
                   (faltam < 0 ? ' · passou há ' + textoDias(-faltam) : '');

    let texto;
    if (faltam > 0)       texto = curta ? 'em ' + faltam + 'd' : 'em ' + textoDias(faltam);
    else if (faltam === 0) texto = 'hoje';
    else                   texto = curta ? '+' + (-faltam) + 'd' : 'há ' + textoDias(-faltam);

    return '<span class="pill-dias pill-contato pill-' + situacao + '" title="' + esc(titulo) + '">' +
           ICONES.agenda + texto +
           (curta ? '' : ' <small>' + data(lead.proximoContato) + '</small>') + '</span>';
  }

  // -------------------------------------------------------------------- ícones

  const ICONES = {
    olho:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    lapis:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    lixeira: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
    nota:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v10l-4 4H4z"/><path d="M20 15h-4v4"/><path d="M8 9h8M8 12h5"/></svg>',
    mail:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    fone:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    predio:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V6l8-3v18"/><path d="M12 9h8v12"/><path d="M8 9v.01M8 13v.01M8 17v.01M16 13v.01M16 17v.01"/></svg>',
    pin:     '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    cracha:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2"/><path d="M8 12h8M8 16h5"/></svg>',
    fechar:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    agenda:  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    adiar:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5"/><path d="m18.5 3.5 2.5 2M5.5 3.5 3 5.5"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.03s.87 2.35.99 2.51c.12.16 1.71 2.61 4.15 3.66.58.25 1.03.4 1.39.51.58.19 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.11-.22-.17-.47-.29z"/></svg>',
    check:   '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    historico: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></svg>',
    presente: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18"/><path d="M12 8S9.5 3.5 7.5 4.5 9 8 12 8zM12 8s2.5-4.5 4.5-3.5S15 8 12 8z"/></svg>'
  };

  // --------------------------------------------------------------------- toast

  let timerToast = null;
  function toast(mensagem, tipo) {
    const el = document.getElementById('toast');
    el.textContent = mensagem;
    el.className = 'toast ' + (tipo || 'ok');
    el.hidden = false;
    // reinicia a animação
    void el.offsetWidth;
    el.classList.add('visivel');
    clearTimeout(timerToast);
    timerToast = setTimeout(function () {
      el.classList.remove('visivel');
      timerToast = setTimeout(function () { el.hidden = true; }, 250);
    }, 2600);
  }

  // --------------------------------------------------------------------- modal

  function abrirModal(html, aoMontar) {
    const fundo = document.getElementById('modal-fundo');
    const caixa = document.getElementById('modal');
    caixa.innerHTML = html;
    fundo.hidden = false;
    document.body.classList.add('sem-scroll');
    if (typeof aoMontar === 'function') aoMontar(caixa);

    // Foca o primeiro campo do formulário, se houver
    const primeiro = caixa.querySelector('[data-foco], input, textarea, select');
    if (primeiro) primeiro.focus();
  }

  function fecharModal() {
    const fundo = document.getElementById('modal-fundo');
    fundo.hidden = true;
    document.getElementById('modal').innerHTML = '';
    document.body.classList.remove('sem-scroll');
  }

  function modalAberto() {
    return !document.getElementById('modal-fundo').hidden;
  }

  /** Confirmação com visual do app (usa overlay próprio para empilhar sobre o modal). */
  function confirmar(titulo, texto, rotuloOk) {
    return new Promise(function (resolve) {
      const fundo = document.createElement('div');
      fundo.className = 'modal-fundo';
      fundo.innerHTML =
        '<div class="modal modal-pequeno" role="alertdialog" aria-modal="true">' +
          '<h3 class="modal-titulo">' + esc(titulo) + '</h3>' +
          '<p class="modal-texto">' + esc(texto) + '</p>' +
          '<div class="modal-acoes">' +
            '<button type="button" class="btn btn-fantasma" data-nao>Cancelar</button>' +
            '<button type="button" class="btn btn-perigo" data-sim>' + esc(rotuloOk || 'Confirmar') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(fundo);
      fundo.querySelector('[data-sim]').focus();

      function encerrar(resposta) {
        document.body.removeChild(fundo);
        document.removeEventListener('keydown', aoTeclar, true);
        resolve(resposta);
      }
      function aoTeclar(ev) {
        if (ev.key === 'Escape') { ev.stopPropagation(); encerrar(false); }
      }
      fundo.querySelector('[data-sim]').addEventListener('click', function () { encerrar(true); });
      fundo.querySelector('[data-nao]').addEventListener('click', function () { encerrar(false); });
      fundo.addEventListener('mousedown', function (ev) { if (ev.target === fundo) encerrar(false); });
      document.addEventListener('keydown', aoTeclar, true);
    });
  }

  /** Dispara o download de um arquivo gerado em memória. */
  function baixarArquivo(nomeArquivo, conteudo, tipoMime) {
    const blob = new Blob([conteudo], { type: tipoMime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  return {
    esc: esc, data: data,
    telefone: telefone, iniciais: iniciais, badgeEtapa: badgeEtapa,
    textoDias: textoDias, textoHa: textoHa, pillDias: pillDias, pillContato: pillContato,
    ICONES: ICONES, toast: toast,
    abrirModal: abrirModal, fecharModal: fecharModal, modalAberto: modalAberto,
    confirmar: confirmar, baixarArquivo: baixarArquivo
  };
})();

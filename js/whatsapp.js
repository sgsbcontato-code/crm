/* =============================================================================
   whatsapp.js — Abre a conversa no WhatsApp com a mensagem já digitada.

   Usa o link oficial `wa.me`, que abre o app do desktop (se instalado) ou o
   WhatsApp Web. O app NUNCA envia nada sozinho: só deixa o texto pronto para
   você conferir e apertar enviar.

   O que não é possível por aqui (exigiria a API paga do WhatsApp Business):
   ler conversas, saber se a pessoa respondeu ou enviar automaticamente.
   ============================================================================= */

const Zap = (function () {
  'use strict';

  const DDI = '55';

  /** Analisa o telefone do lead e diz se dá para chamar no WhatsApp.
      Devolve { ok, numero, ajustado, motivo }. */
  function analisar(telefone) {
    let d = String(telefone || '').replace(/\D/g, '');
    if (!d) return { ok: false, motivo: 'sem telefone' };

    // Tira o DDI, se o número já vier com ele
    if (d.length > 11 && d.indexOf(DDI) === 0) d = d.slice(DDI.length);

    if (d.length === 11) {
      // DDD + 9 dígitos: celular
      return { ok: true, numero: DDI + d, ajustado: false };
    }

    if (d.length === 10) {
      const primeiro = d.charAt(2);
      if (primeiro >= '6') {
        // Celular antigo, sem o nono dígito — a numeração ganhou o 9 em todo o país
        return { ok: true, numero: DDI + d.slice(0, 2) + '9' + d.slice(2), ajustado: true };
      }
      return { ok: false, motivo: 'telefone fixo não tem WhatsApp' };
    }

    return { ok: false, motivo: 'número incompleto (falta DDD?)' };
  }

  function temWhatsApp(lead) {
    return analisar(lead.telefone).ok;
  }

  /** Troca {nome}, {empresa}, {origem} e {cidade} pelos dados do lead. */
  function preencher(modelo, lead) {
    const primeiro = String(lead.nome || '').trim().split(/\s+/)[0] || '';
    return String(modelo || '')
      .replace(/\{nome\}/g, primeiro)
      .replace(/\{nomeCompleto\}/g, lead.nome || '')
      .replace(/\{empresa\}/g, lead.empresa || '')
      .replace(/\{origem\}/g, lead.origem || '')
      .replace(/\{cidade\}/g, lead.cidade || '')
      .trim();
  }

  /** Mensagem que vai abrir digitada, conforme a etapa do lead. */
  function mensagem(lead) {
    return preencher(DB.modeloDe(lead.etapa), lead);
  }

  /** Monta o link da conversa. `semTexto` abre o chat em branco. */
  function link(lead, semTexto) {
    const info = analisar(lead.telefone);
    if (!info.ok) return null;
    const texto = (semTexto || DB.abrirSemTexto()) ? '' : mensagem(lead);
    return 'https://wa.me/' + info.numero + (texto ? '?text=' + encodeURIComponent(texto) : '');
  }

  /** Abre a conversa numa aba nova. Devolve false se o número não serve. */
  function abrir(lead, semTexto) {
    const url = link(lead, semTexto);
    if (!url) return false;
    window.open(url, '_blank', 'noopener');
    return true;
  }

  /** Texto do "title" do botão, explicando o que vai acontecer. */
  function dica(lead) {
    const info = analisar(lead.telefone);
    if (!info.ok) return 'Sem WhatsApp: ' + info.motivo;
    const texto = DB.abrirSemTexto() ? '' : mensagem(lead);
    return 'Abrir conversa no WhatsApp' +
           (info.ajustado ? ' (nono dígito acrescentado)' : '') +
           (texto ? ' com: "' + texto.slice(0, 90) + (texto.length > 90 ? '…' : '') + '"'
                  : ' (sem texto)');
  }

  return {
    analisar: analisar,
    temWhatsApp: temWhatsApp,
    preencher: preencher,
    mensagem: mensagem,
    link: link,
    abrir: abrir,
    dica: dica
  };
})();

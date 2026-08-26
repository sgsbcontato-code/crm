/* =============================================================================
   db.js — Camada de dados
   Toda leitura/escrita passa por aqui. A persistência é local (localStorage do
   navegador); trocar de mecanismo depois é só reescrever `lerBruto` e `gravar`.
   ============================================================================= */

const DB = (function () {
  'use strict';

  const CHAVE = 'crm_local_leads_v1';
  const CHAVE_ETAPAS = 'crm_local_etapas_v1';
  const CHAVE_PRAZOS = 'crm_local_prazos_v1';    // formato antigo, só para migrar
  const CHAVE_MODELOS = 'crm_local_modelos_v1';

  /* Etapas do funil, na ordem em que aparecem no Kanban. O usuário pode
     renomear, reordenar, acrescentar e remover pela tela "Etapas".

     Cada etapa tem um `id` que NUNCA muda: é ele que fica gravado no lead, no
     prazo e na mensagem. Assim renomear "Esfriou" para "Congelado" não mexe em
     nenhum dado — só no rótulo que aparece na tela. */
  const ETAPAS_PADRAO = [
    { id: 'novo-lead',       nome: 'Novo Lead',       cor: '#2E8BE6', prazo: 2,  perguntarRetomada: false },
    { id: 'relacionamento',  nome: 'Relacionamento',  cor: '#3FA986', prazo: 7,  perguntarRetomada: false },
    { id: 'sinal-de-compra', nome: 'Sinal de Compra', cor: '#248A69', prazo: 5,  perguntarRetomada: false },
    { id: 'cliente',         nome: 'Cliente',         cor: '#14513E', prazo: 30, perguntarRetomada: false },
    { id: 'pos-venda',       nome: 'Pós-venda',       cor: '#124E86', prazo: 30, perguntarRetomada: false },
    // Faixa lenta: quem não vai fechar agora, mas não pode ser esquecido.
    { id: 'esfriou',         nome: 'Esfriou',         cor: '#7C8F89', prazo: 90, perguntarRetomada: true }
  ];

  /* Etapas do funil antigo (8 etapas) → funil atual. */
  const ETAPAS_ANTIGAS = {
    'Em atendimento IA':   'relacionamento',
    'Atendimento Humano':  'relacionamento',
    'Reunião Agendada':    'sinal-de-compra',
    'Proposta Enviada':    'sinal-de-compra',
    'Ganho':               'cliente',
    'Perdido':             'esfriou',
    'Sem interesse':       'esfriou'
  };

  /* Antes de existir a etapa "Esfriou", Perdido/Sem interesse caíam em
     "Novo Lead" com uma marca nas observações. Agora vão para o lugar certo. */
  const MARCA_ETAPA_ANTIGA = /^\[etapa anterior: (Perdido|Sem interesse)\]\s*/;

  const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
               'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

  /** Canais de contato registrados no histórico. */
  const CANAIS = ['WhatsApp', 'Ligação', 'E-mail', 'Presencial', 'Outro'];

  /* Campos de texto do lead + valor padrão. O histórico (`contatos`) é uma
     lista e fica fora deste mapa, tratado à parte em `normalizar`. */
  const CAMPOS = {
    dataCriacao: '',
    nome: '',
    email: '',
    telefone: '',
    cargo: '',
    empresa: '',         // empresa/origem: de onde vem o contato
    observacoes: '',
    cidade: '',
    uf: '',
    etapa: ETAPAS_PADRAO[0].id,   // guarda o id da etapa, não o nome
    etapaDesde: '',      // data em que o lead entrou na etapa atual
    proximoContato: '',  // data combinada para retomar; vence o prazo da etapa
    aniversario: '',     // aniversário da pessoa
    dataEspecial: '',    // outra data que merece contato (fundação, contrato…)
    dataEspecialNome: '' // o que é a data especial
  };

  /* Mensagens que abrem no WhatsApp, por id de etapa. {nome}, {empresa} e
     {origem} são trocados pelos dados do lead na hora de montar o link.
     Etapa criada pelo usuário começa sem mensagem — ele escreve a dele. */
  const MODELOS_PADRAO = {
    'novo-lead':       'Olá {nome}, tudo bem? Aqui é o [SEU NOME], da [SUA EMPRESA]. Consegui seu contato e queria me apresentar — posso te mandar por aqui o que a gente faz?',
    'relacionamento':  'Oi {nome}, tudo certo? Passando para saber como andam as coisas por aí na {empresa}. Precisando de alguma coisa, é só chamar.',
    'sinal-de-compra': 'Oi {nome}, tudo bem? Sobre o que conversamos, ficou alguma dúvida? Posso preparar os detalhes para você avaliar.',
    'cliente':         'Oi {nome}, tudo bem? Só passando para saber se está tudo certo por aí. Qualquer coisa, estou à disposição.',
    'pos-venda':       'Oi {nome}, tudo bem? Faz um tempo que não nos falamos — como estão as coisas na {empresa}?',
    'esfriou':         'Oi {nome}, tudo bem? Lembrei de você por aqui. Como andam as coisas na {empresa}? Se fizer sentido retomarmos aquela conversa, me avise.'
  };

  let cache = null;    // lista carregada em memória, sincronizada com o localStorage
  let etapas = null;   // [{ id, nome, cor, prazo, perguntarRetomada }]
  let modelos = null;  // { 'novo-lead': 'texto…', ..., _semTexto: false }
  const ouvintes = []; // avisados a cada gravação (usado pelo backup automático)

  // ---------------------------------------------------------------- utilidades

  function gerarId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function paraISO(d) {
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mes + '-' + dia;
  }

  function hoje() {
    return paraISO(new Date());
  }

  /* Diferença em dias entre duas datas 'YYYY-MM-DD', contada em horário local
     e sem fuso: monta as datas ao meio-dia para o horário de verão não zoar. */
  function diasEntre(isoInicio, isoFim) {
    if (!isoInicio || !isoFim) return 0;
    const a = isoInicio.split('-'), b = isoFim.split('-');
    const d1 = new Date(+a[0], +a[1] - 1, +a[2], 12);
    const d2 = new Date(+b[0], +b[1] - 1, +b[2], 12);
    return Math.round((d2 - d1) / 86400000);
  }

  /** Mistura a cor com branco — gera o fundo claro da etiqueta da etapa. */
  function clarear(hex, proporcao) {
    const limpo = String(hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(limpo)) return '#EFF3F1';
    const n = parseInt(limpo, 16);
    const canais = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return '#' + canais.map(function (v) {
      return Math.round(v + (255 - v) * proporcao).toString(16).padStart(2, '0');
    }).join('');
  }

  /** Transforma um nome em id: "Sinal de Compra" -> "sinal-de-compra". */
  function paraId(nome) {
    const base = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return base || ('etapa-' + Math.random().toString(36).slice(2, 7));
  }

  function normalizarEtapa(bruta, usados) {
    const nome = String(bruta && bruta.nome ? bruta.nome : 'Etapa').trim() || 'Etapa';
    let id = bruta && bruta.id ? String(bruta.id) : paraId(nome);
    // Dois ids iguais quebrariam a ligação com os leads: desempata
    while (usados && usados[id]) id = id + '-2';
    if (usados) usados[id] = true;

    const prazo = Number(bruta && bruta.prazo);
    const cor = /^#[0-9a-fA-F]{6}$/.test(bruta && bruta.cor) ? bruta.cor : '#7C8F89';
    return {
      id: id,
      nome: nome,
      cor: cor,
      fundo: clarear(cor, 0.87),
      prazo: isFinite(prazo) && prazo >= 0 ? Math.round(prazo) : 0,
      perguntarRetomada: Boolean(bruta && bruta.perguntarRetomada)
    };
  }

  function normalizarEtapas(lista) {
    const usados = {};
    const saida = (Array.isArray(lista) ? lista : [])
      .map(function (e) { return normalizarEtapa(e, usados); });
    return saida.length ? saida : ETAPAS_PADRAO.map(function (e) { return normalizarEtapa(e, {}); });
  }

  function garantirEtapas() {
    if (etapas !== null) return etapas;
    let salvas = null;
    try {
      salvas = JSON.parse(localStorage.getItem(CHAVE_ETAPAS) || 'null');
    } catch (erro) {
      console.error('Etapas salvas inválidas, usando as padrão:', erro);
    }

    if (Array.isArray(salvas) && salvas.length) {
      etapas = normalizarEtapas(salvas);
      return etapas;
    }

    etapas = normalizarEtapas(ETAPAS_PADRAO);

    // Migração: os prazos ficavam numa chave à parte, indexados pelo nome
    try {
      const antigos = JSON.parse(localStorage.getItem(CHAVE_PRAZOS) || 'null');
      if (antigos && typeof antigos === 'object') {
        etapas.forEach(function (e) {
          const n = Number(antigos[e.nome]);
          if (isFinite(n) && n >= 0) e.prazo = Math.round(n);
        });
        localStorage.setItem(CHAVE_ETAPAS, JSON.stringify(etapas));
      }
    } catch (erro) {
      console.error('Não consegui migrar os prazos antigos:', erro);
    }
    return etapas;
  }

  function normalizarContato(bruto) {
    return {
      data:  bruto && bruto.data ? String(bruto.data).slice(0, 10) : hoje(),
      canal: bruto && CANAIS.indexOf(bruto.canal) > -1 ? bruto.canal : 'Outro',
      nota:  bruto && bruto.nota ? String(bruto.nota) : ''
    };
  }

  /* Garante que todo registro tenha todos os campos e os tipos certos —
     protege contra backups antigos ou arquivos editados à mão. */
  function normalizar(bruto) {
    const lead = { id: bruto && bruto.id ? String(bruto.id) : gerarId() };

    Object.keys(CAMPOS).forEach(function (campo) {
      const valor = bruto ? bruto[campo] : undefined;
      lead[campo] = valor == null ? CAMPOS[campo] : String(valor);
    });

    /* Empresa e origem viraram um campo só. Registros antigos têm os dois:
       o que estiver preenchido vale; se os dois têm texto diferente, ficam
       juntos para nada se perder — depois é só editar a linha. */
    const origemAntiga = bruto && bruto.origem ? String(bruto.origem).trim() : '';
    if (origemAntiga) {
      const empresa = lead.empresa.trim();
      if (!empresa) lead.empresa = origemAntiga;
      else if (empresa !== origemAntiga) lead.empresa = empresa + ' / ' + origemAntiga;
    }

    // A data especial que se chamava "Aniversário" passa para o campo próprio
    if (!lead.aniversario && lead.dataEspecial &&
        /anivers[áa]rio$/i.test(lead.dataEspecialNome.trim())) {
      lead.aniversario = lead.dataEspecial;
      lead.dataEspecial = '';
      lead.dataEspecialNome = '';
    }

    // Histórico de contatos, do mais recente para o mais antigo
    lead.contatos = (bruto && Array.isArray(bruto.contatos) ? bruto.contatos : [])
      .map(normalizarContato)
      .sort(function (a, b) { return b.data.localeCompare(a.data); });

    if (!lead.dataCriacao) lead.dataCriacao = hoje();

    /* A etapa é guardada por id. Registros antigos guardavam o nome — aqui eles
       são convertidos, seja de um nome atual, seja do funil de 8 etapas. */
    const listaEtapas = garantirEtapas();
    if (!listaEtapas.some(function (e) { return e.id === lead.etapa; })) {
      const porNome = listaEtapas.find(function (e) { return e.nome === lead.etapa; });
      lead.etapa = porNome ? porNome.id : (ETAPAS_ANTIGAS[lead.etapa] || listaEtapas[0].id);
      // Etapa antiga que não existe mais neste funil cai na primeira
      if (!listaEtapas.some(function (e) { return e.id === lead.etapa; })) {
        lead.etapa = listaEtapas[0].id;
      }
    }

    // Perdido/Sem interesse que a versão anterior jogou em "Novo Lead"
    if (lead.etapa === 'novo-lead' && MARCA_ETAPA_ANTIGA.test(lead.observacoes) &&
        listaEtapas.some(function (e) { return e.id === 'esfriou'; })) {
      lead.observacoes = lead.observacoes.replace(MARCA_ETAPA_ANTIGA, '');
      lead.etapa = 'esfriou';
    }

    // Sem carimbo de etapa (lead antigo), assume a data de criação
    if (!lead.etapaDesde) lead.etapaDesde = lead.dataCriacao;

    lead.uf = lead.uf.toUpperCase().slice(0, 2);
    lead.atualizadoEm = bruto && bruto.atualizadoEm ? bruto.atualizadoEm : new Date().toISOString();
    return lead;
  }

  // ------------------------------------------------------------- persistência

  /* Trava de segurança: se o que está gravado estiver cifrado e não houver como
     abrir, o app NÃO grava por cima — melhor ficar sem dados na tela do que
     substituir o arquivo bom por uma lista vazia. */
  let bloqueado = false;

  function cofreLigado() {
    return typeof Cofre !== 'undefined' && Cofre.ligado();
  }

  function cofreAberto() {
    return typeof Cofre !== 'undefined' && Cofre.aberto();
  }

  function lerBruto() {
    try {
      const texto = localStorage.getItem(CHAVE);
      if (!texto) return [];
      const dados = JSON.parse(texto);
      if (dados && dados.cifrado) {
        bloqueado = true;
        console.error('Os contatos estão criptografados e o cofre não foi aberto.');
        return [];
      }
      return Array.isArray(dados) ? dados.map(normalizar) : [];
    } catch (erro) {
      console.error('Não foi possível ler os dados salvos:', erro);
      return [];
    }
  }

  function gravar() {
    if (bloqueado) return false;
    if (cofreLigado() && !cofreAberto()) return false;   // trancado: não mexe no arquivo
    try {
      const json = JSON.stringify(cache || []);
      if (cofreAberto()) Cofre.gravar(CHAVE, json);      // cifra e grava (assíncrono)
      else localStorage.setItem(CHAVE, json);
      // Sincroniza com o repositório, se estiver conectado
      if (typeof Nuvem !== 'undefined' && Nuvem.ligada()) Nuvem.agendarEnvio();
      ouvintes.forEach(function (fn) { fn(); });
      return true;
    } catch (erro) {
      console.error('Não foi possível salvar:', erro);
      return false;
    }
  }

  function garantirCache() {
    if (cache === null) {
      // Com o cofre trancado, nada é carregado até a senha ser digitada
      if (cofreLigado() && !cofreAberto()) return [];
      cache = lerBruto();
    }
    return cache;
  }

  // ------------------------------------------------------------------ modelos

  function garantirModelos() {
    if (modelos !== null) return modelos;
    modelos = Object.assign({ _semTexto: false }, MODELOS_PADRAO);
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_MODELOS) || 'null');
      if (salvo && typeof salvo === 'object') {
        Object.keys(salvo).forEach(function (chave) {
          if (typeof salvo[chave] === 'string') modelos[chave] = salvo[chave];
        });
        modelos._semTexto = Boolean(salvo._semTexto);
      }
    } catch (erro) {
      console.error('Modelos salvos inválidos, usando os padrões:', erro);
    }

    // Versão anterior guardava as mensagens pelo nome da etapa
    garantirEtapas().forEach(function (e) {
      if (modelos[e.id] === undefined && typeof modelos[e.nome] === 'string') {
        modelos[e.id] = modelos[e.nome];
      }
    });
    return modelos;
  }

  // ---------------------------------------------------------------------- API

  return {
    ETAPAS_PADRAO: ETAPAS_PADRAO,
    UFS: UFS,
    CAMPOS: CAMPOS,
    CANAIS: CANAIS,
    MODELOS_PADRAO: MODELOS_PADRAO,
    hoje: hoje,
    diasEntre: diasEntre,

    /** Chamado a cada gravação — o backup automático se pendura aqui. */
    aoGravar: function (fn) { ouvintes.push(fn); },

    /** Conteúdo cru, para o cofre cifrar e para o backup. */
    paraTexto: function () { return JSON.stringify(garantirCache()); },

    /** Carrega a base a partir do texto decifrado pelo cofre. */
    carregarDeTexto: function (texto) {
      let lista = [];
      try {
        const dados = texto ? JSON.parse(texto) : [];
        if (Array.isArray(dados)) lista = dados;
      } catch (erro) {
        console.error('Conteúdo decifrado ilegível:', erro);
      }
      cache = lista.map(normalizar);
      bloqueado = false;
      return cache.length;
    },

    /** Devolve cópias, para ninguém alterar o cache sem passar por `atualizar`. */
    listar: function () {
      return garantirCache().map(function (l) {
        const copia = Object.assign({}, l);
        copia.contatos = l.contatos.map(function (c) { return Object.assign({}, c); });
        return copia;
      });
    },

    obter: function (id) {
      const achado = garantirCache().find(function (l) { return l.id === id; });
      if (!achado) return null;
      const copia = Object.assign({}, achado);
      copia.contatos = achado.contatos.map(function (c) { return Object.assign({}, c); });
      return copia;
    },

    criar: function (dados) {
      const lead = normalizar(Object.assign({}, dados, { id: null }));
      lead.id = gerarId();
      if (!dados || !dados.etapaDesde) lead.etapaDesde = lead.dataCriacao;
      garantirCache().unshift(lead);
      gravar();
      return Object.assign({}, lead);
    },

    /** Atualiza só os campos enviados em `mudancas`.
        Mudou de etapa? O carimbo `etapaDesde` reinicia hoje — a não ser que a
        própria chamada informe uma data (edição manual pelo formulário). */
    atualizar: function (id, mudancas) {
      const lista = garantirCache();
      const i = lista.findIndex(function (l) { return l.id === id; });
      if (i === -1) return null;

      const antes = lista[i];
      const mudouEtapa = mudancas.etapa && mudancas.etapa !== antes.etapa;
      const novo = Object.assign({}, antes, mudancas, { id: id });
      if (mudouEtapa && !mudancas.etapaDesde) novo.etapaDesde = hoje();

      lista[i] = normalizar(novo);
      lista[i].atualizadoEm = new Date().toISOString();
      gravar();
      return this.obter(id);
    },

    remover: function (id) {
      const lista = garantirCache();
      const i = lista.findIndex(function (l) { return l.id === id; });
      if (i === -1) return false;
      lista.splice(i, 1);
      gravar();
      return true;
    },

    /** Usado pela importação de backup e pelo "apagar tudo". */
    substituirTudo: function (lista) {
      cache = (Array.isArray(lista) ? lista : []).map(normalizar);
      gravar();
      return cache.length;
    },

    // ------------------------------------------------------------------ etapas

    /** Etapas do funil, na ordem do Kanban. */
    etapas: function () {
      return garantirEtapas().map(function (e) { return Object.assign({}, e); });
    },

    /** Etapa pelo id (cai na primeira se o id não existir mais). */
    etapa: function (id) {
      const lista = garantirEtapas();
      return Object.assign({}, lista.find(function (e) { return e.id === id; }) || lista[0]);
    },

    nomeEtapa: function (id) { return this.etapa(id).nome; },

    /** Quantos leads estão em cada etapa — usado pela tela de etapas. */
    contarPorEtapa: function () {
      const contagem = {};
      garantirEtapas().forEach(function (e) { contagem[e.id] = 0; });
      garantirCache().forEach(function (l) {
        contagem[l.etapa] = (contagem[l.etapa] || 0) + 1;
      });
      return contagem;
    },

    /** Grava a lista inteira de etapas (renomear, reordenar, criar, remover).
        Recusa se alguma etapa com leads dentro estiver saindo da lista. */
    salvarEtapas: function (lista) {
      const nova = normalizarEtapas(lista);
      const contagem = this.contarPorEtapa();
      const idsNovos = {};
      nova.forEach(function (e) { idsNovos[e.id] = true; });

      const perdidas = garantirEtapas().filter(function (e) {
        return !idsNovos[e.id] && contagem[e.id] > 0;
      });
      if (perdidas.length) {
        return { ok: false, erro: 'A etapa "' + perdidas[0].nome + '" ainda tem lead. ' +
                                  'Mova quem está lá antes de remover.' };
      }

      etapas = nova;
      localStorage.setItem(CHAVE_ETAPAS, JSON.stringify(etapas));
      // Um lead pode ter ficado órfão se a etapa vazia dele sumiu
      cache = garantirCache().map(normalizar);
      gravar();
      return { ok: true, etapas: this.etapas() };
    },

    /** Volta ao funil de fábrica (só quando dá para reencaixar todo mundo). */
    etapasPadrao: function () {
      return ETAPAS_PADRAO.map(function (e) { return normalizarEtapa(e, {}); });
    },

    /** Sugere um id novo a partir do nome, sem colidir com os existentes. */
    novaEtapa: function (nome) {
      const usados = {};
      garantirEtapas().forEach(function (e) { usados[e.id] = true; });
      return normalizarEtapa({ nome: nome || 'Nova etapa', cor: '#3FA986', prazo: 7 }, usados);
    },

    /** Empresas/origens já usadas — alimenta o filtro e o autocompletar. */
    empresas: function () {
      const vistas = {};
      garantirCache().forEach(function (l) { if (l.empresa) vistas[l.empresa] = true; });
      return Object.keys(vistas).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    },

    /** Outros contatos da mesma empresa/origem — "no Governo do Estado tenho 5". */
    daEmpresa: function (empresa, excetoId) {
      if (!empresa) return [];
      return this.listar().filter(function (l) {
        return l.empresa === empresa && l.id !== excetoId;
      });
    },

    /** Cidades da UF, do IBGE (ou as já usadas, se a UF não vier). */
    cidadesDe: function (uf) {
      const lista = (typeof CIDADES !== 'undefined' && CIDADES[String(uf).toUpperCase()]) || null;
      if (lista) return lista;
      const vistas = {};
      garantirCache().forEach(function (l) { if (l.cidade) vistas[l.cidade] = true; });
      return Object.keys(vistas).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    },

    // ------------------------------------------------------------------ prazos

    /** Dias ideais na etapa; 0 = etapa sem prazo. */
    prazoDe: function (idEtapa) {
      return this.etapa(idEtapa).prazo || 0;
    },

    /** Mapa { id: prazo } — usado pelo backup. */
    prazos: function () {
      const p = {};
      garantirEtapas().forEach(function (e) { p[e.id] = e.prazo; });
      return p;
    },

    // ----------------------------------------------------------------- modelos

    modelos: function () { return Object.assign({}, garantirModelos()); },

    modeloDe: function (idEtapa) {
      return garantirModelos()[idEtapa] || '';
    },

    /** Preferência global: abrir o WhatsApp sem texto nenhum. */
    abrirSemTexto: function () { return garantirModelos()._semTexto === true; },

    salvarModelos: function (novos) {
      const m = garantirModelos();
      Object.keys(novos).forEach(function (chave) {
        if (chave !== '_semTexto' && typeof novos[chave] === 'string') m[chave] = novos[chave];
      });
      if ('_semTexto' in novos) m._semTexto = Boolean(novos._semTexto);
      localStorage.setItem(CHAVE_MODELOS, JSON.stringify(m));
      return Object.assign({}, m);
    },

    // ------------------------------------------- tempo, cobrança e datas

    /** Há quantos dias o lead está parado na etapa atual. */
    diasNaEtapa: function (lead) {
      return Math.max(0, diasEntre(lead.etapaDesde || lead.dataCriacao, hoje()));
    },

    /** Idade total do lead, em dias, desde o cadastro. */
    diasDesdeCriacao: function (lead) {
      return Math.max(0, diasEntre(lead.dataCriacao, hoje()));
    },

    /** Dias até a data combinada de retomada.
        Positivo = ainda falta, 0 = é hoje, negativo = já passou. */
    diasParaContato: function (lead) {
      if (!lead.proximoContato) return null;
      return diasEntre(hoje(), lead.proximoContato);
    },

    temContatoAgendado: function (lead) {
      return Boolean(lead.proximoContato);
    },

    /** Quantos dias faltam para o lead pedir atenção, venha a cobrança da data
        combinada ou do prazo da etapa. Negativo = já passou; null = sem prazo. */
    diasParaCobranca: function (lead) {
      if (lead.proximoContato) return this.diasParaContato(lead);
      const prazo = this.prazoDe(lead.etapa);
      if (!prazo) return null;
      return prazo - this.diasNaEtapa(lead);
    },

    /** Como está o lead — a resposta para "preciso falar com ele agora?".
        'neutro'   → sem prazo na etapa e sem data combinada
        'ok'       → ainda tem folga
        'atencao'  → é o dia de falar
        'atrasado' → passou da hora, retome o contato

        Uma data combinada (`proximoContato`) manda mais que o prazo da etapa:
        é o que permite adiar um lead sem que ele fique piscando vermelho. */
    situacao: function (lead) {
      if (lead.proximoContato) {
        const faltam = this.diasParaContato(lead);
        if (faltam < 0) return 'atrasado';
        if (faltam === 0) return 'atencao';
        return 'ok';
      }
      const prazo = this.prazoDe(lead.etapa);
      if (!prazo) return 'neutro';
      const dias = this.diasNaEtapa(lead);
      if (dias > prazo) return 'atrasado';
      if (dias >= prazo - 1) return 'atencao';
      return 'ok';
    },

    /** Soma dias a uma data 'YYYY-MM-DD'. */
    somarDias: function (iso, n) {
      const p = (iso || hoje()).split('-');
      const d = new Date(+p[0], +p[1] - 1, +p[2], 12);
      d.setDate(d.getDate() + n);
      return paraISO(d);
    },

    /** Adia o lead: marca a retomada para daqui a `dias` (a partir de hoje). */
    adiar: function (id, dias) {
      return this.atualizar(id, { proximoContato: this.somarDias(hoje(), dias) });
    },

    /** Dias até a próxima ocorrência de uma data comemorativa (ignora o ano).
        0 = é hoje; null = data não preenchida. */
    diasParaData: function (iso) {
      if (!iso || iso.length < 10) return null;
      const p = iso.split('-');
      const agora = new Date();
      const esteAno = new Date(agora.getFullYear(), +p[1] - 1, +p[2], 12);
      const alvo = paraISO(esteAno) < hoje()
        ? new Date(agora.getFullYear() + 1, +p[1] - 1, +p[2], 12)
        : esteAno;
      return diasEntre(hoje(), paraISO(alvo));
    },

    /** As datas comemorativas do lead (aniversário + data especial), com
        quantos dias faltam para cada uma. Ordenadas da mais próxima. */
    datasDoLead: function (lead) {
      const lista = [];
      if (lead.aniversario) {
        lista.push({ rotulo: 'Aniversário', data: lead.aniversario,
                     faltam: this.diasParaData(lead.aniversario) });
      }
      if (lead.dataEspecial) {
        lista.push({ rotulo: lead.dataEspecialNome || 'Data especial', data: lead.dataEspecial,
                     faltam: this.diasParaData(lead.dataEspecial) });
      }
      return lista.sort(function (a, b) { return a.faltam - b.faltam; });
    },

    /** A data comemorativa mais próxima, ou null. */
    proximaData: function (lead) {
      return this.datasDoLead(lead)[0] || null;
    },

    // -------------------------------------------------- histórico de contatos

    /** Registra um contato feito e, se informado, já agenda o próximo. */
    registrarContato: function (id, registro) {
      const lista = garantirCache();
      const i = lista.findIndex(function (l) { return l.id === id; });
      if (i === -1) return null;

      lista[i].contatos.unshift(normalizarContato(registro));
      lista[i].contatos.sort(function (a, b) { return b.data.localeCompare(a.data); });
      if (registro && 'proximoContato' in registro) {
        lista[i].proximoContato = String(registro.proximoContato || '');
      }
      lista[i].atualizadoEm = new Date().toISOString();
      gravar();
      return this.obter(id);
    },

    /** Corrige um registro do histórico (data, canal ou anotação). */
    editarContato: function (id, indice, registro) {
      const lista = garantirCache();
      const i = lista.findIndex(function (l) { return l.id === id; });
      if (i === -1 || !lista[i].contatos[indice]) return null;

      lista[i].contatos[indice] = normalizarContato(
        Object.assign({}, lista[i].contatos[indice], registro));
      lista[i].contatos.sort(function (a, b) { return b.data.localeCompare(a.data); });
      lista[i].atualizadoEm = new Date().toISOString();
      gravar();
      return this.obter(id);
    },

    /** Remove um registro do histórico pelo índice. */
    removerContato: function (id, indice) {
      const lista = garantirCache();
      const i = lista.findIndex(function (l) { return l.id === id; });
      if (i === -1 || !lista[i].contatos[indice]) return null;
      lista[i].contatos.splice(indice, 1);
      gravar();
      return this.obter(id);
    },

    ultimoContato: function (lead) {
      return lead.contatos && lead.contatos.length ? lead.contatos[0] : null;
    },

    /** Dias desde o último contato registrado; null se nunca houve. */
    diasDesdeUltimoContato: function (lead) {
      const ultimo = this.ultimoContato(lead);
      return ultimo ? Math.max(0, diasEntre(ultimo.data, hoje())) : null;
    }
  };
})();

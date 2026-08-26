/* =============================================================================
   importar.js — Traz contatos de uma planilha (.csv) para dentro do CRM.

   Aceita o CSV exportado por este app e também planilhas de fora: reconhece as
   colunas pelo nome do cabeçalho (sem ligar para acento, maiúscula ou variação
   comum como "Celular" em vez de "Telefone").
   ============================================================================= */

const Importar = (function () {
  'use strict';

  /* Cada campo do lead e os cabeçalhos que apontam para ele. Comparação feita
     sem acento e em minúsculas. */
  const COLUNAS = {
    nome:            ['nome', 'contato', 'nome completo', 'nome do contato', 'cliente'],
    email:           ['e-mail', 'email', 'e mail', 'correio'],
    telefone:        ['telefone', 'celular', 'fone', 'whatsapp', 'telefone 1', 'tel'],
    cargo:           ['cargo', 'funcao', 'posicao'],
    empresa:         ['empresa', 'origem', 'empresa/origem', 'empresa / origem',
                      'orgao', 'instituicao', 'organizacao'],
    cidade:          ['cidade', 'municipio', 'localidade'],
    uf:              ['uf', 'estado', 'sigla'],
    etapa:           ['etapa', 'etapa do funil', 'funil', 'status', 'situacao no funil'],
    observacoes:     ['observacoes', 'observacao', 'notas', 'nota', 'obs', 'comentarios'],
    dataCriacao:     ['data de criacao', 'data criacao', 'criado em', 'data', 'cadastro'],
    proximoContato:  ['proximo contato', 'retorno', 'proximo retorno'],
    aniversario:     ['aniversario', 'data de nascimento', 'nascimento', 'aniversario do contato'],
    dataEspecial:    ['data especial', 'data comemorativa'],
    dataEspecialNome:['o que e a data', 'nome da data especial']
  };

  function chave(texto) {
    return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  }

  // ------------------------------------------------------------------- leitura

  /** Descobre se a planilha usa ; ou , olhando a primeira linha. */
  function separador(texto) {
    const linha = texto.split(/\r?\n/)[0] || '';
    const pontoVirgula = (linha.match(/;/g) || []).length;
    const virgula = (linha.match(/,/g) || []).length;
    return pontoVirgula >= virgula ? ';' : ',';
  }

  /** Divide o CSV respeitando aspas (campos com ; , ou quebra de linha dentro). */
  function separarLinhas(texto, sep) {
    const linhas = [];
    let campo = '';
    let linha = [];
    let dentroDeAspas = false;

    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];

      if (dentroDeAspas) {
        if (c === '"') {
          if (texto[i + 1] === '"') { campo += '"'; i++; }   // aspas escapadas
          else dentroDeAspas = false;
        } else campo += c;
        continue;
      }

      if (c === '"') { dentroDeAspas = true; continue; }
      if (c === sep) { linha.push(campo); campo = ''; continue; }
      if (c === '\r') continue;
      if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
      campo += c;
    }
    if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas.filter(function (l) { return l.some(function (v) { return String(v).trim() !== ''; }); });
  }

  /** Liga cada coluna da planilha a um campo do lead. */
  function mapear(cabecalho) {
    const mapa = {};          // índice da coluna -> campo
    const reconhecidas = [];
    const ignoradas = [];

    cabecalho.forEach(function (titulo, i) {
      const k = chave(titulo);
      const campo = Object.keys(COLUNAS).find(function (nome) {
        return COLUNAS[nome].indexOf(k) > -1;
      });
      if (campo && Object.keys(mapa).every(function (j) { return mapa[j] !== campo; })) {
        mapa[i] = campo;
        reconhecidas.push({ coluna: titulo.trim(), campo: campo });
      } else if (String(titulo).trim()) {
        ignoradas.push(titulo.trim());
      }
    });
    return { mapa: mapa, reconhecidas: reconhecidas, ignoradas: ignoradas };
  }

  // ------------------------------------------------------------- conversões

  /** 'DD/MM/AAAA' ou 'AAAA-MM-DD' -> 'AAAA-MM-DD'. Vazio se não der. */
  function paraData(valor) {
    const t = String(valor || '').trim();
    if (!t) return '';
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m) {
      const ano = m[3].length === 2 ? '20' + m[3] : m[3];
      return ano + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    }
    return '';
  }

  /** Aceita o nome da etapa (como aparece na tela) e devolve o id. */
  function paraEtapa(valor) {
    const k = chave(valor);
    if (!k) return null;
    const achada = DB.etapas().find(function (e) {
      return chave(e.nome) === k || chave(e.id) === k;
    });
    return achada ? achada.id : null;
  }

  function paraUF(valor) {
    const t = String(valor || '').trim().toUpperCase();
    if (DB.UFS.indexOf(t) > -1) return t;
    return '';
  }

  // --------------------------------------------------------------- análise

  /** Lê o texto do arquivo e devolve o que será importado, sem gravar nada. */
  function analisar(texto) {
    const limpo = String(texto || '').replace(/^﻿/, '');   // tira o BOM
    const sep = separador(limpo);
    const linhas = separarLinhas(limpo, sep);

    if (linhas.length < 2) {
      return { ok: false, erro: 'A planilha está vazia ou só tem o cabeçalho.' };
    }

    const cabecalho = linhas[0];
    const info = mapear(cabecalho);
    if (!Object.keys(info.mapa).some(function (i) { return info.mapa[i] === 'nome'; })) {
      return { ok: false, erro: 'Não encontrei uma coluna de nome. ' +
                                'A planilha precisa de uma coluna chamada "Nome".' };
    }

    // Telefones e e-mails que já existem, para não duplicar contato
    const existentes = {};
    DB.listar().forEach(function (l) {
      if (l.telefone) existentes[soDigitos(l.telefone)] = l.nome;
      if (l.email) existentes[chave(l.email)] = l.nome;
    });

    const novos = [];
    const repetidos = [];
    const semNome = [];
    const vistosNoArquivo = {};

    linhas.slice(1).forEach(function (linha, n) {
      const lead = {};
      Object.keys(info.mapa).forEach(function (i) {
        lead[info.mapa[i]] = String(linha[i] == null ? '' : linha[i]).trim();
      });

      if (!lead.nome) { semNome.push(n + 2); return; }

      lead.dataCriacao = paraData(lead.dataCriacao) || DB.hoje();
      lead.proximoContato = paraData(lead.proximoContato);
      lead.aniversario = paraData(lead.aniversario);
      lead.dataEspecial = paraData(lead.dataEspecial);
      lead.uf = paraUF(lead.uf);

      const etapaId = paraEtapa(lead.etapa);
      lead.etapa = etapaId || DB.etapas()[0].id;

      const chaveTelefone = lead.telefone ? soDigitos(lead.telefone) : '';
      const chaveEmail = lead.email ? chave(lead.email) : '';
      const jaExiste = (chaveTelefone && existentes[chaveTelefone]) ||
                       (chaveEmail && existentes[chaveEmail]) ||
                       (chaveTelefone && vistosNoArquivo[chaveTelefone]) ||
                       (chaveEmail && vistosNoArquivo[chaveEmail]);

      if (jaExiste) {
        repetidos.push({ nome: lead.nome, conflitoCom: jaExiste });
        return;
      }

      if (chaveTelefone) vistosNoArquivo[chaveTelefone] = lead.nome;
      if (chaveEmail) vistosNoArquivo[chaveEmail] = lead.nome;
      novos.push(lead);
    });

    return {
      ok: true,
      separador: sep,
      totalLinhas: linhas.length - 1,
      reconhecidas: info.reconhecidas,
      ignoradas: info.ignoradas,
      novos: novos,
      repetidos: repetidos,
      semNome: semNome
    };
  }

  function soDigitos(valor) {
    return String(valor || '').replace(/\D/g, '');
  }

  /** Grava os leads analisados. */
  function aplicar(novos) {
    novos.forEach(function (lead) { DB.criar(lead); });
    return novos.length;
  }

  return {
    analisar: analisar,
    aplicar: aplicar,
    CAMPOS_RECONHECIDOS: COLUNAS
  };
})();

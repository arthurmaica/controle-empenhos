// ui.js

import { stats, totals, fornecedor, empenho } from './core.js';
import { money, num, pct } from './utils.js';

// ===== COMPONENTES =====

function stat(title,value){
  return `<div class="card stat">
    <small>${title}</small>
    <strong>${value}</strong>
  </div>`
}

function neList(db){
  const nfs = db.empenhos || [];

  if(!nfs.length){
    return `<p class="notice">Nenhuma NE cadastrada.</p>`;
  }

  return `
  <div class="list-modern">
    ${nfs.map(e=>{
      const f = fornecedor(db, e.fornecedorId);

      return `
      <div class="ne-item">
        <div>
          <b>NE ${e.numero}/${e.ano}</b>
          <div class="muted">${f.nome || ''}</div>
        </div>

        <div class="right">
          <span class="badge ${e.status==='ativa'?'green':'blue'}">
            ${e.status}
          </span>

          <button onclick="openEmp('${e.id}')">
            Abrir
          </button>
        </div>
      </div>
      `;
    }).join('')}
  </div>
  `;
}

function itemList(db, items){
  if(!items || !items.length){
    return `<p class="notice">Nenhum item encontrado.</p>`
  }

  return `<div class="list">` + items.map(i=>{
    const e = empenho(db, i.empenhoId) || {};
    const f = fornecedor(db, e.fornecedorId) || {};

    const ratio = i.quantidadeEmpenhada
        ? (i.saldo / i.quantidadeEmpenhada)
        : 0;

    const tone = i.saldo <= 0
        ? 'red'
        : (ratio <= 0.2 ? 'yellow' : 'green');
    const bar =
      tone==='red' ? 'redbar' :
      tone==='yellow' ? 'warn' : '';

    return `
    <button onclick="openEmp('${i.empenhoId}')">
      <span>
        <b>${i.descricao}</b><br>
        <small class="muted">
          NE ${e.numero}/${e.ano} · ${f.nome||''}
        </small>

        <div class="progress mt">
          <div class="bar ${bar}" style="width:${Math.min(100,i.consumido)}%"></div>
        </div>

        <small class="muted">
          Consumido: ${pct(i.consumido)}
        </small>
      </span>

      <span class="badge ${tone}">
        ${num(i.saldo)} ${i.unidade}
      </span>
    </button>`
  }).join('') + `</div>`
}

// ===== TELAS =====

export function viewInicio(db){
  const t = totals(db);
  const s = stats(db);

  const vazio =
    db.empenhos.length === 0 &&
    db.itensEmpenho.length === 0;

  return `
  <div class="grid cols4">
    ${stat('NEs ativas',t.ativas)}
    ${stat('Valor empenhado',money(t.valorEmpenhado))}
    ${stat('Valor consumido',money(t.valorConsumido))}
    ${stat('Saldo restante',money(t.saldo))}
    </div>
        <div class="card mt">
        <h2>NEs ativas</h2>
        ${neList(db)}
    </div>

  <div class="grid cols2 mt">

    <div class="card">
      <h2>Itens próximos de acabar</h2>
      ${itemList(db,t.proximos)}
    </div>

    <div class="card">
      <h2>Itens disponíveis</h2>
      ${itemList(db,s.filter(i=>i.saldo>0).slice(0,10))}
    </div>

  </div>

  <div class="card mt">
    <h2>Itens consumidos</h2>
    ${itemList(db,t.consumidos)}
  </div>
  `;
}

export function viewEmpenhos(db, query=''){
  const s = stats(db);

  const rows = db.empenhos.filter(e=>{
    return `${e.numero} ${e.ano} ${fornecedor(db,e.fornecedorId).nome}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });

  return `
  <div class="card mb">
    <input id="search" placeholder="Buscar..." value="${query}">
  </div>

  <div class="grid cols3">
    ${rows.map(e=>{
      const f = fornecedor(db,e.fornecedorId);
      const itens = s.filter(i=>i.empenhoId===e.id);

      const valor = itens.reduce((a,i)=>a+i.valorTotal,0);

      const saldo = itens.reduce((a,i)=>{
        return a + (i.saldo * i.valorUnitario)
      },0);

      return `
      <div class="card">
        <h2>NE ${e.numero}/${e.ano}</h2>
        <p>${f.nome}</p>
        <p>Valor: ${money(valor)}</p>
        <p>Saldo: ${money(saldo)}</p>
        <button onclick="openEmp('${e.id}')">Abrir</button>
      </div>`
    }).join('')}
  </div>
  `;
}

export function viewNovo(){
  return `
  <div class="card">
    <h2>Cadastro de NE</h2>
    <p>Formulário será conectado ao app.js</p>
  </div>
  `;
}

export function viewNF(db){
  const ativos = db.empenhos.filter(e=>e.status==='ativa');

  if(!ativos.length){
    return `<div class="card">
      <p class="notice">Cadastre uma NE primeiro.</p>
    </div>`;
  }

  return `
  <div class="card">
    <h2>Lançar NF</h2>
    <p>Interface será ligada ao app.js</p>
  </div>
  `;
}

export function viewDetalhes(db, selectedId){
  const e = empenho(db, selectedId);

  if(!e.id){
    return `<div class="card">Empenho não encontrado</div>`;
  }

  const f = fornecedor(db,e.fornecedorId);
  const itens = stats(db).filter(i=>i.empenhoId===e.id);

  return `
  <div class="card">
    <h2>NE ${e.numero}/${e.ano}</h2>
    <p>${f.nome}</p>
  </div>

  <div class="card mt">
    <table class="table">
      <tr>
        <th>Item</th>
        <th>Empenhado</th>
        <th>Entregue</th>
        <th>Saldo</th>
      </tr>

      ${itens.map(i=>`
        <tr>
          <td>${i.descricao}</td>
          <td>${num(i.quantidadeEmpenhada)}</td>
          <td>${num(i.entregue)}</td>
          <td>${num(i.saldo)}</td>
        </tr>
      `).join('')}
    </table>
  </div>
  `;
}

export function viewRelatorios(db){
  const t = totals(db);

  return `
  <div class="card">
    <h2>Relatórios</h2>
    <p>Empenhado: ${money(t.valorEmpenhado)}</p>
    <p>Consumido: ${money(t.valorConsumido)}</p>
    <p>Saldo: ${money(t.saldo)}</p>
  </div>
  `;
}

export function viewBackup(){
  return `
  <div class="card">
    <h2>Backup</h2>
    <p>Funções ligadas no app.js</p>
  </div>
  `;
}
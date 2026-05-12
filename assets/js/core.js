// core.js

export function fornecedor(db, id){
  return db.fornecedores.find(f=>f.id===id) || {};
}

export function empenho(db, id){
  return db.empenhos.find(e=>e.id===id) || {};
}

export function stats(db){

  const mapa = new Map();

  db.itensNotaFiscal.forEach(i=>{
    const atual = mapa.get(i.itemEmpenhoId) || 0;
    mapa.set(i.itemEmpenhoId, atual + Number(i.quantidadeEntregue || 0));
  });

  return db.itensEmpenho.map(i=>{
    const entregue = mapa.get(i.id) || 0;
    const empenhada = Number(i.quantidadeEmpenhada || 0);

    const saldo = Math.max(0, empenhada - entregue);

    const consumido = empenhada
      ? (entregue / empenhada) * 100
      : 0;

    return {
      ...i,
      entregue,
      saldo,
      consumido,
      valorTotal: empenhada * Number(i.valorUnitario || 0)
    };
  });
}

export function totals(db){

  const s = stats(db);

  const valorEmpenhado = s.reduce((a,i)=>a+i.valorTotal,0);

  const valorConsumido = s.reduce((a,i)=>{
    return a + (i.entregue * Number(i.valorUnitario || 0));
  },0);

  return {
    ativas: db.empenhos.filter(e=>e.status==='ativa').length,
    valorEmpenhado,
    valorConsumido,
    saldo: valorEmpenhado - valorConsumido,

    // 🔥 GARANTIA: sempre arrays
    proximos: s.filter(i =>
      i.saldo > 0 &&
      i.quantidadeEmpenhada > 0 &&
      (i.saldo / i.quantidadeEmpenhada) <= 0.2
    ) || [],

    consumidos: s.filter(i =>
      i.quantidadeEmpenhada > 0 &&
      i.saldo <= 0
    ) || []
  };
}
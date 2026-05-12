export function calcularStats(db) {
  const mapa = new Map();

  db.itensNotaFiscal.forEach(i => {
    mapa.set(
      i.itemEmpenhoId,
      (mapa.get(i.itemEmpenhoId) || 0) + Number(i.quantidadeEntregue)
    );
  });

  return db.itensEmpenho.map(item => {
    const entregue = mapa.get(item.id) || 0;
    const empenhado = Number(item.quantidadeEmpenhada);
    const saldo = empenhado - entregue;

    return {
      ...item,
      entregue,
      saldo,
      consumido: empenhado ? (entregue / empenhado) * 100 : 0
    };
  });
}
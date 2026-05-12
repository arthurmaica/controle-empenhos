export function relatorioItens(db, stats) {
  return stats.map(i => ({
    item: i.descricao,
    empenhado: i.quantidadeEmpenhada,
    entregue: i.entregue,
    saldo: i.saldo,
    percentual: i.consumido
  }));
}
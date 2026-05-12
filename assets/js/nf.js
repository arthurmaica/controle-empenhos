export function validarItemNF(itemNF, statsItem) {
  if (itemNF.quantidadeEntregue > statsItem.saldo) {
    throw new Error('Quantidade superior ao saldo disponível');
  }

  const diffUnit = itemNF.valorUnitario - statsItem.valorUnitario;

  return {
    divergente: diffUnit !== 0,
    diferencaUnitaria: diffUnit,
    diferencaTotal: diffUnit * itemNF.quantidadeEntregue
  };
}
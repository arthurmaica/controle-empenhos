export const STORAGE_KEY = 'controle-empenhos-notas-fiscais-v2';

const empty = {
  fornecedores: [],
  empenhos: [],
  itensEmpenho: [],
  notasFiscais: [],
  itensNotaFiscal: []
};

export function load(){
  try{
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

    return {
      ...empty,
      ...data
    };

  }catch{
    return structuredClone(empty);
  }
}

export function save(db){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}
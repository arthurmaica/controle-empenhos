export function uid(p='id'){
  return p+'_'+Date.now()+'_'+Math.random().toString(16).slice(2)
}

export function money(v){
  return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
}

export function num(v){
  return Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:3})
}

export function pct(v){
  return Number(v||0).toFixed(1).replace('.',',')+'%'
}

export function today(){
  return new Date().toISOString().slice(0,10)
}
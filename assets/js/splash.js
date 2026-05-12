const splashPhrases = [
  "Conectando ao banco de dados...",
  "Carregando configurações...",
  "Verificando autenticação...",
  "Preparando ambiente seguro...",
  "Quase pronto..."
];

let splashPhraseIndex = 0;
const splashText = document.getElementById("splashText");
const splashScreen = document.getElementById("splashScreen");
const loginScreen = document.getElementById("login");

const splashInterval = setInterval(() => {
  if(!splashText) return;

  splashText.textContent = splashPhrases[splashPhraseIndex % splashPhrases.length];
  splashPhraseIndex += 1;
}, 1500);

setTimeout(() => {
  clearInterval(splashInterval);

  if(!splashScreen){
    if(loginScreen) loginScreen.classList.remove("hidden");
    return;
  }

  splashScreen.classList.add("is-hiding");

  setTimeout(() => {
    splashScreen.remove();
    if(loginScreen) loginScreen.classList.remove("hidden");
  }, 500);
}, 4000);

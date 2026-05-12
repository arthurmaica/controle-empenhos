const USERS_ALLOWED = [
  "arthurmaicaa@gmail.com"
].map(normalizeEmail);

let currentUser = null;

export function initLogin(onSuccess){
  google.accounts.id.initialize({
    client_id: "663458725275-1stif1281j64v6de0k4nlgle5s1i8nfc.apps.googleusercontent.com",
    callback: (res)=>handle(res, onSuccess)
  });

  google.accounts.id.renderButton(
    document.getElementById("googleBtn"),
    { theme: "filled_black", size: "large", width: 280 }
  );
}

function handle(response, onSuccess){
  const user = parseJwt(response.credential);
  const email = normalizeEmail(user.email);

  if(!USERS_ALLOWED.includes(email)){
    showError("Acesso negado para " + email + ". Este e-mail precisa estar cadastrado em USERS_ALLOWED no assets/js/auth.js.");
    return;
  }

  currentUser = user;

  document.getElementById("login").style.display = "none";
  document.getElementById("appRoot").style.display = "block";

  onSuccess(user); // libera seu app.js
}

function parseJwt(token){
  const base = token.split('.')[1];
  const decoded = base.replace(/-/g,'+').replace(/_/g,'/');
  const padded = decoded.padEnd(decoded.length + (4 - decoded.length % 4) % 4, '=');
  return JSON.parse(atob(padded));
}

function normalizeEmail(email){
  return String(email || '').trim().toLowerCase();
}

function showError(msg){
  const el = document.getElementById("loginMsg");
  el.textContent = msg;
  el.classList.remove("hidden");
}

console.log("[BOOT] app.js carregado");

const STORAGE_KEY = 'controle-empenhos-notas-fiscais-v2';
const SYNC_CONFIG_KEY = 'controle-empenhos-supabase-config-v1';
const SYNC_META_KEY = 'controle-empenhos-sync-meta-v1';
const SYNC_TABLE = 'controle_empenhos_sync';
const SUPABASE_AUTH_STORAGE_KEY = 'controle-empenhos-supabase-auth-v1';
const GOOGLE_CLIENT_ID = "663458725275-1stif1281j64v6de0k4nlgle5s1i8nfc.apps.googleusercontent.com";
const DEFAULT_SYNC_CONFIG = {
  url: 'https://jivwpgxsulxkwsgunfmx.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppdndwZ3hzdWx4a3dzZ3VuZm14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MTc0MzYsImV4cCI6MjA5MzM5MzQzNn0.anEgUiwIaS2Nfer_mB3SoTz7g_C-Zre6yrN5rShCmUg'
};

const USERS_ALLOWED = [
  "arthurmaicaa@gmail.com",
].map(normalizeEmail);

const empty = {
  fornecedores: [],
  empenhos: [],
  itensEmpenho: [],
  notasFiscais: [],
  itensNotaFiscal: [],
  movimentacoes: []
};

const tabs = [
  ['inicio', 'Inicio'],
  ['empenhos', 'Empenhos'],
  ['novo', 'Nova NE'],
  ['nf', 'Lancar NF'],
  ['backup', 'Backup']
];

const unidades = ['kg', 'unidade', 'litro', 'pacote', 'caixa', 'metro', 'par', 'saco', 'frasco', 'outro'];

let currentUser = null;
let db = null;
let tab = 'inicio';
let selected = null;
let query = '';
let syncTimer = null;
let electronOAuthUnsubscribe = null;

function load(){
  try{
    return {
      ...empty,
      ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    };
  }catch{
    return structuredClone(empty);
  }
}

function loadSyncMeta(){
  try{
    return {
      dirty: false,
      localUpdatedAt: null,
      lastSyncedAt: null,
      lastError: '',
      ...JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}')
    };
  }catch{
    return {
      dirty: false,
      localUpdatedAt: null,
      lastSyncedAt: null,
      lastError: ''
    };
  }
}

function saveSyncMeta(meta){
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
}

function loadSyncConfig(){
  try{
    const saved = JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || '{}');
    const config = {
      ...DEFAULT_SYNC_CONFIG,
      ...saved
    };

    return isSupabaseConfigured(config) ? config : { ...DEFAULT_SYNC_CONFIG };
  }catch{
    return { ...DEFAULT_SYNC_CONFIG };
  }
}

function save(options = {}){
  const { dirty = true, autosync = true } = options;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));

  if(dirty){
    const meta = loadSyncMeta();
    saveSyncMeta({
      ...meta,
      dirty: true,
      localUpdatedAt: new Date().toISOString(),
      lastError: ''
    });

    if(autosync) requestAutoSync();
  }
}

function uid(p = 'id'){
  return p + '_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}

function money(v){
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function num(v){
  return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function pct(v){
  return Number(v || 0).toFixed(1).replace('.', ',') + '%';
}

function today(){
  return new Date().toISOString().slice(0, 10);
}

function norm(t){
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeEmail(email){
  return String(email || '').trim().toLowerCase();
}

function fornecedor(id){
  return db.fornecedores.find(f => f.id === id) || {};
}

function empenho(id){
  return db.empenhos.find(e => e.id === id) || {};
}

function stats(){
  const mapa = new Map();

  db.itensNotaFiscal.forEach(i => {
    mapa.set(i.itemEmpenhoId, (mapa.get(i.itemEmpenhoId) || 0) + Number(i.quantidadeEntregue || 0));
  });

  return db.itensEmpenho.map(i => {
    const entregue = mapa.get(i.id) || 0;
    const empenhada = Number(i.quantidadeEmpenhada || 0);
    const saldo = Math.max(0, empenhada - entregue);
    const consumido = empenhada ? entregue / empenhada * 100 : 0;

    return {
      ...i,
      entregue,
      saldo,
      consumido,
      valorTotal: empenhada * Number(i.valorUnitario || 0)
    };
  });
}

function totals(){
  const s = stats();
  const valorEmpenhado = s.reduce((a, i) => a + i.valorTotal, 0);
  const valorConsumido = s.reduce((a, i) => a + i.entregue * Number(i.valorUnitario || 0), 0);

  return {
    ativas: db.empenhos.filter(e => e.status === 'ativa').length,
    valorEmpenhado,
    valorConsumido,
    saldo: valorEmpenhado - valorConsumido,
    proximos: s.filter(i => i.saldo > 0 && i.quantidadeEmpenhada > 0 && i.saldo / i.quantidadeEmpenhada <= 0.2),
    consumidos: s.filter(i => i.quantidadeEmpenhada > 0 && i.saldo <= 0)
  };
}

function parseJwt(token){
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  return JSON.parse(atob(padded));
}

function showLoginError(msg){
  const el = document.getElementById("loginMsg");
  if(!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearLoginError(){
  const el = document.getElementById("loginMsg");
  if(!el) return;
  el.textContent = '';
  el.classList.add("hidden");
}

function isElectronApp(){
  return Boolean(window.electronOAuth?.openExternalAuth);
}

function isPrivateNetworkHostname(hostname){
  return /^(10|127)\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    || hostname === '[::1]'
    || hostname.endsWith('.local');
}

function isLocalDevelopmentOrigin(){
  const hostname = window.location.hostname;
  return ['localhost', '127.0.0.1', ''].includes(hostname) || isPrivateNetworkHostname(hostname);
}

function initLogin(){
  if(isElectronApp()){
    renderElectronSupabaseLogin();
    return;
  }

  if(isLocalDevelopmentOrigin()){
    renderLocalLogin();
    return;
  }

  if(window.location.protocol !== 'https:'){
    showLoginError("Login Google bloqueado: publique o app em HTTPS e cadastre esta origem no Google Cloud Console: " + window.location.origin);
    return;
  }

  if(!window.google?.accounts?.id){
    showLoginError("Google API nao carregou. Verifique sua conexao e recarregue a pagina.");
    return;
  }

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse
  });

  const btn = document.getElementById("googleBtn");
  if(!btn) return;

  google.accounts.id.renderButton(btn, {
    theme: "filled_black",
    size: "large",
    width: 280
  });
}

function renderLocalLogin(){
  const btn = document.getElementById("googleBtn");
  if(!btn) return;

  btn.innerHTML = `<button type="button" id="localLoginBtn">Entrar no modo local</button>`;

  const localBtn = document.getElementById("localLoginBtn");
  if(localBtn) localBtn.onclick = localLogin;
}

function renderElectronSupabaseLogin(){
  const btn = document.getElementById("googleBtn");
  if(!btn) return;

  btn.innerHTML = `<button type="button" id="supabaseOAuthBtn">Entrar com Google</button>`;

  const oauthBtn = document.getElementById("supabaseOAuthBtn");
  if(oauthBtn) oauthBtn.onclick = startElectronSupabaseLogin;

  if(!electronOAuthUnsubscribe && window.electronOAuth?.onCallback){
    electronOAuthUnsubscribe = window.electronOAuth.onCallback(handleElectronOAuthCallback);
  }
}

async function startElectronSupabaseLogin(){
  const btn = document.getElementById("supabaseOAuthBtn");

  try{
    clearLoginError();
    if(btn){
      btn.disabled = true;
      btn.textContent = 'Abrindo login...';
    }

    const client = getSupabaseAuthClient();
    const redirectTo = await window.electronOAuth.getRedirectUrl();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });

    if(error) throw error;
    if(!data?.url) throw new Error('Supabase nao retornou a URL de login.');

    await window.electronOAuth.openExternalAuth(data.url);

    if(btn) btn.textContent = 'Aguardando login...';
  }catch(error){
    showLoginError(error.message || 'Nao foi possivel iniciar o login.');
    if(btn){
      btn.disabled = false;
      btn.textContent = 'Entrar com Google';
    }
  }
}

async function handleElectronOAuthCallback(callbackUrl){
  try{
    clearLoginError();

    const url = new URL(callbackUrl);
    const errorDescription = url.searchParams.get('error_description') || url.searchParams.get('error');
    if(errorDescription) throw new Error(errorDescription);

    const code = url.searchParams.get('code');
    if(!code) throw new Error('Retorno OAuth sem codigo de autenticacao.');

    const client = getSupabaseAuthClient();
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if(error) throw error;

    const user = data?.user || data?.session?.user;
    const email = normalizeEmail(user?.email);

    if(!USERS_ALLOWED.includes(email)){
      await client.auth.signOut();
      showLoginError("Acesso negado para " + email + ". Este e-mail precisa estar cadastrado em USERS_ALLOWED no assets/js/app.js.");
      console.warn("[LOGIN] e-mail nao autorizado:", email);
      return;
    }

    currentUser = {
      id: user.id,
      email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || email,
      avatar_url: user.user_metadata?.avatar_url || '',
      supabase: true
    };

    document.getElementById("login").style.display = "none";
    document.getElementById("appRoot").style.display = "block";

    initApp();
  }catch(error){
    showLoginError(error.message || 'Nao foi possivel concluir o login.');

    const btn = document.getElementById("supabaseOAuthBtn");
    if(btn){
      btn.disabled = false;
      btn.textContent = 'Entrar com Google';
    }
  }
}

function localLogin(){
  const email = USERS_ALLOWED[0];

  currentUser = {
    email,
    name: 'Modo local',
    local: true
  };

  document.getElementById("login").style.display = "none";
  document.getElementById("appRoot").style.display = "block";

  initApp();
}

function handleCredentialResponse(response){
  const payload = parseJwt(response.credential);
  const email = normalizeEmail(payload.email);

  if(!USERS_ALLOWED.includes(email)){
    showLoginError("Acesso negado para " + email + ". Este e-mail precisa estar cadastrado em USERS_ALLOWED no assets/js/app.js.");
    console.warn("[LOGIN] e-mail nao autorizado:", email);
    return;
  }

  currentUser = payload;

  document.getElementById("login").style.display = "none";
  document.getElementById("appRoot").style.display = "block";

  initApp();
}

function initApp(){
  db = load();
  exposeGlobals();
  mountAppShell();
  setupAutomaticSync();
  render();
  attemptAutoSync();
  console.log("App iniciado", { currentUser, db });
}

function exposeGlobals(){
  Object.assign(window, {
    setTab,
    openEmp,
    deleteEmp,
    backup,
    restoreBackup,
    resetAll,
    localLogin
  });
}

function mountAppShell(){
  const root = document.getElementById("appRoot");
  if(!root) return;

  root.classList.remove("hidden");
  root.style.display = "block";
  root.innerHTML = `
    <header class="header">
      <div class="wrap header-content">

        <div class="header-left">
          
          <!-- IMAGEM DO HEADER -->
          <img src="assets/icons/logo_blue.png" class="header-image" alt="Sistema">

          <div class="header-text">
            <h1>Controle de Empenhos e Notas Fiscais</h1>
            <p>Controle por item, saldos automáticos e backup.</p>
          </div>
        </div>

        <nav id="nav" class="nav"></nav>
      </div>
    </header>

    <main class="wrap">
      <section id="app"></section>
    </main>
  `;
}

function setTab(t){
  if(!tabs.some(([id]) => id === t) && t !== 'detalhes') t = 'inicio';
  tab = t;
  render();
}

function openEmp(id){
  selected = id;
  tab = 'detalhes';
  render();
}

function renderNav(){
  const nav = document.getElementById('nav');
  if(!nav) return;

  nav.innerHTML = tabs.map(([id, label]) =>
    `<button class="navbtn ${tab === id ? 'active' : ''}" onclick="setTab('${id}')">${label}</button>`
  ).join('');
}

function render(){
  const app = document.getElementById('app');
  if(!app) return;

  renderNav();

  if(tab === 'inicio') app.innerHTML = viewInicio();
  if(tab === 'empenhos') app.innerHTML = viewEmpenhos();
  if(tab === 'novo') app.innerHTML = viewNovo();
  if(tab === 'nf') app.innerHTML = viewNF();
  if(tab === 'detalhes') app.innerHTML = viewDetalhes();
  if(tab === 'backup') app.innerHTML = viewBackup();

  bindEvents();
}

function stat(title, value){
  return `<div class="card stat"><small>${title}</small><strong>${value}</strong></div>`;
}

function viewInicio(){
  const t = totals();

  return `
    <div class="grid cols4">
      ${stat('NEs ativas', t.ativas)}
      ${stat('Valor empenhado', money(t.valorEmpenhado))}
      ${stat('Valor consumido', money(t.valorConsumido))}
      ${stat('Saldo restante', money(t.saldo))}
    </div>
    <div class="grid cols2 mt">
      <div class="card">
        <h2>Itens proximos de acabar</h2>
        <p class="muted">Saldo abaixo de 20%</p>
        ${itemList(t.proximos)}
      </div>
      <div class="card">
        <h2>Itens disponiveis para pedir</h2>
        <p class="muted">Saldos existentes</p>
        ${itemList(stats().filter(i => i.saldo > 0).slice(0, 10))}
      </div>
    </div>
    <div class="card mt">
      <h2>Itens ja consumidos</h2>
      ${itemList(t.consumidos.slice(0, 15))}
    </div>
  `;
}

function itemList(items){
  if(!items.length) return `<p class="notice">Nenhum item encontrado.</p>`;

  return `<div class="list">` + items.map(i => {
    const e = empenho(i.empenhoId);
    const f = fornecedor(e.fornecedorId);
    const tone = i.saldo <= 0 ? 'red' : (i.saldo / Number(i.quantidadeEmpenhada || 1) <= 0.2 ? 'yellow' : 'green');
    const bar = tone === 'red' ? 'redbar' : tone === 'yellow' ? 'warn' : '';

    return `
      <button onclick="openEmp('${i.empenhoId}')">
        <span>
          <b>${i.descricao}</b><br>
          <small class="muted">NE ${e.numero || ''}/${e.ano || ''} - ${f.nome || ''}</small>
          <div class="progress mt"><div class="bar ${bar}" style="width:${Math.min(100, i.consumido)}%"></div></div>
          <small class="muted">Consumido: ${pct(i.consumido)}</small>
        </span>
        <span class="badge ${tone}">${num(i.saldo)} ${i.unidade}</span>
      </button>
    `;
  }).join('') + `</div>`;
}

function viewEmpenhos(){
  const s = stats();
  const q = norm(query);
  const rows = db.empenhos.filter(e =>
    norm(`${e.numero} ${e.ano} ${fornecedor(e.fornecedorId).nome} ${s.filter(i => i.empenhoId === e.id).map(i => i.descricao).join(' ')}`).includes(q)
  );

  return `
    <div class="card mb">
      <input id="search" placeholder="Buscar por NE, fornecedor ou item" value="${query}">
    </div>
    <div class="grid cols3">
      ${rows.map(e => {
        const f = fornecedor(e.fornecedorId);
        const it = s.filter(i => i.empenhoId === e.id);
        const valor = it.reduce((a, i) => a + i.valorTotal, 0);
        const saldo = it.reduce((a, i) => a + i.saldo * Number(i.valorUnitario || 0), 0);

        return `
          <div class="card">
            <div class="row">
              <div>
                <h2>NE ${e.numero}/${e.ano}</h2>
                <p class="muted">${f.nome || ''}</p>
              </div>
              <span class="badge ${e.status === 'ativa' ? 'green' : e.status === 'encerrada' ? 'blue' : 'red'}">${e.status}</span>
            </div>
            <p><b>Itens:</b> ${it.length}</p>
            <p><b>Valor:</b> ${money(valor)}</p>
            <p><b>Saldo:</b> ${money(saldo)}</p>
            <button onclick="openEmp('${e.id}')">Abrir detalhes</button>
          </div>
        `;
      }).join('')}
    </div>
    ${!rows.length ? '<div class="card">Nenhuma Nota de Empenho encontrada.</div>' : ''}
  `;
}

function viewNovo(){
  return `
    <form id="formNE" class="grid">
      <div class="card">
        <h2>Cadastro de Nota de Empenho</h2>
        <div class="grid cols3">
          <label><span>Numero da NE</span><input name="numero" required placeholder="2026NE001"></label>
          <label><span>Ano</span><input name="ano" type="number" value="${new Date().getFullYear()}"></label>
          <label><span>Data do empenho</span><input name="dataEmpenho" type="date" value="${today()}"></label>
          <label><span>Fornecedor</span><input name="fornecedor" required></label>
          <label><span>CNPJ</span><input name="cnpj"></label>
          <label><span>Processo</span><input name="processo"></label>
          <label><span>Modalidade</span><select name="modalidade"><option>Pregao</option><option>Chamada Publica</option><option>Dispensa</option><option>Inexigibilidade</option><option>Outro</option></select></label>
          <label><span>Status</span><select name="status"><option>ativa</option><option>encerrada</option><option>cancelada</option></select></label>
        </div>
        <label class="mt"><span>Observacoes</span><textarea name="observacoes"></textarea></label>
      </div>
      <div class="card">
        <div class="row">
          <h2>Itens da Nota de Empenho</h2>
          <button type="button" class="secondary" id="addItemNE">+ Item</button>
        </div>
        <div id="itensNE"></div>
      </div>
      <button class="success">Salvar Nota de Empenho</button>
    </form>
  `;
}

function itemNEHtml(n = 1){
  return `
    <div class="item mt">
      <div class="grid cols3">
        <label><span>No item</span><input name="numeroItem" value="${n}"></label>
        <label><span>Descricao</span><input name="descricao" required placeholder="Banana, arroz, leite..."></label>
        <label><span>Unidade</span><select name="unidade">${unidades.map(u => `<option>${u}</option>`).join('')}</select></label>
        <label><span>Qtd empenhada</span><input name="quantidadeEmpenhada" type="number" step="0.001" required></label>
        <label><span>Valor unitario</span><input name="valorUnitario" type="number" step="0.01" required></label>
        <button type="button" class="danger removeItem">Remover</button>
      </div>
    </div>
  `;
}

function viewNF(){
  const ativos = db.empenhos.filter(e => e.status === 'ativa');

  if(!ativos.length){
    return `<div class="card"><h2>Lancar NF</h2><p class="notice">Cadastre primeiro uma Nota de Empenho ativa.</p></div>`;
  }

  return `
    <form id="formNF" class="grid">
      <div class="card">
        <h2>Lancamento de Nota Fiscal</h2>
        <div id="msgNF"></div>
        <div class="grid cols3">
          <label><span>Nota de Empenho vinculada</span><select name="empenhoId" id="nfEmp">${ativos.map(e => `<option value="${e.id}">NE ${e.numero}/${e.ano} - ${fornecedor(e.fornecedorId).nome || ''}</option>`).join('')}</select></label>
          <label><span>Numero da NF</span><input name="numero" required></label>
          <label><span>Data da NF</span><input name="dataNf" type="date" value="${today()}"></label>
          <label><span>Anexar foto/PDF da NF</span><input name="arquivo" type="file" accept="image/*,.pdf"></label>
        </div>
        <label class="mt"><span>Observacoes</span><textarea name="observacoes"></textarea></label>
      </div>
      <div class="card">
        <div class="row">
          <h2>Itens da Nota Fiscal</h2>
          <button type="button" class="secondary" id="addItemNF">+ Item</button>
        </div>
        <div id="itensNF"></div>
        <p><b>Total automatico:</b> <span id="totalNF">R$ 0,00</span></p>
      </div>
      <button class="success">Lancar Nota Fiscal</button>
    </form>
  `;
}

function itemNFHtml(empId){
  const itens = stats().filter(i => i.empenhoId === empId && i.saldo > 0);

  if(!itens.length) return `<p class="notice">Nao ha itens com saldo nesta NE.</p>`;

  return `
    <div class="item mt">
      <div class="grid cols3">
        <label><span>Item da NE</span><select name="itemEmpenhoId" class="nfItemSelect">${itens.map(i => `<option value="${i.id}" data-v="${i.valorUnitario}">${i.numeroItem} - ${i.descricao} | saldo ${num(i.saldo)} ${i.unidade}</option>`).join('')}</select></label>
        <label><span>Quantidade entregue</span><input name="quantidadeEntregue" type="number" step="0.001" required></label>
        <label><span>Valor unitario</span><input name="valorUnitario" type="number" step="0.01" value="${itens[0].valorUnitario || 0}"></label>
        <button type="button" class="danger removeItem">Remover</button>
      </div>
    </div>
  `;
}

function viewDetalhes(){
  const e = empenho(selected);
  if(!e.id) return '<div class="card">Empenho nao encontrado.</div>';

  const f = fornecedor(e.fornecedorId);
  const it = stats().filter(i => i.empenhoId === e.id);
  const nfs = db.notasFiscais.filter(n => n.empenhoId === e.id);

  return `
    <div class="card">
      <div class="row">
        <div>
          <h2>NE ${e.numero}/${e.ano}</h2>
          <p class="muted">${f.nome || ''} - ${f.cnpj || ''}</p>
        </div>
        <button class="danger" onclick="deleteEmp('${e.id}')">Excluir NE</button>
      </div>
      <p><b>Processo:</b> ${e.processo || '-'} | <b>Modalidade:</b> ${e.modalidade || '-'} | <b>Status:</b> ${e.status}</p>
      <p>${e.observacoes || ''}</p>
    </div>
    <div class="card mt">
      <h2>Itens e saldos</h2>
      <table class="table">
        <tr><th>Item</th><th>Descricao</th><th>Empenhado</th><th>Entregue</th><th>Saldo</th><th>Valor unit.</th></tr>
        ${it.map(i => `<tr><td>${i.numeroItem}</td><td>${i.descricao}</td><td>${num(i.quantidadeEmpenhada)} ${i.unidade}</td><td>${num(i.entregue)}</td><td>${num(i.saldo)}</td><td>${money(i.valorUnitario)}</td></tr>`).join('')}
      </table>
    </div>
    <div class="card mt">
      <h2>Notas Fiscais lancadas</h2>
      ${nfs.length ? nfs.map(n => `<p><b>NF ${n.numero}</b> - ${n.dataNf} - ${money(n.valorTotal)} ${n.arquivoNome ? `- arquivo: ${n.arquivoNome}` : ''}</p>`).join('') : '<p class="notice">Nenhuma NF lancada.</p>'}
    </div>
  `;
}

function viewBackup(){
  return `
    <div class="grid cols2">
      <div class="card">
        <h2>Backup</h2>
        <p>Baixe um arquivo de seguranca com todos os dados.</p>
        <button onclick="backup()">Baixar backup JSON</button>
      </div>
      <div class="card">
        <h2>Restaurar</h2>
        <p>Carregue um backup salvo anteriormente.</p>
        <input type="file" id="restore" accept=".json,application/json">
      </div>
    </div>
    <div class="card mt">
      <h2>Apagar tudo</h2>
      <button class="danger" onclick="resetAll()">Apagar todos os dados</button>
    </div>
  `;
}

function bindEvents(){
  const search = document.getElementById('search');
  if(search){
    search.oninput = e => {
      query = e.target.value;
      render();
    };
  }

  const itensNE = document.getElementById('itensNE');
  if(itensNE){
    itensNE.innerHTML = itemNEHtml(1);
    document.getElementById('addItemNE').onclick = () => {
      itensNE.insertAdjacentHTML('beforeend', itemNEHtml(itensNE.querySelectorAll('.item').length + 1));
    };
    itensNE.onclick = e => {
      if(e.target.classList.contains('removeItem') && itensNE.querySelectorAll('.item').length > 1){
        e.target.closest('.item').remove();
      }
    };
    document.getElementById('formNE').onsubmit = saveNE;
  }

  const formNF = document.getElementById('formNF');
  if(formNF){
    const cont = document.getElementById('itensNF');
    const empSel = document.getElementById('nfEmp');

    document.getElementById('addItemNF').onclick = () => {
      cont.insertAdjacentHTML('beforeend', itemNFHtml(empSel.value));
      calcNF();
    };

    empSel.onchange = () => {
      cont.innerHTML = '';
      calcNF();
    };

    cont.oninput = calcNF;
    cont.onchange = e => {
      if(e.target.classList.contains('nfItemSelect')){
        const opt = e.target.selectedOptions[0];
        e.target.closest('.item').querySelector('[name="valorUnitario"]').value = opt.dataset.v || 0;
      }
      calcNF();
    };

    cont.onclick = e => {
      if(e.target.classList.contains('removeItem')){
        e.target.closest('.item').remove();
        calcNF();
      }
    };

    formNF.onsubmit = saveNF;
  }

  const restore = document.getElementById('restore');
  if(restore) restore.onchange = restoreBackup;

}

function saveNE(e){
  e.preventDefault();

  const fd = new FormData(e.target);
  let f = db.fornecedores.find(x => norm(x.cnpj) === norm(fd.get('cnpj')) && fd.get('cnpj'));

  if(!f){
    f = {
      id: uid('fornecedor'),
      nome: fd.get('fornecedor'),
      cnpj: fd.get('cnpj')
    };
    db.fornecedores.push(f);
  }

  const id = uid('empenho');
  db.empenhos.push({
    id,
    numero: fd.get('numero'),
    ano: fd.get('ano'),
    fornecedorId: f.id,
    processo: fd.get('processo'),
    modalidade: fd.get('modalidade'),
    dataEmpenho: fd.get('dataEmpenho'),
    observacoes: fd.get('observacoes'),
    status: fd.get('status'),
    createdAt: new Date().toISOString()
  });

  document.querySelectorAll('#itensNE .item').forEach(item => {
    const get = n => item.querySelector(`[name="${n}"]`).value;

    if(get('descricao') && Number(get('quantidadeEmpenhada')) > 0){
      db.itensEmpenho.push({
        id: uid('item_ne'),
        empenhoId: id,
        numeroItem: get('numeroItem'),
        descricao: get('descricao'),
        unidade: get('unidade'),
        quantidadeEmpenhada: Number(get('quantidadeEmpenhada')),
        valorUnitario: Number(get('valorUnitario'))
      });
    }
  });

  db.movimentacoes.push({
    id: uid('mov'),
    data: new Date().toISOString(),
    tipo: 'Cadastro de NE',
    descricao: `NE ${fd.get('numero')}/${fd.get('ano')} cadastrada.`
  });

  save();
  openEmp(id);
}

function calcNF(){
  let total = 0;

  document.querySelectorAll('#itensNF .item').forEach(item => {
    total += Number(item.querySelector('[name="quantidadeEntregue"]').value || 0) * Number(item.querySelector('[name="valorUnitario"]').value || 0);
  });

  const el = document.getElementById('totalNF');
  if(el) el.textContent = money(total);
}

function saveNF(e){
  e.preventDefault();

  const msg = document.getElementById('msgNF');
  const fd = new FormData(e.target);
  const empId = fd.get('empenhoId');
  const rows = [];

  for(const item of document.querySelectorAll('#itensNF .item')){
    const r = {
      itemEmpenhoId: item.querySelector('[name="itemEmpenhoId"]').value,
      quantidadeEntregue: Number(item.querySelector('[name="quantidadeEntregue"]').value),
      valorUnitario: Number(item.querySelector('[name="valorUnitario"]').value)
    };
    const st = stats().find(s => s.id === r.itemEmpenhoId);

    if(!st || r.quantidadeEntregue <= 0 || r.quantidadeEntregue > st.saldo){
      msg.innerHTML = `<p class="notice error">Quantidade invalida ou maior que o saldo do item.</p>`;
      return;
    }

    rows.push(r);
  }

  if(!rows.length){
    msg.innerHTML = '<p class="notice error">Inclua pelo menos um item.</p>';
    return;
  }

  const eEmp = empenho(empId);
  const nfId = uid('nf');
  const arquivo = e.target.querySelector('[name="arquivo"]').files[0];

  db.notasFiscais.push({
    id: nfId,
    numero: fd.get('numero'),
    dataNf: fd.get('dataNf'),
    fornecedorId: eEmp.fornecedorId,
    empenhoId: empId,
    valorTotal: rows.reduce((a, i) => a + i.quantidadeEntregue * i.valorUnitario, 0),
    observacoes: fd.get('observacoes'),
    arquivoNome: arquivo ? arquivo.name : '',
    createdAt: new Date().toISOString()
  });

  rows.forEach(r => db.itensNotaFiscal.push({
    id: uid('item_nf'),
    notaFiscalId: nfId,
    ...r
  }));

  db.movimentacoes.push({
    id: uid('mov'),
    data: new Date().toISOString(),
    tipo: 'Lancamento de NF',
    descricao: `NF ${fd.get('numero')} lancada.`
  });

  save();
  msg.innerHTML = '<p class="notice ok">Nota Fiscal lancada com sucesso. Saldos atualizados.</p>';
  e.target.reset();
  document.getElementById('itensNF').innerHTML = '';
  calcNF();
}

function deleteEmp(id){
  if(!confirm('Excluir esta NE e todos os lancamentos vinculados?')) return;

  const itemIds = db.itensEmpenho.filter(i => i.empenhoId === id).map(i => i.id);
  const nfIds = db.notasFiscais.filter(n => n.empenhoId === id).map(n => n.id);

  db.empenhos = db.empenhos.filter(e => e.id !== id);
  db.itensEmpenho = db.itensEmpenho.filter(i => i.empenhoId !== id);
  db.notasFiscais = db.notasFiscais.filter(n => n.empenhoId !== id);
  db.itensNotaFiscal = db.itensNotaFiscal.filter(i => !itemIds.includes(i.itemEmpenhoId) && !nfIds.includes(i.notaFiscalId));

  save();
  tab = 'empenhos';
  render();
}

function download(name, content, type = 'text/plain'){
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = name;
  a.click();

  URL.revokeObjectURL(url);
}

function backup(){
  download(`backup-controle-empenhos-${today()}.json`, JSON.stringify(db, null, 2), 'application/json');
}

function restoreBackup(ev){
  const file = ev.target.files[0];
  if(!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try{
      db = { ...empty, ...JSON.parse(reader.result) };
      save();
      render();
    }catch{
      alert('Backup invalido.');
    }
  };
  reader.readAsText(file);
}

function resetAll(){
  if(confirm('Apagar todos os dados?')){
    db = structuredClone(empty);
    save();
    render();
  }
}

function formatDateTime(value){
  if(!value) return '-';

  try{
    return new Date(value).toLocaleString('pt-BR');
  }catch{
    return '-';
  }
}

function isSupabaseConfigured(config = loadSyncConfig()){
  return Boolean(config.url && config.anonKey && config.url.includes('.supabase.co'));
}

function getSupabaseClient(){
  const config = loadSyncConfig();

  if(!isSupabaseConfigured(config)){
    throw new Error('Configure a Project URL e a anon key do Supabase.');
  }

  if(!window.supabase?.createClient){
    throw new Error('Biblioteca do Supabase nao carregou. Verifique a conexao e recarregue a pagina.');
  }

  return window.supabase.createClient(config.url.trim(), config.anonKey.trim(), {
    auth: currentUser?.supabase ? supabaseAuthOptions() : {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function getSupabaseAuthClient(){
  const config = loadSyncConfig();

  if(!isSupabaseConfigured(config)){
    throw new Error('Configure a Project URL e a anon key do Supabase.');
  }

  if(!window.supabase?.createClient){
    throw new Error('Biblioteca do Supabase nao carregou. Verifique a conexao e recarregue a pagina.');
  }

  return window.supabase.createClient(config.url.trim(), config.anonKey.trim(), {
    auth: supabaseAuthOptions()
  });
}

function supabaseAuthOptions(){
  return {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    storage: window.localStorage
  };
}

function syncOwnerId(){
  const email = normalizeEmail(currentUser?.email);
  if(!email) throw new Error('Usuario Google nao identificado.');
  return email;
}

function canAutoSync(){
  return isSupabaseConfigured() && navigator.onLine !== false;
}

function setupAutomaticSync(){
  window.addEventListener('online', attemptAutoSync);
  window.addEventListener('focus', attemptAutoSync);
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') attemptAutoSync();
  });
}

function attemptAutoSync(){
  if(!canAutoSync()) return;

  syncNow({ silent: true }).catch(error => {
    saveSyncMeta({
      ...loadSyncMeta(),
      lastError: error.message
    });
  });
}

function requestAutoSync(){
  if(!canAutoSync()) return;
  if(syncTimer) clearTimeout(syncTimer);

  syncTimer = setTimeout(() => {
    attemptAutoSync();
  }, 1200);
}

async function fetchRemoteRow(client, ownerId){
  const { data, error } = await client
    .from(SYNC_TABLE)
    .select('payload, updated_at')
    .eq('id', ownerId)
    .maybeSingle();

  if(error) throw error;
  return data;
}

async function pushToSupabase(options = {}){
  try{
    const client = getSupabaseClient();
    const ownerId = syncOwnerId();
    const now = new Date().toISOString();

    const { error } = await client
      .from(SYNC_TABLE)
      .upsert({
        id: ownerId,
        owner_email: ownerId,
        payload: db,
        updated_at: now
      });

    if(error) throw error;

    saveSyncMeta({
      ...loadSyncMeta(),
      dirty: false,
      lastSyncedAt: now,
      lastError: ''
    });
  }catch(error){
    throw error;
  }
}

async function pullFromSupabase(options = {}){
  try{
    const client = getSupabaseClient();
    const ownerId = syncOwnerId();
    const remote = await fetchRemoteRow(client, ownerId);

    if(!remote?.payload){
      await pushToSupabase(options);
      return;
    }

    db = {
      ...empty,
      ...remote.payload
    };

    save({ dirty: false, autosync: false });
    saveSyncMeta({
      ...loadSyncMeta(),
      dirty: false,
      lastSyncedAt: remote.updated_at || new Date().toISOString(),
      lastError: ''
    });

    render();
  }catch(error){
    throw error;
  }
}

async function syncNow(options = {}){
  try{
    const meta = loadSyncMeta();
    const client = getSupabaseClient();
    const ownerId = syncOwnerId();
    const remote = await fetchRemoteRow(client, ownerId);

    if(meta.dirty || !remote){
      await pushToSupabase({ silent: true });
      return;
    }

    await pullFromSupabase({ silent: true });
  }catch(error){
    throw error;
  }
}

function start(){
  if(isElectronApp()){
    initLogin();
    return;
  }

  if(isLocalDevelopmentOrigin()){
    initLogin();
    return;
  }

  const maxAttempts = 50;
  let attempts = 0;

  const waitGoogle = () => {
    attempts += 1;

    if(window.google?.accounts?.id){
      initLogin();
      return;
    }

    if(attempts >= maxAttempts){
      showLoginError("Google API nao carregou. Verifique sua conexao e recarregue a pagina.");
      return;
    }

    setTimeout(waitGoogle, 100);
  };

  waitGoogle();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", start, { once: true });
}else{
  start();
}

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('node:http');
const path = require('node:path');

const OAUTH_CALLBACK_PORT = 53682;
const OAUTH_CALLBACK_PATH = '/auth/callback';
const OAUTH_REDIRECT_URL = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;

let mainWindow = null;
let callbackServer = null;
let callbackServerReady = null;

function createWindow(){
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'Controle de Empenhos',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function ensureOAuthCallbackServer(){
  if(callbackServerReady) return callbackServerReady;

  callbackServerReady = new Promise((resolve, reject) => {
    callbackServer = http.createServer((req, res) => {
      const callbackUrl = new URL(req.url, OAUTH_REDIRECT_URL);

      if(callbackUrl.pathname !== OAUTH_CALLBACK_PATH){
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      if(mainWindow && !mainWindow.isDestroyed()){
        console.log("CALLBACK URL:", callbackUrl.toString());
        mainWindow.webContents.send('supabase-oauth-callback', callbackUrl.toString());
        mainWindow.focus();
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`
        <!doctype html>
        <html lang="pt-BR">
          <head><meta charset="utf-8"><title>Login concluido</title></head>
          <body style="font-family: sans-serif; padding: 32px;">
            <h1>Login concluido</h1>
            <p>Voce ja pode voltar para o Controle de Empenhos.</p>
            <script>window.close();</script>
          </body>
        </html>
      `);
    });

    callbackServer.once('error', reject);
    callbackServer.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
      callbackServer.off('error', reject);
      resolve();
    });
  });

  return callbackServerReady;
}

ipcMain.handle('supabase-oauth-get-redirect-url', () => OAUTH_REDIRECT_URL);

ipcMain.handle('supabase-oauth-open', async (_event, authUrl) => {
  await ensureOAuthCallbackServer();
  await shell.openExternal(authUrl);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if(BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if(process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if(callbackServer) callbackServer.close();
});

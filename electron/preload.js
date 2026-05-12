const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronOAuth', {
  getRedirectUrl: () => ipcRenderer.invoke('supabase-oauth-get-redirect-url'),
  openExternalAuth: authUrl => ipcRenderer.invoke('supabase-oauth-open', authUrl),
  onCallback: callback => {
    const listener = (_event, callbackUrl) => callback(callbackUrl);
    ipcRenderer.on('supabase-oauth-callback', listener);
    return () => ipcRenderer.removeListener('supabase-oauth-callback', listener);
  }
});

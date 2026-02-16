// preload.mjs - Minimal conversation interface for Mobius
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('dai', {
  ask: (task, text, opts) => ipcRenderer.invoke('dai-ask', { task, text, ...opts })
});
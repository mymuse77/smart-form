import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('smartFormAgent', Object.freeze({
  focusChromium: (): Promise<boolean> => ipcRenderer.invoke('agent:focus-chromium'),
}));

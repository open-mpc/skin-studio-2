// Preload — one narrow bridge (contextIsolation on, no node in the page).
import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("studio", {
  call: (op: string, args?: unknown): Promise<any> => ipcRenderer.invoke("studio:call", op, args),
  onMenu: (fn: (id: string) => void): void => { ipcRenderer.on("studio:menu", (_e, id: string) => fn(id)); },
});

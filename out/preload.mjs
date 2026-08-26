import { contextBridge } from "electron";
//#region electron/preload.js
contextBridge.exposeInMainWorld("codeAgent", {
	isElectron: true,
	backendPort: process.env.PORT || "3001"
});
//#endregion
export {};

let electron = require("electron");
//#region electron/preload.js
electron.contextBridge.exposeInMainWorld("codeAgent", {
	isElectron: true,
	backendPort: process.env.PORT || "3001",
	window: {
		minimize: () => electron.ipcRenderer.send("window:minimize"),
		maximize: () => electron.ipcRenderer.send("window:maximize"),
		close: () => electron.ipcRenderer.send("window:close")
	}
});
//#endregion

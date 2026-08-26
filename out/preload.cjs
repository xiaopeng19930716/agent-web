//#region electron/preload.js
require("electron").contextBridge.exposeInMainWorld("codeAgent", {
	isElectron: true,
	backendPort: process.env.PORT || "3001"
});
//#endregion

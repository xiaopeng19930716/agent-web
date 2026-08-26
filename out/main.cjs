//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let electron = require("electron");
let node_os = require("node:os");
node_os = __toESM(node_os, 1);
let path = require("path");
let fs = require("fs");
let node_net = require("node:net");
node_net = __toESM(node_net, 1);
let node_child_process = require("node:child_process");
//#region electron/main.js
var isDev = !electron.app.isPackaged;
var DEV_URL = process.env.ELECTRON_DEV_URL || "http://localhost:5173";
var appRoot = electron.app.getAppPath();
function findFreePort(preferred = 3001) {
	return new Promise((resolve) => {
		const srv = node_net.default.createServer();
		srv.once("error", () => resolve(preferred + 1));
		srv.once("listening", () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.listen(preferred, "127.0.0.1");
	});
}
var backendPort = null;
var backendChild = null;
var mainWindow = null;
async function startBackend() {
	const dataDir = (0, path.join)(node_os.default.homedir(), ".code-agent");
	process.env.CODE_AGENT_DATA_DIR = dataDir;
	backendPort = isDev ? await findFreePort(3001) : 3001;
	process.env.PORT = String(backendPort);
	if (isDev) (0, fs.writeFileSync)((0, path.join)(appRoot, ".api-port"), String(backendPort), "utf-8");
	if (isDev) {
		const modulePath = (0, path.join)(appRoot, "server", "index.js");
		backendChild = (0, node_child_process.spawn)(process.execPath, [modulePath], {
			env: { ...process.env },
			stdio: "inherit"
		});
		backendChild.on("error", (e) => console.error("[dev] 后端子进程启动失败（若已手动启动 server 可忽略）:", e.message));
	} else {
		const unpackedRoot = (0, path.join)(process.resourcesPath, "app.asar.unpacked");
		const distInAsar = (0, path.join)(process.resourcesPath, "app.asar", "dist");
		const distLocal = (0, path.join)(appRoot, "dist");
		process.env.SERVE_DIST = (0, fs.existsSync)(distInAsar) ? distInAsar : distLocal;
		const modulePath = (0, path.join)(unpackedRoot, "server", "index.js");
		backendChild = (0, node_child_process.spawn)(process.execPath, [modulePath], {
			env: { ...process.env },
			stdio: "inherit"
		});
		backendChild.on("error", (e) => console.error("[prod] 后端子进程启动失败:", e.message));
	}
}
function createWindow() {
	mainWindow = new electron.BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		show: false,
		webPreferences: {
			preload: (0, path.join)(appRoot, "out", "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false
		},
		frame: false
	});
	if (isDev) {
		mainWindow.loadURL(DEV_URL);
		mainWindow.webContents.openDevTools({ mode: "detach" });
	} else mainWindow.loadURL(`http://localhost:${backendPort}`);
	mainWindow.once("ready-to-show", () => mainWindow.show());
	mainWindow.on("closed", () => {
		mainWindow = null;
		if (backendChild) backendChild.kill();
	});
}
electron.app.whenReady().then(async () => {
	electron.ipcMain.on("window:minimize", () => mainWindow?.minimize());
	electron.ipcMain.on("window:maximize", () => {
		if (!mainWindow) return;
		if (mainWindow.isMaximized()) mainWindow.unmaximize();
		else mainWindow.maximize();
	});
	electron.ipcMain.on("window:close", () => mainWindow?.close());
	try {
		await startBackend();
	} catch (e) {
		electron.dialog.showErrorBox("后端启动失败", String(e.message || e));
	}
	createWindow();
	electron.app.on("activate", () => {
		if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
electron.app.on("window-all-closed", () => {
	if (backendChild) backendChild.kill();
	if (process.platform !== "darwin") electron.app.quit();
});
//#endregion

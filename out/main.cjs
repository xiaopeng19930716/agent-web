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
var backendExited = false;
function waitForBackend(port, timeoutMs = 15e3) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const tryConnect = () => {
			if (backendExited) {
				reject(/* @__PURE__ */ new Error("后端进程已退出"));
				return;
			}
			if (Date.now() - start > timeoutMs) {
				reject(/* @__PURE__ */ new Error(`后端在 ${timeoutMs}ms 内未启动，端口 ${port} 无法连接`));
				return;
			}
			const sock = node_net.default.createConnection({
				port,
				host: "127.0.0.1"
			}, () => {
				sock.end();
				resolve();
			});
			sock.setTimeout(300);
			sock.on("error", () => {
				sock.destroy();
				setTimeout(tryConnect, 300);
			});
			sock.on("timeout", () => {
				sock.destroy();
				setTimeout(tryConnect, 300);
			});
		};
		tryConnect();
	});
}
async function startBackend() {
	const dataDir = (0, path.join)(node_os.default.homedir(), ".code-agent");
	process.env.CODE_AGENT_DATA_DIR = dataDir;
	backendPort = await findFreePort(37821);
	process.env.PORT = String(backendPort);
	if (isDev) (0, fs.writeFileSync)((0, path.join)(appRoot, ".api-port"), String(backendPort), "utf-8");
	const modulePath = isDev ? (0, path.join)(appRoot, "server", "index.js") : (0, path.join)(process.resourcesPath, "app.asar.unpacked", "server", "index.js");
	if (!isDev) {
		const distInAsar = (0, path.join)(process.resourcesPath, "app.asar", "dist");
		const distLocal = (0, path.join)(appRoot, "dist");
		process.env.SERVE_DIST = (0, fs.existsSync)(distInAsar) ? distInAsar : distLocal;
	}
	backendChild = (0, node_child_process.spawn)(process.execPath, [modulePath], {
		env: { ...process.env },
		stdio: "inherit"
	});
	backendChild.on("error", (e) => {
		console.error("[main] 后端子进程启动失败:", e.message);
	});
	backendChild.on("exit", (code, signal) => {
		backendExited = true;
		console.error(`[main] 后端子进程退出 code=${code} signal=${signal}`);
		if (mainWindow) {
			electron.dialog.showErrorBox("后端服务异常退出", `Code Agent 后端已停止（code=${code}），应用即将关闭。`);
			electron.app.quit();
		} else electron.app.quit();
	});
	await waitForBackend(backendPort);
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
	mainWindow.once("ready-to-show", () => mainWindow?.show());
	mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
		console.error("[main] 窗口加载失败:", errorCode, errorDescription);
		if (!isDev) electron.dialog.showErrorBox("页面加载失败", `${errorDescription}\n请检查后端服务是否正常运行。`);
	});
	mainWindow.on("closed", () => {
		mainWindow = null;
		if (backendChild && !backendChild.killed) backendChild.kill();
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
		createWindow();
	} catch (e) {
		console.error("[main] 启动失败:", e);
		electron.dialog.showErrorBox("启动失败", String(e.message || e));
		electron.app.quit();
	}
	electron.app.on("activate", () => {
		if (backendExited) return;
		if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
electron.app.on("window-all-closed", () => {
	if (backendChild && !backendChild.killed) backendChild.kill();
	if (process.platform !== "darwin") electron.app.quit();
});
//#endregion

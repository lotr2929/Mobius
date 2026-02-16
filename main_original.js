// main.js (ESM)
import { app, BrowserWindow, dialog, ipcMain, desktopCapturer, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register models at startup
import { registry } from './src/router/modelRegistry.js';
import { createOllama } from './src/models/ollamaClient.js';
import { createGroq } from './src/models/groqClient.js';
import { createDeepseek } from './src/models/deepseekClient.js';
import { createGpt4oMini } from './src/models/gpt4ominiClient.js';
import { createHaiku } from './src/models/haikuClient.js';

// Register all available models
registry.register(createOllama());
registry.register(createGroq(process.env.GROQ_API_KEY));  // Your actual key here
registry.register(createDeepseek());
registry.register(createGpt4oMini());
registry.register(createHaiku());

console.log('Registered models:', registry.list().map(m => m.name));

// NOW import router after models are registered
import { ask } from './src/router/router.js';

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "DesktopAI (DAI)",
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),  // Changed to .mjs
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  win.loadFile("index.html");
}

// DAI router handler
ipcMain.handle('dai-ask', async (_event, { task, text, privateTask }) => {
  try {
    return await ask({ task, text, privateTask });
  } catch (err) {
    console.error('DAI ask error:', err);
    return `Error: ${err.message}`;
  }
});

// Missing choose-folder handler
ipcMain.handle('choose-folder', async () => {
  const res = await dialog.showOpenDialog(win, { 
    properties: ['openDirectory']
  });
  return res.canceled ? null : res.filePaths[0];
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------------------------
// IPC: Read directory (text/code only, size/limit guards)
// ---------------------------
ipcMain.handle("read-directory", async (_event, dirPath) => {
  const results = [];
  const maxFileSize = 1024 * 1024; // 1MB per file
  const maxFiles = 100;            // safety cap

  function readDirRecursive(dir, depth = 0) {
    if (depth > 10 || results.length >= maxFiles) return;

    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        if (results.length >= maxFiles) break;

        // skip common junk
        if (
          item.startsWith(".") ||
          item === "node_modules" ||
          item === "__pycache__" ||
          item === "venv" ||
          item === "dist" ||
          item === "build"
        ) continue;

        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          readDirRecursive(fullPath, depth + 1);
        } else if (stat.isFile() && stat.size < maxFileSize) {
          const ext = path.extname(item).toLowerCase();
          const textExts = [
            ".js", ".py", ".java", ".cpp", ".c", ".h", ".cs", ".go", ".rs",
            ".txt", ".md", ".json", ".xml", ".yaml", ".yml", ".html", ".css"
          ];
          if (textExts.includes(ext)) {
            try {
              const content = fs.readFileSync(fullPath, "utf8");
              const relativePath = path.relative(dirPath, fullPath);
              results.push({ path: relativePath, content, size: stat.size });
            } catch {
              /* ignore unreadable files */
            }
          }
        }
      }
    } catch {
      /* ignore inaccessible folders */
    }
  }

  readDirRecursive(dirPath);
  return results;
});

// ---------------------------
// IPC: Choose files
// ---------------------------
ipcMain.handle("choose-files", async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "All Files", extensions: ["*"] },
      { name: "Documents", extensions: ["txt", "md", "pdf", "doc", "docx"] },
      { name: "Code", extensions: ["js", "py", "java", "cpp", "c", "h"] }
    ]
  });
  return res.canceled ? [] : res.filePaths;
});

// ---------------------------
// IPC: Capture screen
// ---------------------------
ipcMain.handle("capture-screen", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1920, height: 1080 }
  });
  if (!sources || sources.length === 0) throw new Error("No screen source found");
  const png = sources[0].thumbnail.toPNG();
  const tmp = path.join(app.getPath("temp"), `dai_cap_${Date.now()}.png`);
  fs.writeFileSync(tmp, png);
  return tmp;
});

// ---------------------------
// IPC: Extract webpage text
// ---------------------------
ipcMain.handle("extract-webview", async () => {
  const webview = win.webContents;
  return await webview.executeJavaScript("document.body.innerText");
});

// ---------------------------
// IPC: Read file / PDF (Poppler's pdftotext)
// ---------------------------
ipcMain.handle("read-file", async (_event, filePath) => {
  if (filePath.toLowerCase().endsWith(".pdf")) {
    return await new Promise((resolve, reject) => {
      const p = spawn("pdftotext", [filePath, "-"]);
      let buf = "";
      let err = "";
      p.stdout.on("data", d => (buf += d.toString()));
      p.stderr.on("data", d => (err += d.toString()));
      p.on("close", code => (code === 0 ? resolve(buf) : reject(new Error(err || "pdftotext failed"))));
    });
  } else {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return "(Binary or unreadable file)";
    }
  }
});

// ---------------------------
// IPC: Open external URL
// ---------------------------
ipcMain.on("open-external", (_e, url) => shell.openExternal(url));
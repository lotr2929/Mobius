// main.js - Minimal conversation interface for Mobius
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register models at startup
import { registry } from './src/router/modelRegistry.js';
import { createOllama } from './src/models/ollamaClient.js';
import { createGroq } from './src/models/groqClient.js';

// Register available models
registry.register(createOllama());
registry.register(createGroq(process.env.GROQ_API_KEY));

console.log('Registered models:', registry.list().map(m => m.name));

// Import router after models are registered
import { ask } from './src/router/router.js';

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    title: "Mobius",
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      webviewTag: false
    }
  });

  win.loadFile("index.html");
}

// AI handler with model integration
ipcMain.handle('dai-ask', async (_event, { task, text, privateTask }) => {
  try {
    return await ask({ task, text, privateTask });
  } catch (err) {
    console.error('DAI ask error:', err);
    return { model: 'Error', response: `Error: ${err.message}` };
  }
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
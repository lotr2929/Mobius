// ── Mobius Command Registry ───────────────────────────────────────────────────
// Client-side command handlers for colon-prefix commands.
// index.html calls detectCommand(text) to check if input is a command,
// then calls runCommand(command, args, callbacks) to execute it.
// Add new commands here without touching index.html.

// ── IndexedDB storage for folder handle ──────────────────────────────────────

const DB_NAME = 'MobiusFS';
const DB_STORE = 'handles';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(handle, 'rootHandle');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get('rootHandle');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function clearHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete('rootHandle');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ── Access management ─────────────────────────────────────────────────────────

let rootHandle = null; // in-memory cache for this session
let currentFolderHandle = null; // scoped by Folder: command

async function ensureAccess(output) {
  // Try in-memory first
  if (rootHandle) return true;

  // Try restoring from IndexedDB
  try {
    const stored = await loadHandle();
    if (stored) {
      // Verify permission is still granted
      const perm = await stored.queryPermission({ mode: 'read' });
      if (perm === 'granted') {
        rootHandle = stored;
        currentFolderHandle = stored;
        return true;
      }
      // Try to re-request permission
      const req = await stored.requestPermission({ mode: 'read' });
      if (req === 'granted') {
        rootHandle = stored;
        currentFolderHandle = stored;
        return true;
      }
    }
  } catch { /* fall through to prompt */ }

  // No stored handle — prompt user
  output('No folder access granted. Running GiveAccess...');
  return await handleGiveAccess(output);
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleGiveAccess(output) {
  if (!('showDirectoryPicker' in window)) {
    output('❌ File System Access API not supported in this browser. Use Chrome or Edge.');
    return false;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    rootHandle = handle;
    currentFolderHandle = handle;
    await saveHandle(handle);
    output(`✅ Access granted to: ${handle.name}`);
    return true;
  } catch (err) {
    if (err.name !== 'AbortError') output('❌ Access denied: ' + err.message);
    return false;
  }
}

async function handleResetAccess(output) {
  rootHandle = null;
  currentFolderHandle = null;
  await clearHandle();
  output('✅ Access cleared. Use GiveAccess: to grant a new folder.');
}

async function handleFolder(args, output) {
  if (!await ensureAccess(output)) return;
  const path = args.trim();
  if (!path) {
    output(`📁 Current folder: ${(currentFolderHandle || rootHandle).name}`);
    return;
  }
  // Navigate to subfolder by path segments
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  let handle = rootHandle;
  for (const part of parts) {
    try {
      handle = await handle.getDirectoryHandle(part);
    } catch {
      output(`❌ Folder not found: ${part}`);
      return;
    }
  }
  currentFolderHandle = handle;
  output(`📁 Scoped to folder: ${handle.name}`);
}

async function handleFind(args, output) {
  if (!await ensureAccess(output)) return;
  const query = args.trim().toLowerCase();
  if (!query) { output('Usage: Find: filename'); return; }

  const searchRoot = currentFolderHandle || rootHandle;
  output(`🔍 Searching in "${searchRoot.name}" for "${query}"...`);

  const results = [];
  await searchDirectory(searchRoot, query, results, '');

  if (results.length === 0) {
    output(`No files or folders matching "${query}" found.`);
  } else {
    output(`Found ${results.length} result(s):\n` + results.join('\n'));
  }
}

async function searchDirectory(dirHandle, query, results, path) {
  for await (const [name, handle] of dirHandle.entries()) {
    const fullPath = path ? `${path}/${name}` : name;
    if (name.toLowerCase().includes(query)) {
      results.push(`${handle.kind === 'directory' ? '📁' : '📄'} ${fullPath}`);
    }
    if (handle.kind === 'directory' && results.length < 200) {
      try { await searchDirectory(handle, query, results, fullPath); } catch { /* skip inaccessible */ }
    }
  }
}

async function handleRead(args, output, attachFile) {
  if (!await ensureAccess(output)) return;
  const filename = args.trim();
  if (!filename) { output('Usage: Read: filename'); return; }

  const searchRoot = currentFolderHandle || rootHandle;
  output(`📖 Looking for "${filename}"...`);

  const results = [];
  await searchDirectory(searchRoot, filename.toLowerCase(), results, '');
  const match = results.find(r => r.includes(filename));

  if (!match) { output(`❌ File "${filename}" not found.`); return; }

  // Navigate to file
  const parts = match.replace(/^📄 /, '').split('/');
  let dirHandle = searchRoot;
  for (let i = 0; i < parts.length - 1; i++) {
    dirHandle = await dirHandle.getDirectoryHandle(parts[i]);
  }
  const fileHandle = await dirHandle.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  const text = await file.text();

  // Attach as file chip via callback
  attachFile({ name: file.name, mimeType: 'text/plain', content: text });
  output(`✅ "${file.name}" attached (${text.length} chars).`);
}

async function handleList(args, output) {
  if (!await ensureAccess(output)) return;
  const searchRoot = currentFolderHandle || rootHandle;
  output(`📁 Contents of "${searchRoot.name}":`);
  const entries = [];
  for await (const [name, handle] of searchRoot.entries()) {
    entries.push(`${handle.kind === 'directory' ? '📁' : '📄'} ${name}`);
  }
  entries.sort();
  output(entries.join('\n'));
}

// ── Command registry ──────────────────────────────────────────────────────────

const COMMANDS = {
  'ask':         { requiresAccess: false, isAI: true  },
  'giveaccess':  { requiresAccess: false, isAI: false, handler: (args, out) => handleGiveAccess(out) },
  'resetaccess': { requiresAccess: false, isAI: false, handler: (args, out) => handleResetAccess(out) },
  'folder':      { requiresAccess: true,  isAI: false, handler: handleFolder },
  'find':        { requiresAccess: true,  isAI: false, handler: handleFind },
  'read':        { requiresAccess: true,  isAI: false, handler: (args, out, attach) => handleRead(args, out, attach) },
  'list':        { requiresAccess: true,  isAI: false, handler: handleList },
};

// ── Public API (called by index.html) ─────────────────────────────────────────

// Detects if text starts with a known command prefix e.g. "Find: something"
// Returns { command, args } or null if not a command
function detectCommand(text) {
  const match = text.match(/^(\w+):\s*(.*)/s);
  if (!match) return null;
  const command = match[1].toLowerCase();
  if (!COMMANDS[command]) return null;
  return { command, args: match[2].trim() };
}

// Runs a non-AI command, returns true if handled, false if should go to AI
async function runCommand(command, args, outputFn, attachFileFn) {
  const cmd = COMMANDS[command];
  if (!cmd || cmd.isAI) return false;
  await cmd.handler(args, outputFn, attachFileFn);
  return true;
}

// Returns the model override if Ask: was used, otherwise null
function getAskModel(text) {
  const match = text.match(/^Ask:\s*(\w+)/i);
  return match ? match[1].toLowerCase() : null;
}

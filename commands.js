// ── Mobius Command Registry ───────────────────────────────────────────────────
// Client-side command handlers for colon-prefix commands.
// index.html calls detectCommand(text) and runCommand() to execute commands.
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

let rootHandle = null;

async function ensureAccess(output) {
  if (rootHandle) return true;

  // Try restoring from IndexedDB
  try {
    const stored = await loadHandle();
    if (stored) {
      let perm = await stored.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        perm = await stored.requestPermission({ mode: 'read' });
      }
      if (perm === 'granted') {
        rootHandle = stored;
        return true;
      }
    }
  } catch { /* fall through */ }

  // No stored handle — prompt user
  output('No folder access granted. Running Access...');
  return await handleAccess(output);
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleAccess(output) {
  if (!('showDirectoryPicker' in window)) {
    output('❌ File System Access API not supported. Use Chrome or Edge on desktop/Android.');
    return false;
  }
  try {
    // Clear any previous root
    rootHandle = null;
    await clearHandle();

    const handle = await window.showDirectoryPicker({ mode: 'read' });
    rootHandle = handle;
    await saveHandle(handle);

    // Clear input box
    document.getElementById('input').value = '';

    // Auto-list contents
    const entries = [];
    for await (const [name, h] of handle.entries()) {
      entries.push(`${h.kind === 'directory' ? '📁' : '📄'} ${name}`);
    }
    entries.sort();
    output(`✅ Access granted to: ${handle.name}\n\n📁 Contents (${entries.length} items):\n` + entries.join('\n'));
    return true;
  } catch (err) {
    if (err.name !== 'AbortError') output('❌ Access denied: ' + err.message);
    else output('❌ Folder selection cancelled.');
    return false;
  }
}

async function handleFind(args, output) {
  if (!await ensureAccess(output)) return;
  const query = args.trim().toLowerCase();
  if (!query) { output('Usage: Find: filename'); return; }
  output(`🔍 Searching "${rootHandle.name}" for "${query}"...`);
  const results = [];
  await searchDirectory(rootHandle, query, results, '');
  document.getElementById('input').value = '';
  if (results.length === 0) {
    output(`No matches found for "${query}".`);
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
  output(`📖 Searching for "${filename}"...`);
  const results = [];
  await searchDirectory(rootHandle, filename.toLowerCase(), results, '');
  const match = results.find(r => r.includes('📄') && r.toLowerCase().includes(filename.toLowerCase()));
  if (!match) { output(`❌ File "${filename}" not found.`); return; }
  const parts = match.replace('📄 ', '').split('/');
  let dirHandle = rootHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dirHandle = await dirHandle.getDirectoryHandle(parts[i]);
  }
  const fileHandle = await dirHandle.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  const text = await file.text();
  attachFile({ name: file.name, mimeType: 'text/plain', base64: btoa(unescape(encodeURIComponent(text))) });
  document.getElementById('input').value = '';
  output(`✅ "${file.name}" attached (${text.length} chars). Type your query and Ask.`);
}

async function handleList(args, output) {
  if (!await ensureAccess(output)) return;
  const entries = [];
  for await (const [name, handle] of rootHandle.entries()) {
    entries.push(`${handle.kind === 'directory' ? '📁' : '📄'} ${name}`);
  }
  entries.sort();
  document.getElementById('input').value = '';
  output(`📁 "${rootHandle.name}" (${entries.length} items):\n` + entries.join('\n'));
}

// ── Command registry ──────────────────────────────────────────────────────────

const COMMANDS = {
  'ask':    { requiresAccess: false, isAI: true  },
  'access': { requiresAccess: false, isAI: false, handler: (args, out) => handleAccess(out) },
  'find':   { requiresAccess: true,  isAI: false, handler: handleFind },
  'read':   { requiresAccess: true,  isAI: false, handler: (args, out, attach) => handleRead(args, out, attach) },
  'list':   { requiresAccess: true,  isAI: false, handler: handleList },
};

// ── Public API (called by index.html) ─────────────────────────────────────────

function detectCommand(text) {
  const match = text.match(/^(\w+):\s*(.*)/s);
  if (!match) return null;
  const command = match[1].toLowerCase();
  if (!COMMANDS[command]) return null;
  return { command, args: match[2].trim() };
}

async function runCommand(command, args, outputFn, attachFileFn) {
  const cmd = COMMANDS[command];
  if (!cmd || cmd.isAI) return false;
  await cmd.handler(args, outputFn, attachFileFn);
  return true;
}

function getAskModel(text) {
  const match = text.match(/^Ask:\s*(\w+)/i);
  return match ? match[1].toLowerCase() : null;
}

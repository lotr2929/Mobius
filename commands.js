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


async function handleChatHistory(output) {
  output('Loading chat history...');
  try {
    const userId = (typeof getAuth === 'function' ? getAuth('mobius_user_id') : null) || localStorage.getItem('mobius_user_id');
    const res = await fetch('/api/chat-history?userId=' + userId);
    const data = await res.json();
    if (window.renderChatHistoryList) {
      document.getElementById('input').value = '';
      window.renderChatHistoryList(data.sessions || []);
    } else {
      output('Error: renderChatHistoryList not available.');
    }
  } catch (err) {
    output('Error loading chat history: ' + err.message);
  }
}

// ── Command registry ──────────────────────────────────────────────────────────

const COMMANDS = {
  'ask':    { requiresAccess: false, isAI: true  },
  'access': { requiresAccess: false, isAI: false, handler: (args, out) => handleAccess(out) },
  'find':   { requiresAccess: true,  isAI: false, handler: handleFind },
  'list':   { requiresAccess: true,  isAI: false, handler: handleList },
  'history': { requiresAccess: false, isAI: false, handler: (args, out) => handleChatHistory(out) },
};

// ── Public API (called by index.html) ─────────────────────────────────────────

function detectCommand(text) {
  const match = text.match(/^(\w+):\s*(.*)/s);
  if (!match) return null;
  const command = match[1].toLowerCase();
  if (!COMMANDS[command]) return null;
  return { command, args: match[2].trim() };
}

async function runCommand(command, args, outputFn) {
  const cmd = COMMANDS[command];
  if (!cmd || cmd.isAI) return false;
  await cmd.handler(args, outputFn, attachFileFn);
  return true;
}

function getAskModel(text) {
  const match = text.match(/^Ask:\s*(\w+)/i);
  return match ? match[1].toLowerCase() : null;
}
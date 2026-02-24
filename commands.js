// ── Mobius Command Registry ───────────────────────────────────────────────────
// Client-side command handlers for colon-prefix commands.
// index.html calls detectCommand(text) and runCommand() to execute commands.
// Single-word commands (no colon) are also recognised.

// ── Model persistence ─────────────────────────────────────────────────────────

const MODEL_CHAIN = ['groq', 'gemini', 'mistral'];

function getLastModel() {
  return localStorage.getItem('mobius_last_model') || 'groq';
}

function setLastModel(model) {
  if (MODEL_CHAIN.includes(model)) {
    localStorage.setItem('mobius_last_model', model);
  }
}

function nextModelInChain(current) {
  const idx = MODEL_CHAIN.indexOf(current);
  if (idx === -1 || idx === MODEL_CHAIN.length - 1) return null;
  return MODEL_CHAIN[idx + 1];
}

// ── IndexedDB storage for folder handle ──────────────────────────────────────

const DB_NAME  = 'MobiusFS';
const DB_STORE = 'handles';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

async function saveHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(handle, 'rootHandle');
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

async function loadHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get('rootHandle');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => reject(req.error);
  });
}

async function clearHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete('rootHandle');
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

// ── Access management ─────────────────────────────────────────────────────────

let rootHandle = null;

async function ensureAccess(output) {
  if (rootHandle) return true;
  try {
    const stored = await loadHandle();
    if (stored) {
      let perm = await stored.queryPermission({ mode: 'read' });
      if (perm !== 'granted') perm = await stored.requestPermission({ mode: 'read' });
      if (perm === 'granted') { rootHandle = stored; return true; }
    }
  } catch { /* fall through */ }
  output('No folder access granted. Running Access...');
  return await handleAccess(output);
}

// ── Date / Time / Location ────────────────────────────────────────────────────

function handleDate(args, output) {
  const now = new Date();
  const str = now.toLocaleDateString('en-AU', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  document.getElementById('input').value = '';
  output('📅 ' + str);
}

function handleTime(args, output) {
  const now = new Date();
  const str = now.toLocaleTimeString('en-AU', { hour:'numeric', minute:'2-digit', hour12:true });
  document.getElementById('input').value = '';
  output('🕐 ' + str);
}

async function handleLocation(args, output) {
  output('📍 Detecting location...');
  try {
    const res  = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    if (data.error) throw new Error(data.reason || 'Unknown error');
    document.getElementById('input').value = '';
    output('📍 ' + data.city + ', ' + data.region + ', ' + data.country_name + ' (' + data.country_code + ')\n🌐 IP: ' + data.ip + '\n🕐 Timezone: ' + data.timezone);
  } catch (err) {
    output('❌ Location unavailable: ' + err.message);
  }
}

// ── Google ────────────────────────────────────────────────────────────────────

async function handleGoogle(args, output) {
  const userId = getAuth('mobius_user_id');
  if (!userId) { output('❌ Not logged in.'); return; }
  output('🔍 Fetching Google account info...');
  try {
    const res  = await fetch('/api/google/info?userId=' + encodeURIComponent(userId));
    const data = await res.json();
    if (data.error) { output('❌ ' + data.error); return; }
    const lines = [
      '🔗 Google Account',
      'Name:  ' + data.name,
      'Email: ' + data.email,
    ];
    output(lines.join('\n'));
  } catch (err) {
    output('❌ Failed to fetch Google info: ' + err.message);
  }
}

// ── Device ────────────────────────────────────────────────────────────────────

async function handleDevice(args, output) {
  const ua  = navigator.userAgent;
  const nav = navigator;
  const lines = ['🖥️  Device Information'];

  // OS detection with Windows build hint
  let os =
    /Windows NT 10/.test(ua)   ? 'Windows 10/11' :
    /Windows NT 6\.3/.test(ua) ? 'Windows 8.1' :
    /Mac OS X/.test(ua)        ? 'macOS ' + (ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g,'.') || '') :
    /Android/.test(ua)         ? 'Android ' + (ua.match(/Android ([\d.]+)/)?.[1] || '') :
    /iPhone|iPad/.test(ua)     ? 'iOS ' + (ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g,'.') || '') :
    /Linux/.test(ua)           ? 'Linux' : 'Unknown';

  // Try userAgentData for architecture and platform detail (Chromium-based)
  let arch = '';
  if (nav.userAgentData) {
    try {
      const hi = await nav.userAgentData.getHighEntropyValues(['architecture','bitness','platformVersion','model']);
      if (hi.architecture) arch = hi.architecture + (hi.bitness ? '-bit' : '');
      if (hi.model)        lines.push('Device model: ' + hi.model);
      // Windows 11 = platformVersion major >= 13
      if (/Windows/.test(os) && hi.platformVersion) {
        const major = parseInt(hi.platformVersion.split('.')[0]);
        if (major >= 13) os = 'Windows 11';
        else if (major > 0) os = 'Windows 10';
      }
    } catch { /* high entropy not granted */ }
  }
  lines.push('OS: ' + os);
  if (arch) lines.push('Architecture: ' + arch);

  const browser =
    /Edg\//.test(ua)     ? 'Edge '    + (ua.match(/Edg\/([\d.]+)/)?.[1]    || '') :
    /Chrome\//.test(ua)  ? 'Chrome '  + (ua.match(/Chrome\/([\d.]+)/)?.[1]  || '') :
    /Firefox\//.test(ua) ? 'Firefox ' + (ua.match(/Firefox\/([\d.]+)/)?.[1] || '') :
    /Safari\//.test(ua)  ? 'Safari '  + (ua.match(/Version\/([\d.]+)/)?.[1] || '') : 'Unknown';
  lines.push('Browser: ' + browser);

  const isMobile = /Mobi|Android|iPhone|iPad/.test(ua);
  const isTablet = /iPad|Tablet/.test(ua) || (isMobile && Math.min(screen.width, screen.height) > 600);
  lines.push('Device type: ' + (isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop'));
  lines.push('Screen: ' + screen.width + '\xd7' + screen.height + ' (' + window.devicePixelRatio + '\xd7 DPR)');

  lines.push('Color depth: ' + screen.colorDepth + '-bit');
  lines.push('Orientation: ' + (screen.orientation?.type || 'unknown'));

  if (nav.hardwareConcurrency) lines.push('CPU cores: ' + nav.hardwareConcurrency);
  if (nav.deviceMemory)        lines.push('RAM: ~' + nav.deviceMemory + ' GB');

  // GPU via WebGL
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbgInfo) {
        const vendor   = gl.getParameter(dbgInfo.UNMASKED_VENDOR_WEBGL);
        const renderer = gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL);
        if (vendor)   lines.push('GPU vendor: ' + vendor);
        if (renderer) lines.push('GPU: ' + renderer);
      }
    }
  } catch { /* unavailable */ }

  try {
    const est   = await navigator.storage.estimate();
    const used  = (est.usage / 1024 / 1024).toFixed(1);
    const quota = (est.quota / 1024 / 1024 / 1024).toFixed(2);
    lines.push('Storage used: ' + used + ' MB of ~' + quota + ' GB quota');
  } catch { /* unavailable */ }

  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (conn) {
    if (conn.effectiveType) lines.push('Connection: ' + conn.effectiveType.toUpperCase());
    if (conn.downlink)      lines.push('Bandwidth: ~' + conn.downlink + ' Mbps');
    if (conn.rtt)           lines.push('Latency: ' + conn.rtt + ' ms');
  }

  lines.push('Language: ' + (nav.language || 'unknown'));
  lines.push('Dark mode: ' + (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'Yes' : 'No'));
  lines.push('Online: ' + (nav.onLine ? 'Yes' : 'No'));
  const hasTouch = 'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    navigator.msMaxTouchPoints > 0;
  lines.push('Touch: ' + (hasTouch ? 'Yes (' + (navigator.maxTouchPoints || navigator.msMaxTouchPoints) + ' points)' : 'No'));

  document.getElementById('input').value = '';
  output(lines.join('\n'));
}

// ── Access ────────────────────────────────────────────────────────────────────

async function handleAccess(output) {
  if (!('showDirectoryPicker' in window)) {
    output('❌ File System Access API not supported. Use Chrome or Edge on desktop/Android.');
    return false;
  }
  try {
    rootHandle = null;
    await clearHandle();
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    rootHandle = handle;
    await saveHandle(handle);
    document.getElementById('input').value = '';
    const entries = [];
    for await (const [name, h] of handle.entries()) {
      entries.push((h.kind === 'directory' ? '📁' : '📄') + ' ' + name);
    }
    entries.sort();
    output('✅ Access granted to: ' + handle.name + '\n\n📁 Contents (' + entries.length + ' items):\n' + entries.join('\n'));
    return true;
  } catch (err) {
    if (err.name !== 'AbortError') output('❌ Access denied: ' + err.message);
    else output('❌ Folder selection cancelled.');
    return false;
  }
}

// ── Find (with Ext:, From:, To: sub-args) ────────────────────────────────────

function parseNaturalDate(str) {
  if (!str) return null;
  const s   = str.trim().toLowerCase();
  const now = new Date();
  if (s === 'today')      { const d = new Date(now); d.setHours(0,0,0,0); return d; }
  if (s === 'yesterday')  { const d = new Date(now); d.setDate(d.getDate()-1); d.setHours(0,0,0,0); return d; }
  if (s === 'last week')  { const d = new Date(now); d.setDate(d.getDate()-7); d.setHours(0,0,0,0); return d; }
  if (s === 'last month') { const d = new Date(now); d.setMonth(d.getMonth()-1); d.setHours(0,0,0,0); return d; }
  if (s === 'last year')  { const d = new Date(now); d.setFullYear(d.getFullYear()-1); d.setHours(0,0,0,0); return d; }
  const parsed = new Date(str);
  return isNaN(parsed) ? null : parsed;
}

function parseFindArgs(raw) {
  const subArgPattern = /\b(Ext|From|To):\s*/gi;
  const parts  = {};
  const tokens = raw.split(subArgPattern);
  parts.name = tokens[0].trim().toLowerCase();
  for (let i = 1; i < tokens.length; i += 2) {
    const key = tokens[i].toLowerCase();
    const val = (tokens[i+1] || '').trim();
    if (key === 'ext')  parts.ext  = val.replace(/^\./, '').toLowerCase();
    if (key === 'from') parts.from = parseNaturalDate(val);
    if (key === 'to')   parts.to   = parseNaturalDate(val);
  }
  if (parts.to) { parts.to = new Date(parts.to); parts.to.setHours(23,59,59,999); }
  return parts;
}

async function handleFind(args, output) {
  if (!await ensureAccess(output)) return;
  if (!args.trim()) { output('Usage: Find: filename [Ext: pdf] [From: last month] [To: today]'); return; }

  const { name, ext, from, to } = parseFindArgs(args);
  if (!name) { output('Usage: Find: filename [Ext: pdf] [From: last month] [To: today]'); return; }

  let desc = 'Searching "' + rootHandle.name + '" for "' + name + '"';
  if (ext)  desc += ' [.' + ext + ']';
  if (from) desc += ' [from ' + from.toLocaleDateString('en-AU') + ']';
  if (to)   desc += ' [to ' + to.toLocaleDateString('en-AU') + ']';
  output('🔍 ' + desc + '...');

  const results = [];
  await searchDirectory(rootHandle, name, ext || null, from || null, to || null, results, '');
  document.getElementById('input').value = '';

  if (results.length === 0) {
    output('No matches found for "' + name + '".');
  } else {
    output('Found ' + results.length + ' result(s):\n' + results.join('\n'));
  }
}

async function searchDirectory(dirHandle, query, ext, from, to, results, path) {
  for await (const [name, handle] of dirHandle.entries()) {
    const fullPath  = path ? path + '/' + name : name;
    const nameLower = name.toLowerCase();

    if (!nameLower.includes(query)) {
      if (handle.kind === 'directory' && results.length < 200) {
        try { await searchDirectory(handle, query, ext, from, to, results, fullPath); } catch { /* skip */ }
      }
      continue;
    }

    if (ext && handle.kind === 'file') {
      const dotIdx  = nameLower.lastIndexOf('.');
      const fileExt = dotIdx !== -1 ? nameLower.slice(dotIdx + 1) : '';
      if (fileExt !== ext) continue;
    }

    if ((from || to) && handle.kind === 'file') {
      try {
        const file     = await handle.getFile();
        const modified = new Date(file.lastModified);
        if (from && modified < from) continue;
        if (to   && modified > to)   continue;
      } catch { /* skip if unreadable */ }
    }

    results.push((handle.kind === 'directory' ? '📁' : '📄') + ' ' + fullPath);

    if (handle.kind === 'directory' && results.length < 200) {
      try { await searchDirectory(handle, query, ext, from, to, results, fullPath); } catch { /* skip */ }
    }
  }
}

// ── List ──────────────────────────────────────────────────────────────────────

async function handleList(args, output) {
  if (!await ensureAccess(output)) return;
  const entries = [];
  for await (const [name, handle] of rootHandle.entries()) {
    entries.push((handle.kind === 'directory' ? '📁' : '📄') + ' ' + name);
  }
  entries.sort();
  document.getElementById('input').value = '';
  output('📁 "' + rootHandle.name + '" (' + entries.length + ' items):\n' + entries.join('\n'));
}

// ── Chat History ──────────────────────────────────────────────────────────────

async function handleChatHistory(args, output) {
  output('Loading chat history...');
  try {
    const userId = localStorage.getItem('mobius_user_id');
    const res    = await fetch('/api/chat-history?userId=' + userId);
    const data   = await res.json();
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
  'date':     { requiresAccess: false, isAI: false, handler: handleDate },
  'time':     { requiresAccess: false, isAI: false, handler: handleTime },
  'location': { requiresAccess: false, isAI: false, handler: handleLocation },
  'device':   { requiresAccess: false, isAI: false, handler: handleDevice },
  'google':   { requiresAccess: false, isAI: false, handler: handleGoogle },
  'access':   { requiresAccess: false, isAI: false, handler: function(args, out) { return handleAccess(out); } },
  'find':     { requiresAccess: true,  isAI: false, handler: handleFind },
  'list':     { requiresAccess: true,  isAI: false, handler: handleList },
  'history':  { requiresAccess: false, isAI: false, handler: handleChatHistory },
  'ask':      { requiresAccess: false, isAI: true },
};

// Commands that work as a single word with no colon needed
const SINGLE_WORD_COMMANDS = new Set(['date','time','location','device','access','list','history','google']);

// ── Public API (called by index.html) ─────────────────────────────────────────

function detectCommand(text) {
  const trimmed = text.trim();
  const lower   = trimmed.toLowerCase();

  // Single-word shortcut — no whitespace, no colon required
  if (SINGLE_WORD_COMMANDS.has(lower) && !/\s/.test(trimmed)) {
    return { command: lower, args: '' };
  }

  // Standard colon-prefix
  const match = trimmed.match(/^(\w+):\s*([\s\S]*)/);
  if (!match) return null;
  const command = match[1].toLowerCase();
  if (!COMMANDS[command]) return null;
  return { command, args: match[2].trim() };
}

async function runCommand(command, args, outputFn) {
  const cmd = COMMANDS[command];
  if (!cmd || cmd.isAI) return false;
  await cmd.handler(args, outputFn);
  return true;
}

// Returns the model for the current Ask and updates saved default if explicit.
function getAskModel(text) {
  const match = text.match(/^Ask:\s*(\w+)/i);
  if (match) {
    const model = match[1].toLowerCase();
    if (MODEL_CHAIN.includes(model)) {
      setLastModel(model);
      return model;
    }
  }
  return getLastModel();
}
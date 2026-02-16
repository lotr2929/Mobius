// renderer.js
const web = document.getElementById('web');
const urlBox = document.getElementById('url');
const goBtn = document.getElementById('go');
const readBtn = document.getElementById('readPage');
const scopeBtn = document.getElementById('btnScope');
const shotBtn = document.getElementById('btnShot');
const promptBox = document.getElementById('prompt');
const askBtn = document.getElementById('ask');
const clearBtn = document.getElementById('clear');
const out = document.getElementById('out');
const fileInput = document.getElementById('fileDrop');
const filesDiv = document.getElementById('files');
const statusEl = document.getElementById('status');

let scopePath = null;

// Load Google by default
window.addEventListener('DOMContentLoaded', () => {
  web.setAttribute('src', 'https://www.google.com');
  urlBox.value = 'https://www.google.com';
});

function println(s) {
  out.textContent = (out.textContent + "\n" + s).trim();
}
function setStatus(s) { statusEl.textContent = s; }

// Browser navigation
goBtn.onclick = () => {
  let u = urlBox.value.trim();
  if (!u) return;
  
  if (/^https?:\/\//i.test(u) || u.includes('.')) {
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    web.setAttribute('src', u);
  } else {
    const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(u);
    web.setAttribute('src', searchUrl);
  }
};

urlBox.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') goBtn.click();
});

// Read the full DOM of the webview
readBtn.onclick = async () => {
  setStatus('Reading DOM…');
  try {
    const info = await web.executeJavaScript(`
      (function() {
        const title = document.title || '';
        const url = location.href;
        let text = document.body ? document.body.innerText : '';
        if (!text) text = document.documentElement.outerHTML.slice(0, 800000);
        return JSON.stringify({ title, url, text });
      })()
    `);

    const obj = JSON.parse(info);
    const brief = `PAGE: ${obj.title}\nURL: ${obj.url}\n\n${obj.text.slice(0,6000)}...`;
    const result = await window.dai.ask('general', "Summarize the page:\n\n" + brief);
    println(`${result.model}:`);
    println(result.response);
  } catch (e) {
    println("Error: " + e.message);
  } finally {
    setStatus('Ready');
  }
};

// Folder scope
scopeBtn.onclick = async () => {
  scopePath = await window.dai.chooseFolder();
  if (scopePath) println(`Scope set to: ${scopePath}`);
};

// Analyze entire repo
const analyzeBtn = document.getElementById('analyzeRepo');
analyzeBtn.onclick = async () => {
  if (!scopePath) {
    println('Error: Set folder scope first');
    return;
  }
  
  setStatus('Scanning repo...');
  println(`Starting repo analysis of: ${scopePath}`);
  
  try {
    const files = await window.dai.readDirectory(scopePath);
    println(`Found ${files.length} code files`);
    
    let combined = `Analyze this codebase and provide:\n1. Architecture overview\n2. Main components/modules\n3. Potential issues or improvements\n4. Code quality assessment\n\n`;
    
    for (const f of files) {
      combined += `\n--- FILE: ${f.path} (${f.size} bytes) ---\n${f.content}\n`;
    }
    
    if (combined.length > 100000) {
      combined = combined.slice(0, 100000) + '\n\n[Truncated - repo too large]';
    }
    
    setStatus('Analyzing repo (this may take 2-3 minutes)...');
    const result = await window.dai.ask('code_analysis', combined);
    println('\n=== REPO ANALYSIS ===');
    println(`${result.model}:`);
    println(result.response);
    
  } catch (e) {
    println('Repo analysis error: ' + e.message);
  } finally {
    setStatus('Ready');
  }
};

// Screenshot → OCR
shotBtn.onclick = async () => {
  setStatus('Capturing…');
  try {
    const imgPath = await window.dai.captureScreen();
    println(`Captured: ${imgPath}`);
    const ocr = await runTesseract(imgPath);
    const result = await window.dai.ask('general', "OCR text:\n" + ocr);
    println(`${result.model}:`);
    println(result.response);
  } catch (e) {
    println("OCR error: " + e.message);
  } finally {
    setStatus('Ready');
  }
};

// Run system tesseract
async function runTesseract(imgPath) {
  const { spawn } = require('child_process');
  return await new Promise((resolve, reject) => {
    const p = spawn('tesseract', [imgPath, 'stdout']);
    let buf = '';
    p.stdout.on('data', d => buf += d.toString());
    p.stderr.on('data', _ => {});
    p.on('close', code => code === 0 ? resolve(buf.trim()) : reject(new Error('tesseract exit ' + code)));
  });
}

// File selection button
fileInput.onclick = async (e) => {
  e.preventDefault();
  
  const filePaths = await window.dai.chooseFiles();
  if (!filePaths || filePaths.length === 0) return;
  
  for (const filePath of filePaths) {
    const fileName = filePath.split(/[\\/]/).pop();
    filesDiv.innerHTML += `<div>${fileName}</div>`;
    
    setStatus('Reading file...');
    try {
      const text = await window.dai.readFile(filePath);
      println(`Read ${fileName}: ${text.length} characters`);
      
      setStatus('Thinking...');
      const result = await window.dai.ask('general', `Summarize file "${fileName}":\n\n` + text.slice(0,20000));
      println(`${result.model}:`);
      println(result.response);
    } catch (err) {
      println(`Error reading ${fileName}: ${err.message}`);
    } finally {
      setStatus('Ready');
    }
  }
};

// Chat box
askBtn.onclick = async () => {
  const prompt = promptBox.value.trim();
  if (!prompt) return;
  
  setStatus('Thinking...');
  println('Asking DAI...');
  
  try {
    const result = await window.dai.ask('general', prompt);
    println(`${result.model}:`);
    println(result.response);
  } catch (err) {
    println(`Error: ${err.message}`);
  } finally {
    setStatus('Ready');
  }
};

clearBtn.onclick = () => out.textContent = '';
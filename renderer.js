// renderer.js - Minimal conversation interface for Mobius
const promptBox = document.getElementById('prompt');
const askBtn = document.getElementById('ask');
const clearBtn = document.getElementById('clear');
const messagesDiv = document.getElementById('messages');
const statusEl = document.getElementById('status');

// Simple markdown parser
function parseMarkdown(text) {
  return text
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Code blocks
    .replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Line breaks
    .replace(/\n/g, '<br>');
}

// Auto-resize textarea
promptBox.addEventListener('input', () => {
  promptBox.style.height = 'auto';
  promptBox.style.height = Math.min(promptBox.scrollHeight, 120) + 'px';
});

function setStatus(s) { 
  statusEl.textContent = s; 
}

function addMessage(content, isUser = false, model = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
  
  if (!isUser && model) {
    const modelLabel = document.createElement('div');
    modelLabel.className = 'model-label';
    modelLabel.textContent = model;
    messageDiv.appendChild(modelLabel);
  }
  
  const messageContent = document.createElement('div');
  if (isUser) {
    messageContent.textContent = content;
  } else {
    // Parse markdown for AI responses
    messageContent.innerHTML = parseMarkdown(content);
  }
  messageDiv.appendChild(messageContent);
  
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Send message on Enter (Shift+Enter for new line)
promptBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    askBtn.click();
  }
});

// Ask button
askBtn.onclick = async () => {
  const prompt = promptBox.value.trim();
  if (!prompt) return;
  
  // Add user message
  addMessage(prompt, true);
  promptBox.value = '';
  promptBox.style.height = 'auto';
  
  setStatus('Thinking...');
  askBtn.disabled = true;
  
  try {
    const result = await window.dai.ask('general', prompt);
    addMessage(result.response, false, result.model);
  } catch (err) {
    addMessage(`Error: ${err.message}`, false, 'System');
  } finally {
    setStatus('Ready');
    askBtn.disabled = false;
    promptBox.focus();
  }
};

// Clear button
clearBtn.onclick = () => {
  messagesDiv.innerHTML = '';
  setStatus('Ready');
};

// Focus on input
window.addEventListener('DOMContentLoaded', () => {
  promptBox.focus();
});
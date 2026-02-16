// server.js - Web server for Mobius
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// AI Model Clients
const models = {
  groq: {
    name: 'Groq (Cloud)',
    apiKey: process.env.GROQ_API_KEY,
    async ask(text) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: text }],
            stream: false
          })
        });
        
        if (!response.ok) {
          throw new Error(`Groq error: ${response.status}`);
        }
        
        const data = await response.json();
        return data.choices[0].message.content;
      } catch (error) {
        throw new Error(`Groq API error: ${error.message}`);
      }
    }
  },
  
  local: {
    name: 'Local Ollama',
    async ask(text) {
      try {
        const response = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen',
            prompt: text,
            stream: false
          })
        });
        
        if (!response.ok) {
          throw new Error(`Ollama error: ${response.status}`);
        }
        
        const data = await response.json();
        return data.response;
      } catch (error) {
        if (error.message.includes('ECONNREFUSED')) {
          throw new Error('Ollama is not running. Please start Ollama first.');
        }
        throw error;
      }
    }
  }
};

// Simple markdown parser
function parseMarkdown(text) {
  return text
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

// Routes
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mobius - AI Chat Interface</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #F5F2E8;
            color: #3D3D3D;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .container {
            flex: 1;
            display: flex;
            flex-direction: column;
            max-width: 1200px;
            margin: 0 auto;
            width: 100%;
            padding: 20px;
        }
        
        .chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: #FFF8E7;
            border: 1px solid #E8E0D4;
            border-radius: 12px;
            overflow: hidden;
        }
        
        .messages {
            flex: 1;
            padding: 24px;
            overflow-y: auto;
            font-size: 14px;
            line-height: 1.7;
            background: #FFF8E7;
        }
        
        .message {
            margin-bottom: 20px;
            padding: 20px;
            border-radius: 10px;
            background: #FFFFFF;
        }
        
        .model-label {
            font-size: 11px;
            color: #8B7355;
            margin-bottom: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .input-container {
            display: flex;
            padding: 24px;
            background: #FFF8E7;
            border-top: 1px solid #E8E0D4;
            gap: 16px;
        }
        
        #prompt {
            flex: 1;
            padding: 18px;
            border: 2px solid #E8E0D4;
            border-radius: 10px;
            background: #FFFFFF;
            color: #3D3D3D;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            resize: vertical;
            min-height: 24px;
            max-height: 120px;
            transition: all 0.3s ease;
        }
        
        #prompt:focus {
            outline: none;
            border-color: #A67C52;
        }
        
        button {
            padding: 18px 28px;
            border: none;
            border-radius: 10px;
            background: #A67C52;
            color: #FFFFFF;
            cursor: pointer;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        
        button:hover {
            background: #8B6F47;
        }
        
        button:disabled {
            background: #D4C4B0;
            color: #8B7355;
            cursor: not-allowed;
        }
        
        .status {
            padding: 14px 24px;
            background: #A67C52;
            color: #FFFFFF;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            text-align: center;
        }
        
        /* Markdown styling */
        .message h1, .message h2, .message h3 {
            margin: 16px 0 8px 0;
            color: #3D3D3D;
            font-weight: 600;
        }
        
        .message h1 { font-size: 18px; }
        .message h2 { font-size: 16px; }
        .message h3 { font-size: 14px; }
        
        .message strong {
            font-weight: 600;
            color: #3D3D3D;
        }
        
        .message em {
            font-style: italic;
            color: #5D5D5D;
        }
        
        .message code {
            background: #F0E6D2;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            color: #8B6F47;
        }
        
        .message pre {
            background: #F0E6D2;
            padding: 12px;
            border-radius: 8px;
            margin: 12px 0;
            overflow-x: auto;
            border-left: 3px solid #A67C52;
        }
        
        .message pre code {
            background: none;
            padding: 0;
            color: #3D3D3D;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="chat-container">
            <div id="messages" class="messages"></div>
            <div class="input-container">
                <textarea id="prompt" placeholder="Ask something..." rows="1"></textarea>
                <button id="ask">Ask</button>
                <button id="clear">Clear</button>
            </div>
        </div>
    </div>
    <div id="status" class="status">Ready</div>
    
    <script>
        const promptBox = document.getElementById('prompt');
        const askBtn = document.getElementById('ask');
        const clearBtn = document.getElementById('clear');
        const messagesDiv = document.getElementById('messages');
        const statusEl = document.getElementById('status');

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
            messageDiv.className = 'message';
            
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
                const response = await fetch('/api/ask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: prompt })
                });
                
                const result = await response.json();
                addMessage(result.response, false, result.model);
            } catch (err) {
                addMessage(\`Error: \${err.message}\`, false, 'System');
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
    </script>
</body>
</html>
  `);
});

app.post('/api/ask', async (req, res) => {
  try {
    const { text } = req.body;
    
    // Try Groq first, fallback to local
    let response;
    let model;
    
    try {
      response = await models.groq.ask(text);
      model = models.groq.name;
    } catch (error) {
      console.log('Groq failed, trying local:', error.message);
      try {
        response = await models.local.ask(text);
        model = models.local.name;
      } catch (localError) {
        throw new Error('Both Groq and local models failed');
      }
    }
    
    res.json({ response, model });
  } catch (error) {
    console.error('AI ask error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(\`Mobius web server running on port \${PORT}\`);
  console.log(\`Access at: http://localhost:\${PORT}\`);
});

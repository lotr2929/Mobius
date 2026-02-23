import express from 'express';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { getDriveFiles, getTasks, getCalendarEvents, getEmails, getGoogleClient } from './google_api.js';
import multer from 'multer';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));
app.use(express.static('.'));

// ── Multer (file uploads, memory storage) ────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── AI functions ──────────────────────────────────────────────────────────────

async function askGroq(messages) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'openai/gpt-oss-120b', messages })
  });
  const data = await r.json();
  return data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || JSON.stringify(data);
}

async function askGemini(messages, imageParts = []) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set on the server.');
  const contents = messages.map((m, i) => {
    const isLastUser = i === messages.length - 1 && m.role === 'user';
    const parts = [];
    if (isLastUser && imageParts.length > 0) {
      parts.push(...imageParts);
    }
    parts.push({ text: m.content });
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts
    };
  });
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + key;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents })
  });
  const data = await r.json();
  if (data.error) throw new Error('Gemini API error: ' + data.error.message);
  if (!data.candidates || !data.candidates[0]) throw new Error('No candidates in Gemini response: ' + JSON.stringify(data));
  return data.candidates[0].content.parts[0].text;
}

async function askMistral(messages) {
  const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.MISTRAL_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'codestral-latest', messages })
  });
  const data = await r.json();
  return data.choices?.[0]?.message?.content || JSON.stringify(data);
}

async function askWithFallback(messages, imageParts = []) {
  try {
    const result = await askGroq(messages);
    // Groq sometimes returns an error object instead of throwing
    if (typeof result === 'string' && result.includes('"error"')) {
      const parsed = JSON.parse(result);
      if (parsed.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error));
    }
    return { reply: result, modelUsed: 'groq' };
  } catch (err) {
    console.warn('[Mobius] Groq failed, falling back to Gemini:', err.message);
    const result = await askGemini(messages, imageParts);
    return { reply: result, modelUsed: 'gemini - fallback' };
  }
}

async function askWebSearch(messages) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) throw new Error('TAVILY_API_KEY is not set on the server.');
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const query = lastUserMsg ? lastUserMsg.content : '';
  const searchRes = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: tavilyKey, query, max_results: 5, include_answer: false })
  });
  const searchData = await searchRes.json();
  if (searchData.error) throw new Error('Tavily error: ' + searchData.error);
  const context = searchData.results
    .map((r, i) => `[${i+1}] ${r.title}\n${r.content}\nSource: ${r.url}`)
    .join('\n\n');
  const augmentedMessages = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === 'user') {
      return {
        role: 'user',
        content: `Answer the following question using the web search results below. Be concise and cite sources where relevant.\n\nQuestion: ${m.content}\n\nSearch Results:\n${context}`
      };
    }
    return m;
  });
  const { reply, modelUsed } = await askWithFallback(augmentedMessages);
  return { reply, modelUsed };
}

async function saveConversation(userId, question, answer, model, topic) {
  await supabase.from('conversations').insert({ user_id: userId, question, answer, model, topic });
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks'
];

app.get('/auth/google', (req, res) => {
  const userId = req.query.userId;
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_SCOPES,
    prompt: 'consent',
    state: userId
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    await supabase.from('google_tokens').upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date
    }, { onConflict: 'user_id' });
    res.redirect('/?google=connected');
  } catch (err) {
    console.error('Google OAuth error:', err.message);
    res.redirect('/?google=error');
  }
});

app.get('/auth/google/status', async (req, res) => {
  const { userId } = req.query;
  const { data } = await supabase
    .from('google_tokens')
    .select('user_id')
    .eq('user_id', userId)
    .single();
  res.json({ connected: !!data });
});

// ── Chat History ──────────────────────────────────────────────────────────────

app.get('/api/chat-history', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const { data, error } = await supabase
    .from('conversations')
    .select('id, question, answer, model, topic, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  // Group into sessions by 30-min gap
  const sessions = [];
  let current = null;
  const GAP_MS = 30 * 60 * 1000;

  for (const row of data) {
    const t = new Date(row.created_at).getTime();
    if (!current || t - current.lastTime > GAP_MS) {
      current = { title: row.question, started_at: row.created_at, lastTime: t, messages: [] };
      sessions.push(current);
    }
    current.lastTime = t;
    current.messages.push({ id: row.id, question: row.question, answer: row.answer, model: row.model, created_at: row.created_at });
  }

  // Return newest first
  sessions.reverse();
  res.json({ sessions });
});

// ── Parser ────────────────────────────────────────────────────────────────────

function buildMobiusQuery(text, model, history, context) {
  return {
    ASK: model,
    INSTRUCTIONS: history || [],
    QUERY: text,
    FILES: [],
    CONTEXT: context || ''
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.post('/parse', (req, res) => {
  const { text, model, history, context } = req.body;
  const mobius_query = buildMobiusQuery(text, model, history, context);

  const explicitModels = ['groq', 'gemini', 'mistral', 'codestral', 'websearch', 'chat_history', 'google_drive', 'google_tasks', 'google_calendar', 'google_gmail'];
  if (!model || !explicitModels.includes(model.toLowerCase())) {
    const lower = text.toLowerCase();
    if (lower.includes('chat history') || lower.includes('conversation history')) {
      mobius_query.ASK = 'chat_history';
    } else if (lower.includes('drive') || lower.includes('my files') || lower.includes('google drive')) {
      mobius_query.ASK = 'google_drive';
    } else if (lower.includes('task') || lower.includes('todo') || lower.includes('to-do')) {
      mobius_query.ASK = 'google_tasks';
    } else if (lower.includes('calendar') || lower.includes('schedule') || lower.includes('events')) {
      mobius_query.ASK = 'google_calendar';
    } else if (lower.includes('email') || lower.includes('gmail') || lower.includes('inbox')) {
      mobius_query.ASK = 'google_gmail';
    }
  }

  res.json({ mobius_query });
});

// File upload endpoint — returns base64 + mime for client to attach to query
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const base64 = req.file.buffer.toString('base64');
  res.json({
    name: req.file.originalname,
    mimeType: req.file.mimetype,
    base64,
    size: req.file.size
  });
});

app.post('/ask', async (req, res) => {
  const { mobius_query, userId, topic } = req.body;
  const { ASK, INSTRUCTIONS, QUERY, FILES, CONTEXT } = mobius_query;

  try {
    const messages = [...INSTRUCTIONS, { role: 'user', content: QUERY }];
    if (CONTEXT) messages.unshift({ role: 'system', content: CONTEXT });
    let reply;
    let modelUsed = ASK;

    // Build image parts from FILES if any
    const imageParts = (FILES || [])
      .filter(f => f.mimeType && f.mimeType.startsWith('image/'))
      .map(f => ({ inline_data: { mime_type: f.mimeType, data: f.base64 } }));

    const hasImages = imageParts.length > 0;
    const hasNonImageFiles = (FILES || []).some(f => f.mimeType && !f.mimeType.startsWith('image/'));

    if (ASK === 'chat_history') {
      // Return marker — client handles rendering
      reply = '__CHAT_HISTORY__';
      modelUsed = 'system';
    } else if (ASK === 'google_drive') {
      reply = await getDriveFiles(userId, QUERY);
    } else if (ASK === 'google_tasks') {
      reply = await getTasks(userId);
    } else if (ASK === 'google_calendar') {
      reply = await getCalendarEvents(userId);
    } else if (ASK === 'google_gmail') {
      reply = await getEmails(userId);
    } else if (ASK === 'gemini' || hasImages) {
      // Route to Gemini if explicitly chosen or if images attached
      reply = await askGemini(messages, imageParts);
      modelUsed = 'gemini';
    } else if (ASK === 'mistral' || ASK === 'codestral') {
      reply = await askMistral(messages);
      modelUsed = 'mistral';
    } else if (ASK === 'websearch') {
      // Append non-image file text to query if present
      if (hasNonImageFiles) {
        const fileTexts = (FILES || [])
          .filter(f => !f.mimeType.startsWith('image/'))
          .map(f => `[File: ${f.name}]\n${Buffer.from(f.base64, 'base64').toString('utf8')}`)
          .join('\n\n');
        messages[messages.length - 1].content += '\n\n' + fileTexts;
      }
      const { reply: wsReply, modelUsed: wsModel } = await askWebSearch(messages);
      reply = wsReply;
      modelUsed = wsModel;
    } else {
      if (hasNonImageFiles) {
        const fileTexts = (FILES || [])
          .filter(f => !f.mimeType.startsWith('image/'))
          .map(f => `[File: ${f.name}]\n${Buffer.from(f.base64, 'base64').toString('utf8')}`)
          .join('\n\n');
        messages[messages.length - 1].content += '\n\n' + fileTexts;
      }
      const { reply: fallbackReply, modelUsed: fallbackModel } = await askWithFallback(messages);
      reply = fallbackReply;
      modelUsed = fallbackModel;
    }

    if (userId && reply !== '__CHAT_HISTORY__') {
      await saveConversation(userId, QUERY, reply, modelUsed, topic || 'general');
    }
    res.json({ reply, modelUsed });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const { data } = await supabase
    .from('users')
    .select('id, username')
    .eq('username', username)
    .eq('password', password)
    .single();
  if (data) {
    res.json({ userId: data.id, username: data.username });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/help', (req, res) => {
  res.sendFile('index.html', { root: './help' });
});
app.use('/help', express.static('./help'));

app.get('/login', (req, res) => {
  res.sendFile('login.html', { root: '.' });
});

app.listen(PORT, () => console.log('Server on ' + PORT));
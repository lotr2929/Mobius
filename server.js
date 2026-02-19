import express from 'express';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

// ── AI functions ─────────────────────────────────────────────────────────────

async function askGroq(messages) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages })
  });
  const data = await r.json();
  return data.choices[0].message.content;
}

async function askGemini(messages) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set on the server.');
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + key;
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
  return await askGroq(augmentedMessages);
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

async function getGoogleClient(userId) {
  const { data } = await supabase
    .from('google_tokens')
    .select('access_token, refresh_token, expiry_date')
    .eq('user_id', userId)
    .single();
  if (!data) throw new Error('Google not connected for this user.');
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: data.expiry_date
  });
  return client;
}

async function getDriveFiles(userId, query) {
  const client = await getGoogleClient(userId);
  const drive = google.drive({ version: 'v3', auth: client });
  const response = await drive.files.list({
    pageSize: 10,
    fields: 'files(id, name, mimeType, modifiedTime)',
    orderBy: 'modifiedTime desc'
  });
  const files = response.data.files;
  if (!files.length) return 'No files found in Google Drive.';
  return 'Recent Google Drive files:\n' + files.map((f, i) =>
    `${i+1}. ${f.name} (${f.mimeType.split('.').pop()}, modified ${new Date(f.modifiedTime).toLocaleDateString()})`
  ).join('\n');
}
// ── Parser ────────────────────────────────────────────────────────────────────

function buildMobiusQuery(text, model, history) {
  return {
    ASK: model,
    INSTRUCTIONS: history || [],
    QUERY: text,
    FILES: []
  };
}

app.post('/parse', (req, res) => {
  const { text, model, history } = req.body;
  const mobius_query = buildMobiusQuery(text, model, history);

  // Detect Google service intent
  const lower = text.toLowerCase();
  if (lower.includes('drive') || lower.includes('my files') || lower.includes('google drive')) {
    mobius_query.ASK = 'google_drive';
  }

  res.json({ mobius_query });
});

// Step 2: Execute — receive mobius_query and send to AI
app.post('/ask', async (req, res) => {
  const { mobius_query, userId, topic } = req.body;
  const { ASK, INSTRUCTIONS, QUERY, FILES } = mobius_query;

  try {
    const messages = [
      ...INSTRUCTIONS,
      { role: 'user', content: QUERY }
    ];

    let reply;
    let modelUsed = ASK;

    if (ASK === 'google_drive') {
      reply = await getDriveFiles(userId, QUERY);
      modelUsed = 'google_drive';
    } else if (ASK === 'gemini') {
      reply = await askGemini(messages);
    } else if (ASK === 'websearch') {
      reply = await askWebSearch(messages);
      modelUsed = 'groq';
    } else {
      reply = await askGroq(messages);
    }

    if (userId) await saveConversation(userId, QUERY, reply, modelUsed, topic || 'general');
    res.json({ reply, modelUsed });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Login route
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

app.get('/login', (req, res) => {
  res.sendFile('login.html', { root: '.' });
});

app.listen(PORT, () => console.log('Server on ' + PORT));
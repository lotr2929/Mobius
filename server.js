import express from 'express';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

async function askGroq(text) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: text }]
    })
  });
  const data = await r.json();
  return data.choices[0].message.content;
}

async function askGemini(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set on the server.');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + key;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }]
    })
  });
  const data = await r.json();
  if (data.error) throw new Error('Gemini API error: ' + data.error.message);
  if (!data.candidates || !data.candidates[0]) throw new Error('No candidates in Gemini response: ' + JSON.stringify(data));
  return data.candidates[0].content.parts[0].text;
}

async function askWebSearch(text) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) throw new Error('TAVILY_API_KEY is not set on the server.');

  // Step 1: Search the web with Tavily
  const searchRes = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: tavilyKey,
      query: text,
      max_results: 5,
      include_answer: false
    })
  });
  const searchData = await searchRes.json();
  if (searchData.error) throw new Error('Tavily error: ' + searchData.error);

  // Step 2: Build context from search results
  const context = searchData.results
    .map((r, i) => `[${i+1}] ${r.title}\n${r.content}\nSource: ${r.url}`)
    .join('\n\n');

  const prompt = `Answer the following question using the web search results below. Be concise and cite sources where relevant.\n\nQuestion: ${text}\n\nSearch Results:\n${context}`;

  // Step 3: Send to Groq for a proper answer
  return await askGroq(prompt);
}

async function saveConversation(userId, question, answer, model, topic) {
  await supabase.from('conversations').insert({
    user_id: userId,
    question,
    answer,
    model,
    topic
  });
}

async function getMemory(userId, topic) {
  const { data } = await supabase
    .from('conversations')
    .select('question, answer')
    .eq('user_id', userId)
    .eq('topic', topic)
    .order('created_at', { ascending: false })
    .limit(5);
  return data || [];
}

app.post('/ask', async (req, res) => {
  const { text, model, userId, topic } = req.body;
  try {
    let reply;
    if (model === 'gemini') {
      reply = await askGemini(text);
    } else if (model === 'websearch') {
      reply = await askWebSearch(text);
    } else {
      reply = await askGroq(text);
    }
    if (userId) await saveConversation(userId, text, reply, model, topic || 'general');
    res.json({ reply });
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

// Serve login page
app.get('/login', (req, res) => {
  res.sendFile('login.html', { root: '.' });
});

app.listen(PORT, () => console.log('Server on ' + PORT));
import express from 'express';
import fetch from 'node-fetch';

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
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }]
    })
  });
  const data = await r.json();
  return data.candidates[0].content.parts[0].text;
}

app.post('/ask', async (req, res) => {
  const { text, model } = req.body;
  try {
    let reply;
    if (model === 'gemini') {
      reply = await askGemini(text);
    } else {
      reply = await askGroq(text);
    }
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log('Server on ' + PORT));
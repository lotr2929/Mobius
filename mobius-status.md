# Mobius Project Status
Last updated: February 18, 2026

## What Mobius Is
A web-based AI chat app deployed on Render (https://mobius-8e5m.onrender.com).
PWA-capable. Built with Node.js/Express on the backend.

## Models Available
- Groq - Llama 3.3 70B (free)
- Gemini - 2.5 Flash Lite (free)
- Web Search - Tavily + Groq (free)

## Environment Variables on Render
- GROQ_API_KEY
- GEMINI_API_KEY
- TAVILY_API_KEY
- SUPABASE_URL = https://dlbstuzzfmjawffzhdys.supabase.co
- SUPABASE_KEY = publishable key (set in Render)

## Database (Supabase)
Three tables:
- users (id, username, password, created_at)
- conversations (id, user_id, question, answer, model, topic, created_at)
- memories (id, user_id, fact, created_at) — created, not yet used

## What's Working
- Login page (login.html) with username/password
- User: Boon shown in header after login
- Conversations saving to Supabase correctly (confirmed 6 records)
- All three models responding correctly
- deploy.bat auto-updates cache timestamp before deploying
- backup.bat creates Mobius-backup.zip with backup-timestamp.txt

## What's NOT Working Yet
- Memory retrieval — getMemory() exists in server.js but not yet
  wired into the /ask route correctly. Mobius answers without 
  any context from past conversations.
- Auto-summarisation — planned but not built yet
- Admin page — planned but not built yet

## Next Steps (in order)
1. Fix memory retrieval — wire getMemory() into /ask route in server.js
2. Build auto-summarisation — /summarise endpoint that uses Groq to 
   extract key facts from conversations into the memories table
3. Build admin page — view/edit/delete conversations and memories,
   run summarisation, export/backup database
4. SQL cleanup queries — as fallback option

## Files in Mobius_Web folder
- index.html — main chat UI
- login.html — login page
- server.js — Express backend with Groq, Gemini, Tavily, Supabase
- manifest.json — PWA config (theme_color: #8d7c64)
- service-worker.js — PWA caching (currently gemini-2.5-flash-lite)
- package.json — includes @supabase/supabase-js, express, node-fetch
- deploy.bat — auto-deploys to GitHub/Render with cache timestamp
- backup.bat — creates Mobius-backup.zip, overwrites each time
- backup-timestamp.txt — records when last backup was run
- mobius-logo.png, favicon.ico — assets

## Known Issue to Fix in server.js
The /ask route needs this update to inject memory into the prompt:
Replace the existing app.post('/ask') block with the version that
calls getMemory() and prepends context to the prompt before sending
to the AI model. This was written but may not have been deployed yet.

VS Code identified 2 problems in server.js:
'try' expected. ts(1005) [Ln 121, Col 5]
'catch' or 'finally' expected. ts(1472) [Ln 125, Col 2]

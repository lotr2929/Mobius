Here's a summary of each file:

- **server.js** — Express backend that handles API calls to Groq (Llama 3.3 70B), Gemini, and manages chat history via Supabase.
- **index.html** — Main chat UI where users interact with the AI, select models, and view conversation history.
- **login.html** — Login/authentication page for user sign-in before accessing the main chat.
- **service-worker.js** — PWA service worker that caches core assets for offline support and handles cache versioning.
- **manifest.json** — PWA manifest defining the app name, icons, colors, and display mode for installability.
- **package.json** — Node.js project config declaring dependencies (Express, node-fetch, Supabase) and the start script.
- **package-lock.json** — Auto-generated lockfile pinning exact dependency versions.
- **favicon.ico / mobius-logo.png** — App icons used in the browser tab and PWA manifest.
- **backup.bat** — Windows batch script to create a timestamped backup of the project.
- **deploy.bat** — Windows batch script to automate deployment to Render.
- **backup-timestamp.txt** — Records the date/time of the last backup run.
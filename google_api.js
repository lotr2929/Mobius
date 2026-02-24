import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function getGoogleClient(userId) {
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

// ── Drive ─────────────────────────────────────────────────────────────────────

export async function getDriveFiles(userId, query) {
  const client = await getGoogleClient(userId);
  const drive = google.drive({ version: 'v3', auth: client });

  const foldersRes = await drive.files.list({
    q: "'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id, name)',
    orderBy: 'name'
  });

  const filesRes = await drive.files.list({
    q: "'root' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id, name, mimeType)',
    orderBy: 'name'
  });

  const folders = foldersRes.data.files || [];
  const files = filesRes.data.files || [];

  let result = 'Google Drive - My Drive:\n\nFolders:\n';
  result += folders.length ? folders.map(f => `  📁 ${f.name}`).join('\n') : '  (none)';
  result += '\n\nFiles:\n';
  result += files.length ? files.map(f => `  📄 ${f.name}`).join('\n') : '  (none)';

  return result;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function getTasks(userId) {
  const client = await getGoogleClient(userId);
  const tasks = google.tasks({ version: 'v1', auth: client });
  const lists = await tasks.tasklists.list();
  if (!lists.data.items || !lists.data.items.length) return 'No task lists found.';

  let result = '';
  for (const list of lists.data.items) {
    const taskItems = await tasks.tasks.list({ tasklist: list.id, showCompleted: false });
    const items = taskItems.data.items || [];
    if (items.length) {
      result += `\n${list.title}:\n` + items.map((t, i) => `  ${i+1}. ${t.title}`).join('\n');
    }
  }
  return result || 'No pending tasks found.';
}

// ── Calendar ──────────────────────────────────────────────────────────────────

export async function getCalendarEvents(userId) {
  const client = await getGoogleClient(userId);
  const calendar = google.calendar({ version: 'v3', auth: client });
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: weekAhead.toISOString(),
    singleEvents: true,
    orderBy: 'startTime'
  });

  const events = res.data.items || [];
  if (!events.length) return 'No upcoming events in the next 7 days.';

  return 'Upcoming events (next 7 days):\n' + events.map((e, i) => {
    const start = e.start.dateTime || e.start.date;
    return `  ${i+1}. ${e.summary} — ${new Date(start).toLocaleString()}`;
  }).join('\n');
}

// ── Gmail ─────────────────────────────────────────────────────────────────────

export async function getEmails(userId) {
  const client = await getGoogleClient(userId);
  const gmail = google.gmail({ version: 'v1', auth: client });

  const res = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 10,
    q: 'is:unread'
  });

  const messages = res.data.messages || [];
  if (!messages.length) return 'No unread emails.';

  const details = await Promise.all(messages.map(m =>
    gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject', 'From'] })
  ));

  return 'Unread emails:\n' + details.map((d, i) => {
    const headers = d.data.payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
    const from = headers.find(h => h.name === 'From')?.value || '(unknown)';
    return `  ${i+1}. ${subject}\n     From: ${from}`;
  }).join('\n');
}

// ── Google Account Info ───────────────────────────────────────────────────────

export async function getGoogleAccountInfo(userId) {
  const client = await getGoogleClient(userId);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const res = await oauth2.userinfo.get();
  return {
    email:   res.data.email   || 'unknown',
    name:    res.data.name    || 'unknown',
    picture: res.data.picture || null
  };
}
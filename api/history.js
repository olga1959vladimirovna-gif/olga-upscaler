import { put, list } from '@vercel/blob';

const HISTORY_PATH = 'history.json';
const MAX_ENTRIES = 30;
const MAX_AGE_DAYS = 30;

async function readHistory() {
  const { blobs } = await list({ prefix: HISTORY_PATH, limit: 1 });
  const match = blobs.find((b) => b.pathname === HISTORY_PATH);
  if (!match) return [];
  const r = await fetch(match.url, { cache: 'no-store' });
  if (!r.ok) return [];
  try {
    return await r.json();
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const history = await readHistory();
      return res.status(200).json(history);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    const entry = req.body || {};
    if (!entry.type || !entry.beforeUrl || !entry.afterUrl) {
      return res.status(400).json({ error: 'Нужны type, beforeUrl, afterUrl' });
    }

    try {
      const history = await readHistory();
      const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      const record = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        createdAt: new Date().toISOString(),
        type: entry.type,
        params: entry.params || {},
        beforeUrl: entry.beforeUrl,
        afterUrl: entry.afterUrl,
      };
      const updated = [record, ...history]
        .filter((e) => new Date(e.createdAt).getTime() > cutoff)
        .slice(0, MAX_ENTRIES);

      await put(HISTORY_PATH, JSON.stringify(updated), {
        access: 'public',
        contentType: 'application/json',
        allowOverwrite: true,
      });

      return res.status(200).json(record);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

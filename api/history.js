import { put, list, del } from '@vercel/blob';

const PREFIX = 'history/';
const MAX_ENTRIES = 30;
const MAX_AGE_DAYS = 30;

async function readAllEntries() {
  const { blobs } = await list({ prefix: PREFIX });
  const entries = await Promise.all(
    blobs.map(async (b) => {
      try {
        const r = await fetch(b.url, { cache: 'no-store' });
        if (!r.ok) return null;
        const data = await r.json();
        return { ...data, _blobUrl: b.url };
      } catch {
        return null;
      }
    })
  );
  return entries.filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const all = await readAllEntries();
      const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      const fresh = all.filter((e) => new Date(e.createdAt).getTime() > cutoff);
      const keep = fresh.slice(0, MAX_ENTRIES);
      const stale = all.filter((e) => !keep.includes(e));

      if (stale.length) {
        del(stale.map((e) => e._blobUrl)).catch(() => {});
      }

      return res.status(200).json(keep.map(({ _blobUrl, ...rest }) => rest));
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
      const record = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        createdAt: new Date().toISOString(),
        type: entry.type,
        params: entry.params || {},
        beforeUrl: entry.beforeUrl,
        afterUrl: entry.afterUrl,
      };

      await put(PREFIX + record.id + '.json', JSON.stringify(record), {
        access: 'public',
        contentType: 'application/json',
      });

      return res.status(200).json(record);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

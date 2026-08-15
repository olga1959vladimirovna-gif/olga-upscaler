export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const VERSIONS = {
  photo: 'dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e',
  video: 'dcd4cb012e2b7651c3112dc8b1905bc155bcbd3d49d69436477b3dbd021a9dea',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'REPLICATE_API_TOKEN не настроен на сервере' });

  const { type, file, videoUrl } = req.body || {};
  if (!type || !VERSIONS[type]) return res.status(400).json({ error: 'Неизвестный тип: ' + type });

  try {
    let input;
    if (type === 'photo') {
      if (!file) return res.status(400).json({ error: 'Нужен file' });
      input = { image: file, scale_factor: 2 };
    } else {
      if (!videoUrl) return res.status(400).json({ error: 'Нужен videoUrl' });
      input = { video_url: videoUrl, target_resolution: '4k', target_fps: '30fps' };
    }

    const r = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version: VERSIONS[type], input }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.detail || 'Ошибка Replicate' });

    return res.status(200).json({ id: data.id, status: data.status });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const MODELS = {
  photo: 'philz1337x/clarity-upscaler',
  video: 'bytedance/video-upscaler',
};

async function uploadToReplicate(token, dataUri) {
  const match = dataUri.match(/^data:(.+);base64,(.*)$/);
  if (!match) throw new Error('Некорректный формат файла');
  const [, mime, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  const form = new FormData();
  form.append('content', new Blob([buffer], { type: mime }), 'upload');
  const res = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Не удалось загрузить файл в Replicate');
  return data.urls.get;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'REPLICATE_API_TOKEN не настроен на сервере' });

  const { type, file } = req.body || {};
  if (!type || !file) return res.status(400).json({ error: 'Нужны type и file' });
  if (!MODELS[type]) return res.status(400).json({ error: 'Неизвестный тип: ' + type });

  try {
    let input;
    if (type === 'photo') {
      input = { image: file, scale_factor: 2 };
    } else {
      const videoUrl = await uploadToReplicate(token, file);
      input = { video_url: videoUrl, target_resolution: '4k', target_fps: '30fps' };
    }

    const r = await fetch(`https://api.replicate.com/v1/models/${MODELS[type]}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.detail || 'Ошибка Replicate' });

    return res.status(200).json({ id: data.id, status: data.status });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

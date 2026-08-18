import { execFile } from 'child_process';
import { promisify } from 'util';
import ffprobeStatic from 'ffprobe-static';

const VERSIONS = {
  photo: 'dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e',
  video: 'dcd4cb012e2b7651c3112dc8b1905bc155bcbd3d49d69436477b3dbd021a9dea',
};

const execFileAsync = promisify(execFile);
const ADOBE_FPS_OPTIONS = [24, 30, 60];

async function probeSourceFps(url) {
  const { stdout } = await execFileAsync(ffprobeStatic.path, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate',
    '-of', 'csv=s=x:p=0',
    url,
  ]);
  const [num, den] = stdout.trim().split('/').map(Number);
  if (!num || !den) return 30;
  return num / den;
}

function nearestAdobeFps(sourceFps) {
  return ADOBE_FPS_OPTIONS.reduce((best, v) =>
    Math.abs(v - sourceFps) < Math.abs(best - sourceFps) ? v : best, ADOBE_FPS_OPTIONS[0]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'REPLICATE_API_TOKEN не настроен на сервере' });

  const { type, fileUrl } = req.body || {};
  if (!type || !VERSIONS[type]) return res.status(400).json({ error: 'Неизвестный тип: ' + type });
  if (!fileUrl) return res.status(400).json({ error: 'Нужен fileUrl' });

  let params;
  if (type === 'photo') {
    params = { scale_factor: 2 };
  } else {
    let targetFps = 30;
    try {
      const sourceFps = await probeSourceFps(fileUrl);
      targetFps = nearestAdobeFps(sourceFps);
    } catch (e) {
      console.error('fps probe failed', e.message);
    }
    params = { target_resolution: '4k', target_fps: targetFps, scene: 'common' };
  }

  const input = type === 'photo'
    ? { image: fileUrl, ...params }
    : { video: fileUrl, ...params };

  try {
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

    return res.status(200).json({ id: data.id, status: data.status, params });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

import { put } from '@vercel/blob';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

export const maxDuration = 60;

const execFileAsync = promisify(execFile);
const ffprobePath = ffprobeStatic.path;

const RATIOS = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
};

function cropFilter(width, height, targetRatio) {
  const sourceRatio = width / height;
  let w = width;
  let h = height;
  if (sourceRatio > targetRatio) {
    w = Math.round(height * targetRatio);
    if (w % 2 !== 0) w -= 1;
  } else {
    h = Math.round(width / targetRatio);
    if (h % 2 !== 0) h -= 1;
  }
  const x = Math.floor((width - w) / 2);
  const y = Math.floor((height - h) / 2);
  return `crop=${w}:${h}:${x}:${y}`;
}

async function probeSize(filePath) {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    filePath,
  ]);
  const [width, height] = stdout.trim().split('x').map(Number);
  return { width, height };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, ratio, type } = req.body || {};
  if (!url || !ratio || !type) return res.status(400).json({ error: 'Нужны url, ratio, type' });
  if (!RATIOS[ratio]) return res.status(400).json({ error: 'Неизвестное соотношение: ' + ratio });

  let dir;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'aspect-'));
    const ext = type === 'photo' ? '.png' : '.mp4';
    const inputPath = path.join(dir, 'input' + ext);
    const outputPath = path.join(dir, 'output' + ext);

    const sourceRes = await fetch(url);
    if (!sourceRes.ok) throw new Error('Не удалось скачать исходный файл');
    const buf = Buffer.from(await sourceRes.arrayBuffer());
    await writeFile(inputPath, buf);

    const { width, height } = await probeSize(inputPath);
    const filter = cropFilter(width, height, RATIOS[ratio]);

    const args = type === 'photo'
      ? ['-y', '-i', inputPath, '-vf', filter, outputPath]
      : ['-y', '-i', inputPath, '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'copy', outputPath];

    await execFileAsync(ffmpegPath, args);

    const outBuf = await readFile(outputPath);
    const contentType = type === 'photo' ? 'image/png' : 'video/mp4';
    const blob = await put('aspect-' + Date.now() + ext, outBuf, {
      access: 'public',
      contentType,
      addRandomSuffix: true,
    });

    return res.status(200).json({ url: blob.url, width, height, filter });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

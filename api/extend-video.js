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

async function probeVideo(filePath) {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type:format=duration',
    '-of', 'json',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const hasAudio = data.streams.some((s) => s.codec_type === 'audio');
  return { duration: parseFloat(data.format?.duration || '0'), hasAudio };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, targetDuration, method } = req.body || {};
  if (!url || !targetDuration) return res.status(400).json({ error: 'Нужны url, targetDuration' });
  const target = Number(targetDuration);
  if (!target || target <= 0) return res.status(400).json({ error: 'Некорректная длительность' });
  const useMethod = method === 'slow' ? 'slow' : 'freeze';

  let dir;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'extend-'));
    const inputPath = path.join(dir, 'input.mp4');
    const outputPath = path.join(dir, 'output.mp4');

    const sourceRes = await fetch(url);
    if (!sourceRes.ok) throw new Error('Не удалось скачать исходный файл');
    await writeFile(inputPath, Buffer.from(await sourceRes.arrayBuffer()));

    const info = await probeVideo(inputPath);

    if (info.duration >= target) {
      return res.status(200).json({
        url,
        duration: info.duration,
        method: 'none',
        warning: `Видео уже ${info.duration.toFixed(1)} сек — длиннее или равно цели (${target} сек), ничего не меняла`,
      });
    }

    let args;
    if (useMethod === 'freeze') {
      const extra = target - info.duration;
      const videoFilter = `tpad=stop_mode=clone:stop_duration=${extra.toFixed(3)}`;
      args = info.hasAudio
        ? ['-y', '-i', inputPath, '-vf', videoFilter, '-af', `apad=pad_dur=${extra.toFixed(3)}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', outputPath]
        : ['-y', '-i', inputPath, '-vf', videoFilter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-an', outputPath];
    } else {
      const factor = target / info.duration;
      const videoFilter = `setpts=PTS*${factor.toFixed(6)}`;
      if (info.hasAudio) {
        const atempo = Math.min(2, Math.max(0.5, 1 / factor));
        args = ['-y', '-i', inputPath, '-vf', videoFilter, '-af', `atempo=${atempo.toFixed(6)}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', outputPath];
      } else {
        args = ['-y', '-i', inputPath, '-vf', videoFilter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-an', outputPath];
      }
    }

    await execFileAsync(ffmpegPath, args);

    const outBuf = await readFile(outputPath);
    const blob = await put('extend-' + Date.now() + '.mp4', outBuf, {
      access: 'public', contentType: 'video/mp4', addRandomSuffix: true,
    });

    return res.status(200).json({ url: blob.url, duration: target, method: useMethod, warning: null });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

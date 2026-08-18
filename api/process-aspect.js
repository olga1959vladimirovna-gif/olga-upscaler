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

const MIN_SIDE = { photo: 2000, video: 1920 };
const SILENCE_COVERAGE_THRESHOLD = 0.95;

function cropPlan(width, height, targetRatio) {
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
  return { width: w, height: h, filter: `crop=${w}:${h}:${x}:${y}` };
}

function padPlan(width, height, targetRatio) {
  const sourceRatio = width / height;
  let canvasW = width;
  let canvasH = height;
  if (sourceRatio > targetRatio) {
    canvasH = Math.round(width / targetRatio);
    if (canvasH % 2 !== 0) canvasH += 1;
  } else if (sourceRatio < targetRatio) {
    canvasW = Math.round(height * targetRatio);
    if (canvasW % 2 !== 0) canvasW += 1;
  }
  const filter =
    `[0:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=decrease[fg];` +
    `[0:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},gblur=sigma=20[bg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2`;
  return { width: canvasW, height: canvasH, filter };
}

async function probeVideo(filePath) {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height:format=duration',
    '-of', 'json',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const videoStream = data.streams.find((s) => s.codec_type === 'video');
  const audioStream = data.streams.find((s) => s.codec_type === 'audio');
  return {
    width: videoStream?.width,
    height: videoStream?.height,
    duration: parseFloat(data.format?.duration || '0'),
    hasAudio: Boolean(audioStream),
  };
}

async function silenceCoverage(filePath, duration) {
  if (!duration) return 0;
  const { stderr } = await execFileAsync(ffmpegPath, [
    '-i', filePath,
    '-af', 'silencedetect=n=-40dB:d=0.3',
    '-vn', '-f', 'null', '-',
  ]).catch((e) => ({ stderr: e.stderr || '' }));
  const matches = [...stderr.matchAll(/silence_duration:\s*([\d.]+)/g)];
  const silentTotal = matches.reduce((sum, m) => sum + parseFloat(m[1]), 0);
  return silentTotal / duration;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, ratio, type, mode } = req.body || {};
  if (!url || !type) return res.status(400).json({ error: 'Нужны url, type' });
  if (ratio && !RATIOS[ratio]) return res.status(400).json({ error: 'Неизвестное соотношение: ' + ratio });
  const useMode = mode === 'pad' ? 'pad' : 'crop';

  let dir;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'aspect-'));
    const sourceExt = type === 'photo' ? '.png' : '.mp4';
    const inputPath = path.join(dir, 'input' + sourceExt);

    const sourceRes = await fetch(url);
    if (!sourceRes.ok) throw new Error('Не удалось скачать исходный файл');
    const buf = Buffer.from(await sourceRes.arrayBuffer());
    await writeFile(inputPath, buf);

    if (type === 'photo') {
      const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', inputPath,
      ]);
      const [width, height] = stdout.trim().split('x').map(Number);
      const plan = ratio
        ? (useMode === 'pad' ? padPlan(width, height, RATIOS[ratio]) : cropPlan(width, height, RATIOS[ratio]))
        : { width, height, filter: null };

      const outputPath = path.join(dir, 'output.png');
      const args = plan.filter
        ? ['-y', '-i', inputPath, plan.filter.includes('[') ? '-filter_complex' : '-vf', plan.filter, outputPath]
        : ['-y', '-i', inputPath, outputPath];
      await execFileAsync(ffmpegPath, args);

      const outBuf = await readFile(outputPath);
      const blob = await put('aspect-' + Date.now() + '.png', outBuf, {
        access: 'public', contentType: 'image/png', addRandomSuffix: true,
      });

      const minSide = Math.min(plan.width, plan.height);
      const warning = minSide < MIN_SIDE.photo
        ? `Итоговое разрешение ${plan.width}×${plan.height} — меньшая сторона (${minSide}px) ниже обычного минимума (${MIN_SIDE.photo}px) для стоков`
        : null;

      return res.status(200).json({ url: blob.url, width: plan.width, height: plan.height, mode: ratio ? useMode : null, warning });
    }

    // video
    const info = await probeVideo(inputPath);
    const plan = ratio
      ? (useMode === 'pad' ? padPlan(info.width, info.height, RATIOS[ratio]) : cropPlan(info.width, info.height, RATIOS[ratio]))
      : { width: info.width, height: info.height, filter: null };

    let audioAction = 'none';
    if (info.hasAudio) {
      const coverage = await silenceCoverage(inputPath, info.duration);
      audioAction = coverage >= SILENCE_COVERAGE_THRESHOLD ? 'strip' : 'normalize';
    }

    const outExt = audioAction === 'normalize' ? '.mov' : '.mp4';
    const outputPath = path.join(dir, 'output' + outExt);

    const videoArgs = plan.filter
      ? [(plan.filter.includes('[') ? '-filter_complex' : '-vf'), plan.filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18']
      : ['-c:v', 'copy'];

    let audioArgs;
    if (audioAction === 'strip') audioArgs = ['-an'];
    else if (audioAction === 'normalize') audioArgs = ['-c:a', 'pcm_s16le', '-ar', '48000'];
    else audioArgs = [];

    const args = ['-y', '-i', inputPath, ...videoArgs, ...audioArgs, outputPath];
    await execFileAsync(ffmpegPath, args);

    const outBuf = await readFile(outputPath);
    const contentType = outExt === '.mov' ? 'video/quicktime' : 'video/mp4';
    const blob = await put('aspect-' + Date.now() + outExt, outBuf, {
      access: 'public', contentType, addRandomSuffix: true,
    });

    const minSide = Math.min(plan.width, plan.height);
    const warning = minSide < MIN_SIDE.video
      ? `Итоговое разрешение ${plan.width}×${plan.height} — меньшая сторона (${minSide}px) ниже обычного минимума (${MIN_SIDE.video}px) для стоков`
      : null;

    return res.status(200).json({
      url: blob.url,
      width: plan.width,
      height: plan.height,
      mode: ratio ? useMode : null,
      audioAction,
      warning,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

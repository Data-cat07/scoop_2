import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {existsSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

const root = path.resolve('.');
const video = path.join(root, '새로운_보드_-P5aou1mc90giFMXDfIR_Dropshot.mp4');
const output = path.join(root, 'artifacts', 'model', 'comparison');
const times = [0, 0.9, 1.8, 2.7, 3.6, 4.5, 5.4, 6.3];
await fs.mkdir(output, {recursive: true});

const edgeCandidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const browser = edgeCandidates.find((candidate) => {
  return existsSync(candidate);
});
if (!browser) throw new Error('Microsoft Edge or Google Chrome is required to render the model comparison images.');

const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
  windowsHide: true,
});
const baseUrl = 'http://127.0.0.1:5173/dropshot-preview.html';
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('The standalone preview server did not start.');

  const tempProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'dropshot-edge-'));
  const framePaths = [];
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    const sourcePath = path.join(output, `source-${String(index).padStart(2, '0')}.png`);
    const modelPath = path.join(output, `model-${String(index).padStart(2, '0')}.png`);
    const comparisonPath = path.join(output, `comparison-${String(index).padStart(2, '0')}.png`);
    await fs.rm(modelPath, {force: true});

    const sourceResult = spawnSync(ffmpeg, [
      '-y', '-ss', String(time), '-i', video, '-frames:v', '1',
      '-vf', 'scale=640:640:force_original_aspect_ratio=decrease,pad=640:640:(ow-iw)/2:(oh-ih)/2:color=#0f172a',
      sourcePath,
    ], {encoding: 'utf8'});
    if (sourceResult.status !== 0) throw new Error(sourceResult.stderr);

    const url = `${baseUrl}?capture=1&time=${time.toFixed(3)}`;
    const browserResult = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      '--disable-background-networking', '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=2600', '--window-size=720,720', `--user-data-dir=${tempProfile}`,
      `--screenshot=${modelPath}`, url,
    ], {encoding: 'utf8'});
    if (browserResult.status !== 0 && !existsSync(modelPath)) throw new Error(browserResult.stderr || browserResult.stdout || 'Headless browser capture failed.');
    await fs.access(modelPath);

    const labelSource = Buffer.from(`<svg width="640" height="44"><rect width="640" height="44" fill="#16213b" fill-opacity="0.88"/><text x="18" y="29" font-size="21" fill="white">원본 영상 · ${time.toFixed(2)}s</text></svg>`);
    const labelModel = Buffer.from(`<svg width="640" height="44"><rect width="640" height="44" fill="#16213b" fill-opacity="0.88"/><text x="18" y="29" font-size="21" fill="white">새 3D 모델 · ${time.toFixed(2)}s</text></svg>`);
    const sourcePanel = await sharp(sourcePath).resize(640, 640, {fit: 'cover'}).composite([{input: labelSource, top: 0, left: 0}]).png().toBuffer();
    const modelPanel = await sharp(modelPath).resize(640, 640, {fit: 'cover'}).composite([{input: labelModel, top: 0, left: 0}]).png().toBuffer();
    await sharp({create: {width: 1280, height: 640, channels: 3, background: '#0f172a'}})
      .composite([{input: sourcePanel, left: 0, top: 0}, {input: modelPanel, left: 640, top: 0}])
      .png()
      .toFile(comparisonPath);
    framePaths.push(comparisonPath);
  }

  const tiles = await Promise.all(framePaths.map(async (filePath) => ({
    input: await sharp(filePath).resize(640, 320, {fit: 'cover'}).toBuffer(),
    left: 0,
    top: 0,
  })));
  const contactSheet = path.join(output, 'contact-sheet.png');
  const positioned = tiles.map((tile, index) => ({...tile, left: (index % 2) * 640, top: Math.floor(index / 2) * 320}));
  await sharp({create: {width: 1280, height: 1280, channels: 3, background: '#0f172a'}}).composite(positioned).png().toFile(contactSheet);
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({sourceVideo: path.basename(video), times, frames: framePaths.map((item) => path.basename(item)), contactSheet: 'contact-sheet.png'}, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({contactSheet, frames: framePaths.length, times}, null, 2));
} finally {
  server.kill();
}


import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import type { ImageEditRequest } from '@fluxlibre/shared';
import { getConfig } from '../config.js';

function safeName(name: string): string {
  return basename(name).replace(/[^a-zA-Z0-9._-]/g, '_') || `image-${Date.now()}.webp`;
}

async function loadSource(source: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Téléchargement image échoué : ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  const { readFile } = await import('node:fs/promises');
  return readFile(resolve(source));
}

export async function editImage(input: ImageEditRequest): Promise<{ path: string; url: string }> {
  const outputDir = join(getConfig().dataDir, 'outputs');
  await mkdir(outputDir, { recursive: true });

  const outputName = safeName(
    input.output ?? `${basename(input.source, extname(input.source))}.webp`,
  );
  const outputPath = join(outputDir, outputName);

  let pipeline = sharp(await loadSource(input.source)).rotate();

  for (const operation of input.operations) {
    switch (operation.op) {
      case 'resize':
        pipeline = pipeline.resize({
          width: operation.width,
          height: operation.height,
          fit: operation.fit ?? 'cover',
          withoutEnlargement: false,
        });
        break;
      case 'whiten':
        // Aplatit les pixels quasi blancs sur un fond blanc pur.
        pipeline = pipeline.linear(1.04, -8);
        break;
      case 'strip':
        // Sharp supprime les métadonnées (EXIF inclus) par défaut : rien à faire.
        break;
      case 'format':
        if (operation.format === 'webp') pipeline = pipeline.webp({ quality: operation.quality ?? 88 });
        else if (operation.format === 'jpeg') pipeline = pipeline.jpeg({ quality: operation.quality ?? 88 });
        else pipeline = pipeline.png();
        break;
    }
  }

  if (!input.operations.some((op) => op.op === 'format')) pipeline = pipeline.webp({ quality: 88 });

  const buffer = await pipeline.toBuffer();
  await writeFile(outputPath, buffer);

  return { path: outputPath, url: `/files/${outputName}` };
}

/** Preset rapide : photo produit carrée, webp, métadonnées retirées. */
export async function prepareProductPhoto(source: string): Promise<{ path: string; url: string }> {
  return editImage({
    source,
    operations: [
      { op: 'resize', width: 1200, height: 1200, fit: 'contain' },
      { op: 'format', format: 'webp', quality: 88 },
    ],
  });
}

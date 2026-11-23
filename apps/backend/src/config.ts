import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG, DEFAULT_PORT, type AppConfig } from '@fluxlibre/shared';
import { db } from './db.js';

export interface RuntimeConfig extends AppConfig {
  dbPath: string;
  port: number;
  dataDir: string;
  aiApiKey: string;
}

const dataDir = resolve(process.env.FLUXLIBRE_DATA_DIR ?? resolve(homedir(), '.fluxlibre'));

function readSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function getConfig(): RuntimeConfig {
  const stored = (readSetting('config') ?? '{}') as string;
  let parsed: Partial<AppConfig> = {};
  try {
    parsed = JSON.parse(stored) as Partial<AppConfig>;
  } catch {
    parsed = {};
  }
  const merged = { ...DEFAULT_CONFIG, ...parsed };
  return {
    ...merged,
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    dbPath: process.env.FLUXLIBRE_DB ?? resolve(dataDir, 'fluxlibre.db'),
    dataDir,
    aiApiKey: process.env.FLUXLIBRE_AI_KEY ?? readSetting('aiApiKey') ?? '',
  };
}

export function saveConfig(patch: Partial<AppConfig> & { aiApiKey?: string }): RuntimeConfig {
  const current = getConfig();
  const { aiApiKey, ...rest } = patch;
  const next: AppConfig = {
    backendUrl: rest.backendUrl ?? current.backendUrl,
    aiProvider: rest.aiProvider ?? current.aiProvider,
    aiModel: rest.aiModel ?? current.aiModel,
    aiBaseUrl: rest.aiBaseUrl ?? current.aiBaseUrl,
    autoSubmit: rest.autoSubmit ?? current.autoSubmit,
    renewAfterDays: rest.renewAfterDays ?? current.renewAfterDays,
  };
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    'config',
    JSON.stringify(next),
  );
  if (aiApiKey !== undefined) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'aiApiKey',
      aiApiKey,
    );
  }
  return getConfig();
}

export function publicConfig(config: RuntimeConfig) {
  return {
    backendUrl: config.backendUrl,
    aiProvider: config.aiProvider,
    aiModel: config.aiModel,
    aiBaseUrl: config.aiBaseUrl,
    autoSubmit: config.autoSubmit,
    renewAfterDays: config.renewAfterDays,
    hasApiKey: Boolean(config.aiApiKey),
  };
}

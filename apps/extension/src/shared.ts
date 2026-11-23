import { DEFAULT_CONFIG, type AppConfig, type Job, type JobResult, type Platform } from '@fluxlibre/shared';

export const STORAGE_KEY = 'fluxlibre_config';
export const JOBS_KEY = 'fluxlibre_jobs';

export async function getConfig(): Promise<AppConfig> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return { ...DEFAULT_CONFIG, ...((stored[STORAGE_KEY] as Partial<AppConfig> | undefined) ?? {}) };
}

export async function saveConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const next = { ...(await getConfig()), ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const config = await getConfig();
  const base = config.backendUrl.replace(/\/$/, '');
  const response = await fetch(`${base}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function baseUrl(platform: Platform): string {
  return platform === 'leboncoin' ? 'https://www.leboncoin.fr' : 'https://www.vinted.fr';
}

/** Plateforme déduite de l'URL d'un onglet, ou null si ce n'est ni LBC ni Vinted. */
export function platformFromUrl(url: string | undefined): Platform | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'leboncoin.fr') return 'leboncoin';
    if (host === 'vinted.fr' || host === 'vinted.com') return 'vinted';
  } catch {
    /* ignore */
  }
  return null;
}

/** URL de départ d'une tâche selon son type. */
export function startUrl(job: Job): string {
  const base = baseUrl(job.platform);
  if (job.type === 'enrich' || job.type === 'refresh') {
    const url = job.payload['url'];
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return url;
  }
  if (job.type === 'publish') {
    return job.platform === 'leboncoin'
      ? `${base}/deposer-une-annonce`
      : `${base}/sell`;
  }
  if (job.type === 'sync') {
    return job.platform === 'leboncoin'
      ? `${base}/compte/part/mes-annonces`
      : `${base}/member/announcements`;
  }
  // Le renouvellement Leboncoin se fait depuis la liste « mes annonces »
  // (bouton « Réactiver l'annonce »), pas depuis la page de l'annonce.
  if (
    (job.type === 'renew' || job.type === 'pause' || job.type === 'delete') &&
    job.platform === 'leboncoin'
  ) {
    return `${base}/compte/part/mes-annonces`;
  }
  const url = job.payload['url'];
  if (typeof url === 'string' && url.startsWith(base)) return url;
  return job.platform === 'leboncoin' ? `${base}/mes-annonces` : `${base}/member/announcements`;
}

export interface JobResultMessage {
  type: 'FLUXLIBRE_JOB_RESULT';
  jobId: string;
  result: JobResult;
}

export function isJobResultMessage(message: unknown): message is JobResultMessage {
  return (
    Boolean(message) &&
    typeof message === 'object' &&
    (message as { type?: string }).type === 'FLUXLIBRE_JOB_RESULT' &&
    typeof (message as { jobId?: string }).jobId === 'string'
  );
}

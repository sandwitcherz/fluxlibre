import type { Job } from '@fluxlibre/shared';
import { api, getConfig } from '../shared';

interface SyncRecord {
  at: string;
  data: unknown;
}

function send<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

function line(container: HTMLElement, text: string): void {
  const div = document.createElement('div');
  div.textContent = text;
  container.appendChild(div);
}

async function refresh(): Promise<void> {
  const status = document.getElementById('status')!;
  const dot = document.getElementById('dot')!;
  const lastSync = document.getElementById('lastsync')!;
  const jobsDiv = document.getElementById('jobs')!;

  try {
    const health = await send<{ ok: boolean; error?: string }>({ type: 'PING' });
    dot.classList.toggle('on', health.ok);
    status.textContent = health.ok ? 'Backend connecté' : `Backend hors ligne — ${health.error ?? ''}`;
  } catch (error) {
    status.textContent = `Erreur: ${String(error)}`;
  }

  try {
    const sync = await api<Record<string, SyncRecord>>('/sync/data');
    lastSync.replaceChildren();
    const entries = Object.entries(sync);
    if (entries.length === 0) line(lastSync, 'Jamais');
    for (const [platform, record] of entries) {
      const count = Array.isArray(record.data) ? record.data.length : '?';
      line(lastSync, `${platform} — ${new Date(record.at).toLocaleString('fr-FR')} · ${count} annonce(s)`);
    }
  } catch {
    lastSync.textContent = '—';
  }

  try {
    const { jobs } = await api<{ jobs: Job[] }>('/jobs');
    jobsDiv.replaceChildren();
    const recent = jobs.slice(0, 5);
    if (recent.length === 0) line(jobsDiv, 'Aucune');
    for (const job of recent) {
      line(jobsDiv, `${job.type} · ${job.platform} · ${job.status}${job.error ? ` — ${job.error}` : ''}`);
    }
  } catch {
    jobsDiv.textContent = '—';
  }
}

document.getElementById('dashboard')!.addEventListener('click', async () => {
  const config = await getConfig();
  await chrome.tabs.create({ url: config.backendUrl });
});
document.getElementById('options')!.addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('sync')!.addEventListener('click', async () => {
  const status = document.getElementById('status')!;
  try {
    const response = await send<{ ok: boolean; error?: string; platform?: string }>({ type: 'SYNC_NOW' });
    status.textContent = response.ok
      ? `Synchronisation ${response.platform} lancée`
      : response.error ?? 'Échec';
  } catch (error) {
    status.textContent = `Erreur: ${String(error)}`;
  }
  setTimeout(() => void refresh(), 1500);
});

void refresh();

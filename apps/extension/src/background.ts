import type { Job, Platform } from '@fluxlibre/shared';
import { api, isJobResultMessage, JOBS_KEY, platformFromUrl, startUrl } from './shared';

const ALARM = 'fluxlibre-poll';
const TIMEOUT_MS = 180_000;
const POLL_MINUTES = 0.08; // ~5 s : démarrage rapide, garde anti-chevauchement active
let polling = false;

/** Onglets ouverts par tâche, à fermer après réponse. */
const jobTabs = new Map<string, number>();
/** Tâches en attente de livraison, indexées par onglet. */
const pendingByTab = new Map<number, { id: string; job: Job }>();

async function resetState(): Promise<void> {
  await chrome.storage.local.set({ [JOBS_KEY]: {}, fluxlibre_results: {} });
  jobTabs.clear();
}

chrome.runtime.onInstalled.addListener(() => {
  void resetState();
  chrome.alarms.create(ALARM, { periodInMinutes: POLL_MINUTES });
  console.log('[FluxLibre] extension installée');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void poll();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: POLL_MINUTES });
  void redispatchStored();
  void poll();
});

setInterval(() => {
  void expireStale();
}, 30_000);

async function getJobs(): Promise<Record<string, Job>> {
  const data = await chrome.storage.local.get(JOBS_KEY);
  return (data[JOBS_KEY] as Record<string, Job> | undefined) ?? {};
}

async function setJobs(jobs: Record<string, Job>): Promise<void> {
  await chrome.storage.local.set({ [JOBS_KEY]: jobs });
}

async function expireStale(): Promise<void> {
  const jobs = await getJobs();
  let changed = false;
  for (const [id, job] of Object.entries(jobs)) {
    if (Date.now() - Date.parse(job.updatedAt) > TIMEOUT_MS) {
      jobTabs.delete(id);
      await report(id, { ok: false, error: 'Délai dépassé : aucune réponse du content script' });
      delete jobs[id];
      changed = true;
    }
  }
  if (changed) await setJobs(jobs);
}

async function report(jobId: string, result: { ok: boolean; error?: string; data?: unknown }): Promise<void> {
  try {
    await api(`/jobs/${String(jobId)}/complete`, { method: 'POST', body: JSON.stringify(result) });
  } catch (error) {
    console.error('[FluxLibre] rapport échoué', error);
  }
}

async function takeJob(job: Job): Promise<void> {
  const jobs = await getJobs();
  if (jobs[job.id]) return;
  const claimed = await api<Job>(`/jobs/${String(job.id)}/claim`, { method: 'POST' });
  jobs[claimed.id] = { ...claimed, updatedAt: new Date().toISOString() };
  await setJobs(jobs);

  // Onglet neuf et inactif pour TOUTES les tâches : script frais garanti.
  const tab = await chrome.tabs.create({ url: startUrl(claimed), active: false });
  if (tab.id !== undefined) {
    jobTabs.set(claimed.id, tab.id);
    pendingByTab.set(tab.id, { id: claimed.id, job: claimed });
  }
}

/** Relance les tâches restées en stockage après un redémarrage du service worker. */
async function redispatchStored(): Promise<void> {
  const jobs = await getJobs();
  for (const job of Object.values(jobs)) {
    // Les anciennes tâches enrich périmées sont abandonnées proprement.
    if (job.type === 'enrich' && Date.now() - Date.parse(job.updatedAt) > TIMEOUT_MS) {
      delete jobs[job.id];
      await report(job.id, { ok: false, error: 'Tâche abandonnée (redémarrage)' });
      continue;
    }
    const tab = await chrome.tabs.create({ url: startUrl(job), active: false });
    if (tab.id !== undefined) jobTabs.set(job.id, tab.id);
  }
}

async function flushResults(): Promise<void> {
  const data = await chrome.storage.local.get('fluxlibre_results');
  const results = (data['fluxlibre_results'] as Record<string, { ok: boolean; error?: string }> | undefined) ?? {};
  const ids = Object.keys(results);
  if (ids.length === 0) return;
  for (const id of ids) {
    await report(id, results[id]!);
    delete results[id];
  }
  await chrome.storage.local.set({ fluxlibre_results: results });
}

async function poll(): Promise<void> {
  if (polling) return; // évite les chevauchements (alarme + startup + messages)
  polling = true;
  try {
    await flushResults();
    const data = await api<{ job: Job | null }>('/jobs/next');
    if (data.job && !(await getJobs())[data.job.id]) await takeJob(data.job);
  } catch (error) {
    console.debug('[FluxLibre] poll:', error instanceof Error ? error.message : error);
  } finally {
    polling = false;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (message && typeof message === 'object' && (message as { type?: string }).type === 'FLUXLIBRE_READY') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    const pending = pendingByTab.get(tabId);
    if (!pending) return;
    pendingByTab.delete(tabId);
    void chrome.tabs.sendMessage(tabId, { type: 'RUN_JOB', job: pending.job }).catch(() => {
      void report(pending.id, { ok: false, error: 'Impossible de livrer la tâche au content script' });
    });
    return;
  }
  if (!isJobResultMessage(message)) return;
  void (async () => {
    const jobs = await getJobs();
    delete jobs[message.jobId];
    await setJobs(jobs);
    const tabId = jobTabs.get(message.jobId);
    jobTabs.delete(message.jobId);
    // Succès : on ferme l'onglet utilisé. Échec : on le garde pour diagnostic.
    if (message.result.ok && tabId !== undefined) {
      await chrome.tabs.remove(tabId).catch(() => undefined);
    }
    await report(message.jobId, message.result);
  })();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;
  const type = (message as { type?: string }).type;

  if (type === 'PING') {
    void api<{ ok: boolean }>('/health')
      .then((health) => sendResponse({ ok: health.ok }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (type === 'SYNC_NOW') {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const platform: Platform | null = platformFromUrl(tab?.url);
        if (!platform) {
          sendResponse({ ok: false, error: 'Ouvrez d’abord un onglet Leboncoin ou Vinted' });
          return;
        }
        const { jobs } = await api<{ jobs: Job[] }>('/sync', {
          method: 'POST',
          body: JSON.stringify({ platforms: [platform] }),
        });
        const job = jobs[0];
        if (!job) throw new Error('Aucune tâche créée');
        await takeJob(job);
        sendResponse({ ok: true, platform });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  if (type === 'FETCH_IMAGE') {
    const url = (message as { url?: string }).url ?? '';
    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        sendResponse({ ok: true, base64: btoa(binary) });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  if (type === 'GET_PENDING') {
    void getJobs().then((jobs) => sendResponse({ jobs: Object.values(jobs) }));
    return true;
  }
});

// L'alarme périodique suffit : évite de poller à chaque redémarrage du service worker.
chrome.alarms.create(ALARM, { periodInMinutes: POLL_MINUTES });

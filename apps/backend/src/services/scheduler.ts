import cron from 'node-cron';
import { store } from '../db.js';
import { getConfig } from '../config.js';

/** Remet en file les tâches restées bloquées et crée les renouvellements nécessaires. */
export function runMaintenance(): { requeued: number; renewals: number } {
  const requeued = store.requeueStaleJobs(10);
  const { renewAfterDays } = getConfig();
  const cutoff = Date.now() - Math.max(1, renewAfterDays) * 86_400_000;
  let renewals = 0;

  for (const publication of store.listPublications()) {
    if (publication.status !== 'published') continue;
    const publishedAt = publication.lastPublishedAt ? Date.parse(publication.lastPublishedAt) : 0;
    if (Number.isNaN(publishedAt) || publishedAt > cutoff) continue;

    const alreadyQueued = store
      .listJobs('queued')
      .some((job) => job.type === 'renew' && job.platform === publication.platform && job.listingId === publication.listingId);
    if (alreadyQueued) continue;

    store.createJob({
      type: 'renew',
      platform: publication.platform,
      listingId: publication.listingId,
      publicationId: publication.id,
      payload: { auto: true },
    });
    renewals += 1;
  }

  return { requeued, renewals };
}

export function startScheduler(): void {
  cron.schedule('0 * * * *', () => {
    try {
      const result = runMaintenance();
      if (result.renewals > 0 || result.requeued > 0) {
        console.log('[scheduler]', result);
      }
    } catch (error) {
      console.error('[scheduler]', error);
    }
  });
  console.log('[scheduler] actif (vérification horaire)');
}

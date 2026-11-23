import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_CONFIG,
  PLATFORMS,
  type Job,
  type JobResult,
  type JobStatus,
  type Listing,
  type Platform,
  type Publication,
} from '@fluxlibre/shared';
import { store } from './db.js';
import { getConfig, publicConfig, saveConfig } from './config.js';
import { generateListing } from './services/ai.js';
import { editImage, prepareProductPhoto } from './services/images.js';
import { runMaintenance } from './services/scheduler.js';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const asyncRoute =
  (handler: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };

function badRequest(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: 'Données invalides', details: error.flatten() });
}

function notFound(res: Response, what: string): void {
  res.status(404).json({ error: `${what} introuvable` });
}

const platformSchema = z.enum(['leboncoin', 'vinted']);

function requireListing(id: string, res: Response): Listing | undefined {
  const listing = store.getListing(id);
  if (!listing) notFound(res, 'Annonce');
  return listing;
}

function queueJob(
  type: 'publish' | 'renew' | 'pause' | 'delete',
  listing: Listing,
  publication: Publication,
  extra: Record<string, unknown> = {},
) {
  return store.createJob({
    type,
    platform: publication.platform,
    listingId: listing.id,
    publicationId: publication.id,
    payload: {
      listing,
      publication,
      autoSubmit: getConfig().autoSubmit,
      ...extra,
    },
  });
}

/** Nettoie un titre de carte Leboncoin (texte souvent dupliqué par le DOM). */
function cleanTitle(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  const prefix = text.slice(0, Math.min(20, Math.floor(text.length / 2)));
  if (prefix.length >= 8) {
    const second = text.indexOf(prefix, prefix.length);
    if (second > 0) return text.slice(0, second).trim().slice(0, 200);
  }
  return text.slice(0, 200);
}

function adIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  return (
    url.match(/\/ad\/[^/]+\/(\d+)/)?.[1] ??
    url.match(/\/ad\/(\d+)/)?.[1] ??
    null
  );
}

/** Importe les annonces trouvées par une synchro dans le catalogue local. */
function importSyncedAds(platform: Platform, data: unknown): number {
  if (!Array.isArray(data)) return 0;
  const now = new Date().toISOString();
  let imported = 0;
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as {
      adId?: unknown;
      title?: unknown;
      url?: unknown;
      price?: unknown;
      image?: unknown;
      category?: unknown;
      status?: unknown;
      delivery?: unknown;
    };
    const url = typeof item.url === 'string' ? item.url : null;
    const rawId = typeof item.adId === 'string' && item.adId ? item.adId : null;
    const adId = adIdFromUrl(url) ?? (/^\d+$/.test(rawId ?? '') ? rawId : null);
    if (!adId) continue;
    const title =
      typeof item.title === 'string' && item.title.trim() ? cleanTitle(item.title) : `Annonce ${adId}`;
    const price = typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : 0;
    const images = typeof item.image === 'string' && item.image ? [item.image] : [];
    const category = typeof item.category === 'string' ? item.category : '';
    const status: Listing['status'] =
      item.status === 'paused' || item.status === 'sold' || item.status === 'expired'
        ? item.status
        : 'published';
    const delivery = item.delivery === true;
    const description = delivery ? 'Livraison disponible' : '';

    const existing = store.findPublicationByAdId(platform, adId);
    if (existing) {
      const current = store.getListing(existing.listingId);
      const patch: Partial<Omit<Listing, 'id' | 'createdAt' | 'updatedAt'>> = { status };
      // Ne remplace le prix que si la synchro en a trouvé un (> 0).
      if (price > 0) patch.price = price;
      if (category) patch.category = category;
      // Ne remplace les photos que si on en a au moins autant.
      if (images.length >= (current?.images.length ?? 0) && images.length > 0) patch.images = images;
      // Description, livraison et adresse : gérées à la main, jamais écrasées par la synchro.
      store.updateListing(existing.listingId, patch);
      store.upsertPublication(existing.listingId, platform, {
        status: status === 'paused' ? 'expired' : 'published',
        url,
        lastPublishedAt: now,
        error: null,
      });
      continue;
    }
    const listing = store.createListing({
      title,
      description,
      price,
      category,
      delivery,
      images,
      status,
    });
    store.upsertPublication(listing.id, platform, {
      status: status === 'paused' ? 'expired' : 'published',
      platformAdId: adId,
      url,
      lastPublishedAt: now,
      error: null,
    });
    imported += 1;
  }
  return imported;
}

export const api: Router = Router();

api.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'fluxlibre', version: '0.1.0', time: new Date().toISOString() });
});

api.get('/config', (_req, res) => {
  res.json(publicConfig(getConfig()));
});

api.patch(
  '/config',
  asyncRoute(async (req, res) => {
    const schema = z
      .object({
        backendUrl: z.string().url().optional(),
        aiProvider: z.enum(['none', 'openai', 'anthropic', 'ollama']).optional(),
        aiModel: z.string().min(1).optional(),
        aiBaseUrl: z.string().optional(),
        autoSubmit: z.boolean().optional(),
        renewAfterDays: z.number().int().min(1).max(365).optional(),
        aiApiKey: z.string().optional(),
      })
      .strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    res.json(publicConfig(saveConfig(parsed.data)));
  }),
);

api.get('/listings', (_req, res) => {
  res.json({ listings: store.listListings(), publications: store.listPublications() });
});

api.post(
  '/listings',
  asyncRoute(async (req, res) => {
    const schema = z.object({
      title: z.string().min(1).max(200),
      description: z.string().default(''),
      price: z.number().nonnegative(),
      category: z.string().default(''),
      delivery: z.boolean().default(false),
      address: z.string().default(''),
      images: z.array(z.string()).default([]),
      status: z.enum(['draft', 'published', 'paused', 'expired', 'sold', 'error']).default('draft'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    res.status(201).json(store.createListing(parsed.data));
  }),
);

api.get('/listings/:id', (req, res) => {
  const listing = requireListing(String(req.params.id ?? ''), res);
  if (!listing) return;
  res.json({ listing, publications: store.listPublications(listing.id) });
});

api.patch(
  '/listings/:id',
  asyncRoute(async (req, res) => {
    const schema = z
      .object({
        title: z.string().min(1).max(200).optional(),
        description: z.string().optional(),
        price: z.number().nonnegative().optional(),
        category: z.string().optional(),
        delivery: z.boolean().optional(),
        address: z.string().optional(),
        images: z.array(z.string()).optional(),
        status: z.enum(['draft', 'published', 'paused', 'expired', 'sold', 'error']).optional(),
      })
      .strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const listing = store.updateListing(String(req.params.id ?? ''), parsed.data);
    if (!listing) return notFound(res, 'Annonce');
    res.json(listing);
  }),
);

api.delete('/listings/:id', (req, res) => {
  if (!store.deleteListing(String(req.params.id ?? ''))) return notFound(res, 'Annonce');
  res.status(204).end();
});

api.post(
  '/ai/generate',
  asyncRoute(async (req, res) => {
    const schema = z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      platform: platformSchema.optional(),
      tone: z.string().optional(),
      both: z.boolean().default(false),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const { both, ...input } = parsed.data;
    if (both) {
      const [leboncoin, vinted] = await Promise.all([
        generateListing({ ...input, platform: 'leboncoin' }),
        generateListing({ ...input, platform: 'vinted' }),
      ]);
      return res.json({ leboncoin, vinted });
    }
    res.json(await generateListing(input));
  }),
);

api.post(
  '/images/prepare',
  asyncRoute(async (req, res) => {
    const schema = z.object({
      /** Soit une URL, soit une image base64 (avec ou sans préfixe data:). */
      source: z.string().min(1),
      base64: z.string().optional(),
      output: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    let source = parsed.data.source;
    if (parsed.data.base64) {
      const dir = join(getConfig().dataDir, 'inputs');
      await mkdir(dir, { recursive: true });
      source = join(dir, `${randomUUID()}.img`);
      const raw = parsed.data.base64.replace(/^data:image\/[^;]+;base64,/, '');
      await writeFile(source, Buffer.from(raw, 'base64'));
    }
    const result = await prepareProductPhoto(source);
    res.json(result);
  }),
);

api.post(
  '/images/edit',
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({
        source: z.string().min(1),
        operations: z.array(z.unknown()).min(1),
        output: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const result = await editImage({
      source: parsed.data.source,
      operations: parsed.data.operations as Parameters<typeof editImage>[0]['operations'],
      output: parsed.data.output,
    });
    res.json(result);
  }),
);

api.get('/publications', (_req, res) => {
  res.json({ publications: store.listPublications() });
});

api.post(
  '/publish',
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({
        listingId: z.string().min(1),
        platforms: z.array(platformSchema).min(1).default(PLATFORMS),
        autoSubmit: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const listing = requireListing(parsed.data.listingId, res);
    if (!listing) return;

    const jobs = [];
    for (const platform of parsed.data.platforms) {
      const publication = store.upsertPublication(listing.id, platform, {
        status: 'pending',
        error: null,
      });
      jobs.push(queueJob('publish', listing, publication, { autoSubmit: parsed.data.autoSubmit }));
    }
    res.status(202).json({ jobs });
  }),
);

api.post(
  '/renew',
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({
        listingId: z.string().optional(),
        listingIds: z.array(z.string()).optional(),
        platforms: z.array(platformSchema).optional(),
        autoSubmit: z.boolean().default(false),
        delaySeconds: z.number().int().min(0).max(600).default(20),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, parsed.error);

    let publications = store.listPublications(parsed.data.listingId);
    if (parsed.data.listingIds) {
      const ids = new Set(parsed.data.listingIds);
      publications = publications.filter((p) => ids.has(p.listingId));
    }
    if (parsed.data.platforms) {
      const platforms: Platform[] = parsed.data.platforms;
      publications = publications.filter((p) => platforms.includes(p.platform));
    }
    publications = publications.filter(
      (p) => p.status === 'published' || p.status === 'expired' || p.status === 'pending',
    );
    const jobs = [];
    // Espacement : chaque annonce commence `delaySeconds` après la précédente.
    let elapsed = 0;
    for (const publication of publications) {
      const notBefore = new Date(Date.now() + elapsed * 1000).toISOString();
      const listing = requireListing(publication.listingId, res);
      if (!listing) continue;

      // Vrai renouvellement Leboncoin : réactiver si l'annonce est en pause,
      // supprimer l'ancienne annonce, puis recréer le formulaire de dépôt.
      let previous: Job | null = null;
      if (listing.status === 'paused') {
        previous = store.createJob({
          type: 'renew',
          platform: publication.platform,
          listingId: listing.id,
          publicationId: publication.id,
          dependsOn: null,
          notBefore,
          payload: { listing, publication },
        });
        jobs.push(previous);
      }

      const deletion = store.createJob({
        type: 'delete',
        platform: publication.platform,
        listingId: listing.id,
        publicationId: publication.id,
        dependsOn: previous?.id ?? null,
        notBefore,
        payload: { listing, publication },
      });
      jobs.push(deletion);

      const final = store.createJob({
        type: 'publish',
        platform: publication.platform,
        listingId: listing.id,
        publicationId: publication.id,
        dependsOn: deletion.id,
        payload: {
          listing,
          publication,
          autoSubmit: parsed.data.autoSubmit,
          renew: true,
        },
      });
      jobs.push(final);

      elapsed += parsed.data.delaySeconds;
    }
    res.status(202).json({ jobs });
  }),
);

api.post(
  '/refresh',
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({ listingId: z.string().min(1), platform: platformSchema.default('leboncoin') })
      .safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, parsed.error);
    const listing = requireListing(parsed.data.listingId, res);
    if (!listing) return;
    const publication = store.getPublication(listing.id, parsed.data.platform);
    if (!publication?.url || publication.url.includes('/deposer-une-annonce')) {
      return res.status(400).json({ error: 'URL d’annonce introuvable — relance d’abord une synchro' });
    }
    const job = store.createJob({
      type: 'refresh',
      platform: parsed.data.platform,
      listingId: listing.id,
      publicationId: publication.id,
      payload: { url: publication.url, adId: publication.platformAdId },
    });
    res.status(202).json({ jobs: [job] });
  }),
);

api.post(
  '/pause',
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({
        listingId: z.string().min(1),
        platforms: z.array(platformSchema).default(['leboncoin']),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, parsed.error);
    const listing = requireListing(parsed.data.listingId, res);
    if (!listing) return;
    const jobs = [];
    for (const platform of parsed.data.platforms) {
      const publication = store.getPublication(listing.id, platform);
      if (!publication || publication.status !== 'published') continue;
      jobs.push(queueJob('pause', listing, publication));
    }
    res.status(202).json({ jobs });
  }),
);

api.post(
  '/delete',
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({
        listingId: z.string().min(1),
        platforms: z.array(platformSchema).min(1).default(PLATFORMS),
      })
      .safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const listing = requireListing(parsed.data.listingId, res);
    if (!listing) return;
    const jobs = [];
    for (const platform of parsed.data.platforms) {
      const publication = store.getPublication(listing.id, platform);
      if (!publication || publication.status !== 'published') continue;
      jobs.push(queueJob('delete', listing, publication));
    }
    res.status(202).json({ jobs });
  }),
);

api.post(
  '/enrich',
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({ listingId: z.string().optional(), platform: platformSchema.optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, parsed.error);
    let publications = store.listPublications(parsed.data.listingId);
    if (parsed.data.platform) {
      publications = publications.filter((p) => p.platform === parsed.data.platform);
    }
    const jobs = [];
    for (const publication of publications) {
      const listing = store.getListing(publication.listingId);
      if (!listing || !publication.url) continue;
      jobs.push(
        store.createJob({
          type: 'enrich',
          platform: publication.platform,
          listingId: listing.id,
          publicationId: publication.id,
          payload: {
            url: publication.url,
            adId: publication.platformAdId,
            imageCount: listing.images.length,
          },
        }),
      );
    }
    res.status(202).json({ jobs });
  }),
);

api.post(
  '/sync',
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({ platforms: z.array(platformSchema).min(1).default(PLATFORMS) })
      .safeParse(req.body ?? {});
    if (!parsed.success) return badRequest(res, parsed.error);
    const jobs = parsed.data.platforms.map((platform) =>
      store.createJob({ type: 'sync', platform, payload: {} }),
    );
    res.status(202).json({ jobs });
  }),
);

api.post('/sync/import', (_req, res) => {
  let imported = 0;
  for (const platform of PLATFORMS) {
    const raw = store.getSetting(`sync:${platform}`);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { data?: unknown };
      imported += importSyncedAds(platform, parsed.data);
    } catch {
      /* donnée de synchro illisible : ignorée */
    }
  }
  res.json({ imported });
});

api.get('/sync/data', (_req, res) => {
  const result: Record<string, unknown> = {};
  for (const platform of PLATFORMS) {
    const raw = store.getSetting(`sync:${platform}`);
    if (!raw) continue;
    try {
      result[platform] = JSON.parse(raw) as unknown;
    } catch {
      result[platform] = raw;
    }
  }
  res.json(result);
});

api.get('/jobs', (req, res) => {
  const status = req.query.status as string | undefined;
  const allowed = ['queued', 'running', 'done', 'failed'];
  res.json({
    jobs: store.listJobs(status && allowed.includes(status) ? (status as 'queued') : undefined),
  });
});

api.delete('/jobs', (req, res) => {
  const raw = typeof req.query.status === 'string' ? req.query.status : 'done,failed';
  const allowed = ['queued', 'running', 'done', 'failed'];
  const statuses: JobStatus[] | undefined =
    raw === 'all' ? undefined : raw.split(',').filter((s) => allowed.includes(s)) as JobStatus[];
  res.json({ deleted: store.clearJobs(statuses) });
});

api.get('/jobs/next', (_req, res) => {
  const queued = store.listJobs('queued');
  const now = Date.now();
  const ready = queued.filter((job) => {
    if (job.notBefore && Date.parse(job.notBefore) > now) return false;
    if (!job.dependsOn) return true;
    const parent = store.getJob(job.dependsOn);
    return parent?.status === 'done';
  });
  res.json({ job: ready.length > 0 ? ready[ready.length - 1] : null });
});

api.post('/jobs/:id/claim', (req, res) => {
  const job = store.claimJob(String(req.params.id ?? ''));
  if (!job) return res.status(409).json({ error: 'Tâche indisponible (déjà réclamée ou terminée)' });
  res.json(job);
});

api.post(
  '/jobs/:id/complete',
  asyncRoute(async (req, res) => {
    const parsed = z
      .object({
        ok: z.boolean(),
        adId: z.string().optional(),
        url: z.string().optional(),
        error: z.string().optional(),
        data: z.unknown().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const job = store.getJob(String(req.params.id ?? ''));
    if (!job) return notFound(res, 'Tâche');

    const result: JobResult = parsed.data;
    store.finishJob(job.id, result);

    if (job.type === 'enrich' && result.ok && result.data !== undefined && job.listingId) {
      const data = result.data as { images?: unknown };
      // L'enrich ne met à jour QUE les photos. La description, le prix, la
      // livraison, la catégorie et l'adresse sont gérés à la main dans le catalogue.
      const images = Array.isArray(data.images)
        ? data.images.filter((img): img is string => typeof img === 'string' && img.startsWith('http'))
        : [];
      if (images.length > 0) store.updateListing(job.listingId, { images });
    }

    if (job.type === 'refresh' && result.ok && result.data !== undefined && job.listingId) {
      const data = result.data as {
        images?: unknown;
        description?: unknown;
        price?: unknown;
        category?: unknown;
        address?: unknown;
        delivery?: unknown;
      };
      const patch: Partial<Omit<Listing, 'id' | 'createdAt' | 'updatedAt'>> = {};
      const images = Array.isArray(data.images)
        ? data.images.filter((img): img is string => typeof img === 'string' && img.startsWith('http'))
        : [];
      if (images.length > 0) patch.images = images;
      if (typeof data.description === 'string' && data.description.trim()) patch.description = data.description.trim();
      if (typeof data.price === 'number' && Number.isFinite(data.price)) patch.price = data.price;
      if (typeof data.category === 'string' && data.category.trim()) patch.category = data.category.trim();
      if (typeof data.address === 'string' && data.address.trim()) patch.address = data.address.trim();
      if (typeof data.delivery === 'boolean') patch.delivery = data.delivery;
      // Le refresh lit une annonce en ligne : on la marque published et on date le refresh.
      patch.status = 'published';
      patch.lastRefreshedAt = new Date().toISOString();
      store.updateListing(job.listingId, patch);
      if (job.publicationId) {
        store.patchPublication(job.publicationId, {
          status: 'published',
          lastPublishedAt: new Date().toISOString(),
          error: null,
        });
      }
    }

    if (job.type === 'sync' && result.data !== undefined) {
      const now = new Date().toISOString();
      store.setSetting(`sync:${job.platform}`, JSON.stringify({ at: now, data: result.data }));

      if (result.ok) importSyncedAds(job.platform, result.data);
    }

    const listing = job.listingId ? store.getListing(job.listingId) : undefined;
    if (listing) {
      if (job.type === 'publish' || job.type === 'renew') {
        // Sans publication automatique, le formulaire est rempli mais pas validé :
        // on garde `draft` / `pending` jusqu'à la validation manuelle.
        const manual = job.payload['autoSubmit'] === false;
        store.upsertPublication(listing.id, job.platform, {
          status: !result.ok ? 'failed' : manual ? 'pending' : 'published',
          platformAdId: result.adId ?? null,
          url: result.url ?? null,
          lastPublishedAt: result.ok && !manual ? new Date().toISOString() : null,
          error: result.error ?? null,
        });
        store.updateListing(listing.id, {
          status: !result.ok ? 'error' : manual ? 'draft' : 'published',
        });
        // Vérification différée à 5 min : Leboncoin peut encore être en
        // « cours de vérification » juste après le dépôt.
        if (result.ok && !manual) {
          const url = result.url ?? store.getPublication(listing.id, job.platform)?.url;
          if (url && !url.includes('/deposer-une-annonce')) {
            store.createJob({
              type: 'check',
              platform: job.platform,
              listingId: listing.id,
              publicationId: job.publicationId,
              notBefore: new Date(Date.now() + 5 * 60_000).toISOString(),
              payload: { url, adId: result.adId },
            });
          }
        }
      } else if (job.type === 'check' && result.ok && result.data !== undefined) {
        const data = result.data as { status?: unknown };
        const state = data.status;
        if (state === 'published') {
          store.upsertPublication(listing.id, job.platform, {
            status: 'published',
            error: null,
            lastPublishedAt: new Date().toISOString(),
          });
          store.updateListing(listing.id, { status: 'published' });
        } else if (state === 'missing') {
          store.upsertPublication(listing.id, job.platform, { status: 'failed', error: 'Annonce introuvable' });
          store.updateListing(listing.id, { status: 'error' });
        }
        // 'pending' : on ne change rien, un nouveau check pourra être relancé.
      } else if (job.type === 'pause') {
        if (result.ok) {
          store.upsertPublication(listing.id, job.platform, { status: 'expired' });
          store.updateListing(listing.id, { status: 'paused' });
        } else {
          store.upsertPublication(listing.id, job.platform, { status: 'failed', error: result.error ?? null });
        }
      } else if (job.type === 'delete') {
        if (result.ok) {
          // Un renouvellement enchaîne avec un `publish` : on garde la publication.
          const isRenewal = store.listJobs().some((j) => j.dependsOn === job.id && j.type === 'publish');
          if (isRenewal) {
            store.upsertPublication(listing.id, job.platform, {
              status: 'pending',
              platformAdId: null,
              url: null,
              error: null,
            });
            store.updateListing(listing.id, { status: 'draft' });
          } else {
            store.deletePublication(listing.id, job.platform);
          }
        } else {
          store.upsertPublication(listing.id, job.platform, { status: 'failed', error: result.error ?? null });
        }
      }
    }
    res.json({ ok: true });
  }),
);

api.get('/debug', (_req, res) => {
  const raw = store.getSetting('debug:enrich');
  if (!raw) return res.json({ debug: null });
  try {
    res.json({ debug: JSON.parse(raw) as unknown });
  } catch {
    res.json({ debug: raw });
  }
});

api.patch('/publications/:id', (req, res) => {
  const id = String(req.params.id ?? '');
  const parsed = z
    .object({
      status: z.enum(['pending', 'running', 'published', 'failed', 'expired', 'deleted']).optional(),
      url: z.string().optional(),
      platformAdId: z.string().optional(),
      error: z.string().nullable().optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error);
  const publication = store.patchPublication(id, parsed.data);
  if (!publication) return notFound(res, 'Publication');
  res.json(publication);
});

api.post('/maintenance', (_req, res) => {
  res.json(runMaintenance());
});

api.get('/defaults', (_req, res) => {
  res.json(DEFAULT_CONFIG);
});

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type {
  Job,
  JobResult,
  JobStatus,
  JobType,
  Listing,
  Platform,
  Publication,
  PublicationStatus,
} from '@fluxlibre/shared';

const dbPath =
  process.env.FLUXLIBRE_DB ?? resolve(homedir(), '.fluxlibre', 'fluxlibre.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Migrations légères pour les bases créées par une version antérieure.
try {
  db.exec('ALTER TABLE listings ADD COLUMN delivery INTEGER NOT NULL DEFAULT 0');
} catch {
  /* colonne déjà présente */
}
try {
  db.exec('ALTER TABLE jobs ADD COLUMN depends_on TEXT');
} catch {
  /* colonne déjà présente */
}
try {
  db.exec("ALTER TABLE listings ADD COLUMN address TEXT NOT NULL DEFAULT ''");
} catch {
  /* colonne déjà présente */
}
try {
  db.exec('ALTER TABLE jobs ADD COLUMN not_before TEXT');
} catch {
  /* colonne déjà présente */
}
try {
  db.exec('ALTER TABLE listings ADD COLUMN last_refreshed_at TEXT');
} catch {
  /* colonne déjà présente */
}

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    price       REAL NOT NULL,
    category    TEXT NOT NULL DEFAULT '',
    delivery    INTEGER NOT NULL DEFAULT 0,
    address     TEXT NOT NULL DEFAULT '',
    last_refreshed_at TEXT,
    images      TEXT NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'draft',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS publications (
    id                TEXT PRIMARY KEY,
    listing_id        TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    platform          TEXT NOT NULL,
    platform_ad_id    TEXT,
    url               TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    last_published_at TEXT,
    error             TEXT,
    UNIQUE(listing_id, platform)
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id             TEXT PRIMARY KEY,
    type           TEXT NOT NULL,
    platform       TEXT NOT NULL,
    listing_id     TEXT,
    publication_id TEXT,
    status         TEXT NOT NULL DEFAULT 'queued',
    depends_on     TEXT,
    not_before     TEXT,
    payload        TEXT NOT NULL DEFAULT '{}',
    error          TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_publications_listing ON publications(listing_id);
`);

type ListingRow = {
  id: string;
  title: string;
  description: string;
  price: number;
  category: string;
  delivery: number;
  address: string;
  last_refreshed_at: string | null;
  images: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type PublicationRow = {
  id: string;
  listing_id: string;
  platform: Platform;
  platform_ad_id: string | null;
  url: string | null;
  status: PublicationStatus;
  last_published_at: string | null;
  error: string | null;
};

type JobRow = {
  id: string;
  type: JobType;
  platform: Platform;
  listing_id: string | null;
  publication_id: string | null;
  status: JobStatus;
  depends_on: string | null;
  not_before: string | null;
  payload: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

function toListing(row: ListingRow): Listing {
  let images: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.images);
    if (Array.isArray(parsed)) images = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    images = [];
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price,
    category: row.category,
    delivery: row.delivery === 1,
    address: row.address ?? '',
    lastRefreshedAt: row.last_refreshed_at ?? null,
    images,
    status: row.status as Listing['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPublication(row: PublicationRow): Publication {
  return {
    id: row.id,
    listingId: row.listing_id,
    platform: row.platform,
    platformAdId: row.platform_ad_id,
    url: row.url,
    status: row.status,
    lastPublishedAt: row.last_published_at,
    error: row.error,
  };
}

function toJob(row: JobRow): Job {
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    type: row.type,
    platform: row.platform,
    listingId: row.listing_id,
    publicationId: row.publication_id,
    dependsOn: row.depends_on,
    notBefore: row.not_before,
    status: row.status,
    payload,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const store = {
  listListings(): Listing[] {
    const rows = db.prepare('SELECT * FROM listings ORDER BY updated_at DESC').all() as ListingRow[];
    return rows.map(toListing);
  },

  getListing(id: string): Listing | undefined {
    const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as ListingRow | undefined;
    return row ? toListing(row) : undefined;
  },

  createListing(
    input: Pick<Listing, 'title' | 'description' | 'price' | 'category' | 'delivery' | 'images' | 'status'> & {
      address?: string;
      lastRefreshedAt?: string | null;
    },
  ): Listing {
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO listings (id, title, description, price, category, delivery, address, last_refreshed_at, images, status, created_at, updated_at)
       VALUES (@id, @title, @description, @price, @category, @delivery, @address, @lastRefreshedAt, @images, @status, @createdAt, @updatedAt)`,
    ).run({
      id,
      title: input.title,
      description: input.description,
      price: input.price,
      category: input.category,
      delivery: input.delivery ? 1 : 0,
      address: input.address ?? '',
      lastRefreshedAt: input.lastRefreshedAt ?? null,
      images: JSON.stringify(input.images),
      status: input.status,
      createdAt: now,
      updatedAt: now,
    });
    return this.getListing(id)!;
  },

  updateListing(id: string, patch: Partial<Omit<Listing, 'id' | 'createdAt' | 'updatedAt'>>): Listing | undefined {
    const current = this.getListing(id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    db.prepare(
      `UPDATE listings SET title=@title, description=@description, price=@price, category=@category,
       delivery=@delivery, address=@address, last_refreshed_at=@lastRefreshedAt, images=@images, status=@status, updated_at=@updatedAt WHERE id=@id`,
    ).run({
      id,
      title: next.title,
      description: next.description,
      price: next.price,
      category: next.category,
      delivery: next.delivery ? 1 : 0,
      address: next.address ?? '',
      lastRefreshedAt: next.lastRefreshedAt ?? null,
      images: JSON.stringify(next.images),
      status: next.status,
      updatedAt: new Date().toISOString(),
    });
    return this.getListing(id);
  },

  deleteListing(id: string): boolean {
    return db.prepare('DELETE FROM listings WHERE id = ?').run(id).changes > 0;
  },

  listPublications(listingId?: string): Publication[] {
    const rows = listingId
      ? (db.prepare('SELECT * FROM publications WHERE listing_id = ? ORDER BY platform').all(listingId) as PublicationRow[])
      : (db.prepare('SELECT * FROM publications ORDER BY platform').all() as PublicationRow[]);
    return rows.map(toPublication);
  },

  getPublication(listingId: string, platform: Platform): Publication | undefined {
    const row = db.prepare('SELECT * FROM publications WHERE listing_id = ? AND platform = ?').get(listingId, platform) as
      | PublicationRow
      | undefined;
    return row ? toPublication(row) : undefined;
  },

  upsertPublication(
    listingId: string,
    platform: Platform,
    patch: Partial<Pick<Publication, 'platformAdId' | 'url' | 'status' | 'lastPublishedAt' | 'error'>>,
  ): Publication {
    const existing = this.getPublication(listingId, platform);
    const id = existing?.id ?? randomUUID();
    const next = {
      id,
      listingId,
      platform,
      platformAdId: patch.platformAdId ?? existing?.platformAdId ?? null,
      url: patch.url ?? existing?.url ?? null,
      status: patch.status ?? existing?.status ?? 'pending',
      lastPublishedAt: patch.lastPublishedAt ?? existing?.lastPublishedAt ?? null,
      error: patch.error ?? existing?.error ?? null,
    };
    db.prepare(
      `INSERT INTO publications
        (id, listing_id, platform, platform_ad_id, url, status, last_published_at, error)
       VALUES (@id, @listingId, @platform, @platformAdId, @url, @status, @lastPublishedAt, @error)
       ON CONFLICT(listing_id, platform) DO UPDATE SET
        platform_ad_id=excluded.platform_ad_id,
        url=excluded.url,
        status=excluded.status,
        last_published_at=excluded.last_published_at,
        error=excluded.error`,
    ).run(next);
    return this.getPublication(listingId, platform)!;
  },

  patchPublication(
    id: string,
    patch: Partial<Pick<Publication, 'status' | 'url' | 'platformAdId' | 'error' | 'lastPublishedAt'>>,
  ): Publication | undefined {
    const row = db.prepare('SELECT * FROM publications WHERE id = ?').get(id) as PublicationRow | undefined;
    if (!row) return undefined;
    db.prepare(
      `UPDATE publications SET
        status=@status, url=@url, platform_ad_id=@platformAdId, error=@error,
        last_published_at=@lastPublishedAt
       WHERE id=@id`,
    ).run({
      id,
      status: patch.status ?? row.status,
      url: patch.url ?? row.url,
      platformAdId: patch.platformAdId ?? row.platform_ad_id,
      error: patch.error === undefined ? row.error : patch.error,
      lastPublishedAt: patch.lastPublishedAt ?? row.last_published_at,
    });
    const updated = db.prepare('SELECT * FROM publications WHERE id = ?').get(id) as PublicationRow;
    return toPublication(updated);
  },

  deletePublication(listingId: string, platform: Platform): boolean {
    return db.prepare('DELETE FROM publications WHERE listing_id = ? AND platform = ?').run(listingId, platform).changes > 0;
  },

  createJob(input: {
    type: JobType;
    platform: Platform;
    listingId?: string | null;
    publicationId?: string | null;
    dependsOn?: string | null;
    notBefore?: string | null;
    payload?: Record<string, unknown>;
  }): Job {
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO jobs (id, type, platform, listing_id, publication_id, status, depends_on, not_before, payload, created_at, updated_at)
       VALUES (@id, @type, @platform, @listingId, @publicationId, 'queued', @dependsOn, @notBefore, @payload, @createdAt, @updatedAt)`,
    ).run({
      id,
      type: input.type,
      platform: input.platform,
      listingId: input.listingId ?? null,
      publicationId: input.publicationId ?? null,
      dependsOn: input.dependsOn ?? null,
      notBefore: input.notBefore ?? null,
      payload: JSON.stringify(input.payload ?? {}),
      createdAt: now,
      updatedAt: now,
    });
    return this.getJob(id)!;
  },

  getJob(id: string): Job | undefined {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row ? toJob(row) : undefined;
  },

  listJobs(status?: JobStatus): Job[] {
    const rows = status
      ? (db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status) as JobRow[])
      : (db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200').all() as JobRow[]);
    return rows.map(toJob);
  },

  claimJob(id: string): Job | undefined {
    const result = db.prepare(
      `UPDATE jobs SET status='running', updated_at=@now WHERE id=@id AND status='queued'`,
    ).run({ id, now: new Date().toISOString() });
    return result.changes > 0 ? this.getJob(id) : undefined;
  },

  finishJob(id: string, result: JobResult): Job | undefined {
    const status: JobStatus = result.ok ? 'done' : 'failed';
    db.prepare('UPDATE jobs SET status=?, error=?, updated_at=? WHERE id=?').run(
      status,
      result.error ?? null,
      new Date().toISOString(),
      id,
    );
    return this.getJob(id);
  },

  findPublicationByAdId(platform: Platform, adId: string): Publication | undefined {
    const row = db
      .prepare('SELECT * FROM publications WHERE platform = ? AND platform_ad_id = ?')
      .get(platform, adId) as PublicationRow | undefined;
    return row ? toPublication(row) : undefined;
  },

  clearJobs(statuses?: JobStatus[]): number {
    const result =
      !statuses || statuses.length === 0
        ? db.prepare('DELETE FROM jobs').run()
        : db
            .prepare(`DELETE FROM jobs WHERE status IN (${statuses.map(() => '?').join(', ')})`)
            .run(...statuses);
    return Number(result.changes);
  },

  getSetting(key: string): string | undefined {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  },

  setSetting(key: string, value: string): void {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
  },

  requeueStaleJobs(maxAgeMinutes = 10): number {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
    return Number(
      db.prepare(
        `UPDATE jobs SET status='queued', updated_at=? WHERE status='running' AND updated_at < ?`,
      ).run(new Date().toISOString(), cutoff).changes,
    );
  },
};

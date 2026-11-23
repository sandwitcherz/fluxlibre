/** Types partagés entre le backend et l'extension. */

export type Platform = 'leboncoin' | 'vinted';

export type ListingStatus = 'draft' | 'published' | 'paused' | 'expired' | 'sold' | 'error';

export interface Listing {
  id: string;
  title: string;
  description: string;
  price: number;
  category: string;
  /** Proposer la livraison (case « Livraison » du formulaire). */
  delivery: boolean;
  /** Adresse de remise du bien. */
  address?: string;
  /** Date du dernier refresh depuis Leboncoin. */
  lastRefreshedAt?: string | null;
  /** Chemins de fichiers locaux ou URL des photos. */
  images: string[];
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
}

export type PublicationStatus =
  | 'pending'
  | 'running'
  | 'published'
  | 'failed'
  | 'expired'
  | 'deleted';

export interface Publication {
  id: string;
  listingId: string;
  platform: Platform;
  platformAdId?: string | null;
  url?: string | null;
  status: PublicationStatus;
  lastPublishedAt?: string | null;
  error?: string | null;
}

export type JobType = 'publish' | 'renew' | 'pause' | 'delete' | 'sync' | 'enrich' | 'refresh' | 'check';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  type: JobType;
  platform: Platform;
  listingId?: string | null;
  publicationId?: string | null;
  /** Id d'une tâche qui doit être terminée avant celle-ci. */
  dependsOn?: string | null;
  /** Horodatage avant lequel la tâche ne doit pas être traitée. */
  notBefore?: string | null;
  status: JobStatus;
  payload: Record<string, unknown>;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobResult {
  ok: boolean;
  adId?: string;
  url?: string;
  error?: string;
  /** Données optionnelles (utilisées par la tâche `sync`). */
  data?: unknown;
}

export interface AiGenerateRequest {
  title?: string;
  description?: string;
  category?: string;
  platform?: Platform;
  tone?: string;
}

export interface AiGenerateResponse {
  title: string;
  description: string;
  tags: string[];
}

export type ImageOperation =
  | { op: 'resize'; width: number; height: number; fit?: 'cover' | 'contain' }
  | { op: 'whiten'; threshold?: number }
  | { op: 'strip' }
  | { op: 'format'; format: 'webp' | 'jpeg' | 'png'; quality?: number };

export interface ImageEditRequest {
  /** Chemin local ou URL (http/https) de l'image source. */
  source: string;
  operations: ImageOperation[];
  /** Nom de fichier de sortie (sans chemin). */
  output?: string;
}

export interface AppConfig {
  backendUrl: string;
  aiProvider: 'none' | 'openai' | 'anthropic' | 'ollama';
  aiModel: string;
  aiBaseUrl: string;
  autoSubmit: boolean;
  renewAfterDays: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  backendUrl: 'http://localhost:7310',
  aiProvider: 'none',
  aiModel: 'gpt-4o-mini',
  aiBaseUrl: '',
  autoSubmit: false,
  renewAfterDays: 30,
};

export const PLATFORMS: Platform[] = ['leboncoin', 'vinted'];

export const PLATFORM_LABELS: Record<Platform, string> = {
  leboncoin: 'Leboncoin',
  vinted: 'Vinted',
};

export const API_PREFIX = '/api';
export const DEFAULT_PORT = 7310;

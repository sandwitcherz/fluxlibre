import type { Job, JobResult, Listing, Platform } from '@fluxlibre/shared';
import { JOBS_KEY } from '../shared';

export interface Adapter {
  readonly platform: Platform;
  publish(listing: Listing, autoSubmit: boolean): Promise<JobResult>;
  renew(job: Job): Promise<JobResult>;
  pause(job: Job): Promise<JobResult>;
  remove(job: Job): Promise<JobResult>;
  sync(): Promise<JobResult>;
  enrich(job: Job): Promise<JobResult>;
  refresh(job: Job): Promise<JobResult>;
  check(job: Job): Promise<JobResult>;
}

/** Dernière étape atteinte, pour le diagnostic en cas de blocage. */
export let lastStep = 'démarrage';
export function setStep(step: string): void {
  lastStep = step;
}

export const SELECTORS: Record<Platform, Record<string, string[]>> = {
  leboncoin: {
    title: ['input[name="subject"]', '#subject', '[data-testid="subject"]'],
    description: ['textarea[name="body"]', '#body', '[data-testid="body"]', '[contenteditable="true"]'],
    price: ['input[name="price"]', '#price', '[data-testid="price-candidat-input"]'],
    category: ['input[name="category"]', '[data-testid="category-selector"]'],
    location: ['input[name="location"]', '[data-testid="location-input"]'],
    photoInput: [
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
      'span[data-spark-component="file-upload-trigger"]',
    ],
    submit: [
      'button[type="submit"]',
      '[data-testid="button-submit"]',
      'button:has-text("Publier l\'annonce")',
    ],
    pause: ['button'],
    renew: [
      'button:has-text("Réactiver l\'annonce")',
      'button:has-text("Réactiver")',
      'button:has-text("Renouveler")',
      'button:has-text("Remonter")',
      'a:has-text("Renouveler")',
    ],
    delete: ['button'],
    listingRow: [
      '[data-testid="listing-row"]',
      '[data-testid*="listing"]',
      '[data-testid*="ad-card"]',
      '[data-testid*="advert"]',
      '[class*="ad-card"]',
      '[class*="listing-card"]',
      'a[href*="/ad/"]',
    ],
  },
  vinted: {
    title: ['input[name="title"]', '[data-testid="title-field"]', 'input[placeholder*="titre"]'],
    description: ['textarea[name="description"]', '[data-testid="description-field"]'],
    price: ['input[name="price"]', '[data-testid="price-field"]'],
    category: ['button[data-testid="category-selector"]', 'input[name="category"]'],
    photoInput: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
    submit: ['button[type="submit"]', 'button:has-text("Publier")', '[data-testid="publish-button"]'],
    renew: ['button:has-text("Relancer")', 'button:has-text("Renouveler")', 'button:has-text("Bump")'],
    delete: ['button:has-text("Supprimer")', '[data-testid="delete-button"]'],
    listingRow: ['[data-testid="item-card"]', 'a[href*="/items/"]'],
  },
};

export function waitFor(selector: string, timeout = 15_000): Promise<Element | null> {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(found);
      }
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

export async function query(candidates: string[], timeout = 15_000): Promise<Element | null> {
  for (const selector of candidates) {
    if (selector.includes(':has-text(')) continue; // syntaxe non native, gérée ci-dessous
    const element = document.querySelector(selector);
    if (element) return element;
  }
  // Les sélecteurs :has-text() ne sont pas supportés partout : fallback manuel.
  const textSelectors = candidates.filter((s) => s.includes(':has-text('));
  for (const selector of textSelectors) {
    const tag = selector.slice(0, selector.indexOf(':has-text(')) || '*';
    const text = selector.match(/:has-text\(["']?([^"')]+)/)?.[1]?.toLowerCase();
    if (!text) continue;
    const found = [...document.querySelectorAll(tag)].find((el) => el.textContent?.toLowerCase().includes(text));
    if (found) return found;
  }
  const native = candidates.filter((s) => !s.includes(':has-text('));
  if (native.length === 0) return null;
  return waitFor(native.join(', '), timeout);
}

/** Attend qu'un texte apparaisse dans la page (SPA à rendu différé). */
export function waitForText(text: string, timeout = 10_000): Promise<void> {
  const needle = text.toLowerCase();
  if ((document.body.innerText ?? '').toLowerCase().includes(needle)) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if ((document.body.innerText ?? '').toLowerCase().includes(needle)) {
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      }
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve();
    }, timeout);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

/** Attend qu'au moins un des sélecteurs apparaisse (pages SPA à rendu différé). */
export function waitForAny(selectors: string[], timeout = 12_000): Promise<void> {
  const joined = selectors.filter((s) => !s.includes(':has-text(')).join(', ');
  if (!joined || document.querySelector(joined)) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.querySelector(joined)) {
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      }
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve();
    }, timeout);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

/** Résumé de la structure de la page, renvoyé quand aucun sélecteur ne correspond. */
export function diagnosePage(): string {
  const links = [...document.querySelectorAll('a[href]')];
  const hrefs = links.map((a) => a.getAttribute('href') ?? '').filter(Boolean);
  const testIds = [
    ...document.querySelectorAll('[data-testid], [data-qa], [data-cy]'),
  ].flatMap((el) => [
    el.getAttribute('data-testid'),
    el.getAttribute('data-qa'),
    el.getAttribute('data-cy'),
  ]);
  const uniqueIds = [...new Set(testIds.filter((v): v is string => Boolean(v)))].slice(0, 25);
  const text = (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400);
  return `url=${location.href}; liens=${links.length}; hrefs=${JSON.stringify(hrefs.slice(0, 12))}; ids=${JSON.stringify(uniqueIds)}; texte=${JSON.stringify(text)}`;
}

/**
 * Comportement « humain » : ~2 s entre chaque action (remplir titre, puis
 * catégorie, puis prix…), avec une légère variabilité.
 */
export const human = {
  /** Pause de ~2 s entre deux actions. */
  async beat(): Promise<void> {
    await this.wait(1_900, 2_100);
  },

  /** Pause de lecture : ~2 s entre chaque action. */
  async read(): Promise<void> {
    await this.wait(1_900, 2_100);
  },

  wait(min: number, max: number): Promise<void> {
    const delay = min + Math.random() * (max - min);
    return new Promise((resolve) => setTimeout(resolve, delay));
  },

  async scroll(element?: Element): Promise<void> {
    if (element) (element as HTMLElement).scrollIntoView({ block: 'center' });
    await this.wait(60, 140);
  },

  /** Relecture rapide : on repasse sur les champs sans traîner. */
  async review(elements: Element[]): Promise<void> {
    for (const element of elements) await this.scroll(element);
  },

  /** Saisie en une fois avec un court délai : réaliste sans être lent. */
  async type(element: Element, value: string): Promise<void> {
    await this.scroll(element);
    // Remplace tout le texte existant (IA du site) au lieu de l'ajouter.
    (element as HTMLElement).focus();
    document.execCommand('selectAll', false);
    setNativeValue(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    await this.beat();
  },
};

function setNativeValue(element: Element, value: string): void {
  if ((element as HTMLElement).isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    return;
  }
  const input = element as HTMLInputElement | HTMLTextAreaElement;
  const prototype =
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function setField(element: Element | null, value: string): Promise<boolean> {
  if (!element) return false;
  if ((element as HTMLElement).isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    return true;
  }
  const input = element as HTMLInputElement | HTMLTextAreaElement;
  const prototype =
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
  return true;
}

export function click(element: Element | null): boolean {
  if (!element) return false;
  (element as HTMLElement).scrollIntoView({ block: 'center' });
  (element as HTMLElement).click();
  return true;
}

/** Télécharge les images en parallèle puis les injecte dans l'input file. */
export async function uploadPhotos(input: Element | null, urls: string[]): Promise<void> {
  if (!input || urls.length === 0) return;
  // Parallèle : évite que le service worker meurt pendant une longue suite de fetch.
  const blobs = await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) return null;
        return await response.blob();
      } catch {
        return null;
      }
    }),
  );
  const transfer = new DataTransfer();
  for (const blob of blobs) {
    if (!blob) continue;
    const name = `photo-${transfer.items.length + 1}.jpg`;
    transfer.items.add(new File([blob], name, { type: blob.type || 'image/jpeg' }));
  }
  if (transfer.items.length === 0) return;
  const fileInput = input as HTMLInputElement;
  fileInput.files = transfer.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function fillCommon(listing: Listing, platform: Platform, autoSubmit: boolean): Promise<JobResult> {
  const s = SELECTORS[platform];
  // Formulaire SPA : on attend que les champs ou le premier bouton d'étape apparaissent.
  await waitForAny([...(s.title ?? []), 'button'], 10_000);
  await human.read();
  const [title, description, price, category] = await Promise.all([
    query(s.title ?? []),
    query(s.description ?? []),
    query(s.price ?? []),
    query(s.category ?? []),
  ]);

  // Case « Livraison » (Leboncoin) : on ne coche que si l'annonce le demande.
  if (listing.delivery) {
    const delivery = await query(
      [
        'input[type="checkbox"][name*="deliver" i]',
        '[data-testid*="delivery" i] input[type="checkbox"]',
        'label:has-text("Livraison") input[type="checkbox"]',
      ],
      2_000,
    );
    if (delivery && !(delivery as HTMLInputElement).checked) click(delivery);
  }

  const missing: string[] = [];
  const filled: Element[] = [];
  const fill = async (element: Element | null, value: string, label: string) => {
    if (!element) {
      missing.push(label);
      return;
    }
    await human.type(element, value);
    filled.push(element);
  };

  await fill(title, listing.title, 'titre');
  await fill(description, listing.description, 'description');
  await fill(price, String(listing.price), 'prix');
  if (listing.category) await fill(category, listing.category, 'catégorie');

  if (missing.length > 0) {
    const inputs = [...document.querySelectorAll('input, textarea')]
      .map((el) => `${el.tagName.toLowerCase()}[name="${el.getAttribute('name') ?? ''}"][placeholder="${el.getAttribute('placeholder') ?? ''}"][data-testid="${el.getAttribute('data-testid') ?? ''}"]`)
      .slice(0, 25);
    const buttons = [...document.querySelectorAll('button')]
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 20);
    const text = (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300);
    return {
      ok: false,
      error: `Champs introuvables (${missing.join(', ')}) — url=${location.href} — champs=[${JSON.stringify(inputs)}] — boutons=[${JSON.stringify(buttons)}] — texte=${JSON.stringify(text)}`,
    };
  }

  // Photos : téléchargement + injection dans l'input file (dépôt d'annonce).
  if (listing.images.length > 0) {
    const photoInput = await query(s.photoInput ?? [], 4_000);
    await uploadPhotos(photoInput, listing.images);
  }

  // Relecture simulée : on parcourt les champs comme quelqu'un qui vérifie.
  await human.review(filled);
  if (autoSubmit) {
    const submit = await query(s.submit ?? [], 5_000);
    await human.read();
    if (!click(submit)) return { ok: false, error: 'Bouton de publication introuvable' };
  }
  return {
    ok: true,
    url: location.href,
    adId: new URL(location.href).searchParams.get('id') ?? undefined,
  };
}

async function execute(job: Job, adapter: Adapter): Promise<JobResult> {
  const payload = job.payload as { listing?: Listing; autoSubmit?: boolean };
  const listing = payload.listing;
  try {
    if (job.type === 'publish') {
      if (!listing) return { ok: false, error: 'Données d’annonce manquantes dans la tâche' };
      const result = await adapter.publish(listing, payload.autoSubmit ?? false);
      return result;
    }
    if (job.type === 'renew') return adapter.renew(job);
    if (job.type === 'pause') return adapter.pause(job);
    if (job.type === 'delete') return adapter.remove(job);
    if (job.type === 'sync') return adapter.sync();
    if (job.type === 'enrich') return adapter.enrich(job);
    if (job.type === 'refresh') return adapter.refresh(job);
    if (job.type === 'check') return adapter.check(job);
    return { ok: false, error: `Type de tâche inconnu: ${String(job.type)}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Point d'entrée commun : récupère et exécute les tâches confiées par le background. */
export function bootstrap(adapter: Adapter): void {
  let running = false;

  async function run(job: Job): Promise<void> {
    if (running) return;
    running = true;
    console.log('[FluxLibre] tâche reçue:', job.type, job.platform);
    try {
      const result = await Promise.race([
        execute(job, adapter),
        new Promise<JobResult>((resolve) =>
          setTimeout(() => resolve({ ok: false, error: `Timeout global — dernière étape: ${lastStep}` }), 60_000),
        ),
      ]);
      console.log('[FluxLibre] résultat:', result);
      // On garde une copie du résultat : si le background est en redémarrage,
      // il le récupérera au prochain poll.
      const data = await chrome.storage.local.get('fluxlibre_results');
      const results = (data['fluxlibre_results'] as Record<string, unknown> | undefined) ?? {};
      results[job.id] = result;
      await chrome.storage.local.set({ fluxlibre_results: results });

      await Promise.race([
        chrome.runtime.sendMessage({ type: 'FLUXLIBRE_JOB_RESULT', jobId: job.id, result }).catch(() => undefined),
        new Promise((r) => setTimeout(r, 5_000)),
      ]);
    } catch (error) {
      await Promise.race([
        chrome.runtime.sendMessage({
          type: 'FLUXLIBRE_JOB_RESULT',
          jobId: job.id,
          result: { ok: false, error: error instanceof Error ? error.message : String(error) },
        }).catch(() => undefined),
        new Promise((r) => setTimeout(r, 5_000)),
      ]);
    } finally {
      running = false;
    }
  }

  // Le background livre la tâche par message direct à CE content script.
  // Plus de lecture depuis le stockage (source d'anciens scripts périmés).
  void chrome.runtime.sendMessage({ type: 'FLUXLIBRE_READY', platform: adapter.platform }).catch(() => undefined);

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return;
    if ((message as { type?: string }).type !== 'RUN_JOB') return;
    const job = (message as { job?: Job }).job;
    if (!job || job.platform !== adapter.platform || running) {
      sendResponse({ received: false });
      return;
    }
    sendResponse({ received: true });
    void run(job);
    return true;
  });
}

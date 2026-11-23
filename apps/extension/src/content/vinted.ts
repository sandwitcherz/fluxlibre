import type { JobResult } from '@fluxlibre/shared';
import {
  bootstrap,
  click,
  diagnosePage,
  human,
  fillCommon,
  query,
  SELECTORS,
  waitForAny,
  type Adapter,
} from './base';

const s = SELECTORS.vinted;

const adapter: Adapter = {
  platform: 'vinted',

  async publish(listing, autoSubmit) {
    return fillCommon(listing, 'vinted', autoSubmit);
  },

  async pause() {
    return { ok: false, error: 'Mise en pause Vinted à implémenter' };
  },

  async renew(job) {
    const button = await query(s.renew ?? [], 10_000);
    if (!click(button)) return { ok: false, error: 'Bouton « Relancer / Bump » introuvable sur Vinted' };
    return { ok: true, url: location.href, adId: String(job.payload['adId'] ?? '') || undefined };
  },

  async remove() {
    const button = await query(s.delete ?? [], 10_000);
    if (!click(button)) return { ok: false, error: 'Bouton « Supprimer » introuvable sur Vinted' };
    await new Promise((r) => setTimeout(r, 400));
    click(await query(['button:has-text("Confirmer")', '[data-testid="confirm-button"]'], 2_000));
    return { ok: true };
  },

  async enrich(job): Promise<JobResult> {
    await waitForAny(['img[src*="vinted" i]', '[class*="gallery" i]'], 12_000);
    await human.scroll();
    await human.read();

    const urls = new Set<string>();
    for (const img of document.querySelectorAll('img')) {
      for (const attr of ['src', 'data-src', 'srcset']) {
        const value = img.getAttribute(attr);
        if (!value) continue;
        for (const candidate of value.split(/[\s,]+/)) {
          if (/^https?:\/\//.test(candidate) && /vinted|cloudfront|akamaized/.test(candidate)) {
            urls.add(candidate.split('?')[0] ?? candidate);
          }
        }
      }
    }
    const description = [...document.querySelectorAll('[data-testid*="description" i], [class*="description" i]')]
      .map((el) => (el.textContent ?? '').trim())
      .find((text) => text.length > 40);

    return {
      ok: true,
      adId: String(job.payload['adId'] ?? '') || undefined,
      url: location.href,
      data: { images: [...urls].slice(0, 40), description: description ?? null },
    };
  },

  async refresh() {
    return { ok: false, error: 'Mise à jour Vinted à implémenter' };
  },

  async check() {
    return { ok: false, error: 'Vérification Vinted à implémenter' };
  },

  async sync(): Promise<JobResult> {
    await waitForAny(s.listingRow ?? [], 12_000);
    const rows = [...new Set((s.listingRow ?? []).flatMap((selector) => [...document.querySelectorAll(selector)]))];
    if (rows.length === 0) {
      return { ok: false, error: `Aucune annonce trouvée — ${diagnosePage()}` };
    }
    const data = rows
      .map((row) => {
        const link = row.closest('a') ?? row.querySelector('a');
        const href = link?.getAttribute('href') ?? '';
        return {
          adId: href.match(/\/items\/(\d+)/)?.[1] ?? null,
          title: (row.textContent ?? '').trim().slice(0, 200),
          url: href.startsWith('http') ? href : `https://www.vinted.fr${href}`,
        };
      })
      .filter((item) => item.adId);
    return { ok: true, data };
  },
};

bootstrap(adapter);

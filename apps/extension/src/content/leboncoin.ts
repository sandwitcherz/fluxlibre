import type { JobResult } from '@fluxlibre/shared';
import {
  bootstrap,
  click,
  diagnosePage,
  human,
  fillCommon,
  query,
  setStep,
  uploadPhotos,
  SELECTORS,
  waitForAny,
  waitForText,
  type Adapter,
} from './base';

const s = SELECTORS.leboncoin;

/** Clique sur le bouton d'action dans la carte dont le titre correspond. */
async function cardAction(
  job: Parameters<Adapter['renew']>[0],
  pattern: RegExp,
  selectors: string[],
  label: string,
): Promise<JobResult> {
  const listing = (job.payload['listing'] as { title?: string } | undefined)?.title ?? '';
  const titleKey = listing.replace(/\s+/g, ' ').trim().slice(0, 30).toLowerCase();

  // Ferme un menu/panneau latéral ouvert qui masquerait les cartes.
  const closeMenu = document.querySelector<HTMLElement>(
    '[aria-label*="fermer" i], [aria-label*="close" i], button[title="Fermer"]',
  );
  if (closeMenu && document.body.innerText?.includes('Déposer une annonce')) {
    click(closeMenu);
    await new Promise((r) => setTimeout(r, 300));
  }

  // La liste est rendue par une SPA : on attend que les cartes soient présentes.
  await waitForAny(['a[href*="/ad/"]'], 12_000);
  await human.read();
  const links = [...document.querySelectorAll('a[href*="/ad/"]')];
  const link = titleKey
    ? links.find((a) => (a.textContent ?? '').replace(/\s+/g, ' ').toLowerCase().includes(titleKey))
    : undefined;
  let card: Element | null = link ?? null;
  for (let i = 0; i < 6 && card?.parentElement; i += 1) {
    card = card.parentElement;
    if (card.querySelector('button') && pattern.test(card.textContent ?? '')) break;
  }
  const buttons = [...(card?.querySelectorAll('button') ?? [])];
  const button = buttons.find((b) => pattern.test(b.textContent ?? '')) ?? (await query(selectors, 8_000));

  await human.scroll(button ?? undefined);
  await human.read();
  if (!click(button)) {
    const buttons = [...document.querySelectorAll('button')]
      .map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 20);
    return {
      ok: false,
      error: `Bouton « ${label} » introuvable — boutons=[${JSON.stringify(buttons)}] titre=${JSON.stringify(titleKey)}`,
    };
  }
  await human.read();
  return { ok: true, url: location.href, adId: String(job.payload['adId'] ?? '') || undefined };
}

const adapter: Adapter = {
  platform: 'leboncoin',

  async publish(listing, autoSubmit) {
    // Formulaire Leboncoin en assistant multi-étapes.
    setStep('publish/attente-titre');
    console.log('[FluxLibre] publish: étape 1 — attente du titre');
    await waitForAny(['input[name="subject"]'], 12_000);
    await human.read();

    const missing: string[] = [];
    const titleInput = document.querySelector<HTMLInputElement>('input[name="subject"]');
    setStep('publish/frappe-titre');
    if (titleInput) {
      await human.type(titleInput, listing.title);
      const valueAfter = titleInput.value;
      if (!valueAfter) {
        missing.push(`titre (disabled=${titleInput.disabled}, readonly=${titleInput.readOnly}, type=${titleInput.type})`);
      }
    } else missing.push('titre');

    // Catégorie suggérée : on attend que les suggestions soient rendues.
    if (listing.category) {
      await waitForText('Choisissez une catégorie suggérée', 10_000);
      // Leboncoin affiche l'option comme <p><span>Catégorie</span>…<span>Sous-catégorie</span></p>
      // (ex. « Électronique › Ordinateurs », « Loisirs › Sport & Plein air »).
      // On cherche simplement le <p> dont le texte contient la catégorie voulue.
      const key = listing.category.toLowerCase().slice(0, 8);
      const paragraph = [...document.querySelectorAll('p')].find((p) => {
        const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
        return text.includes(key);
      });
      const target: Element | null = paragraph?.parentElement ?? paragraph ?? null;
      if (target) {
        await human.scroll(target);
        await human.beat();
        click(target);
        await new Promise((r) => setTimeout(r, 250));
        // Vérification : si l'indicateur reste unchecked, on clique le span interne.
        const indicator = target.querySelector<HTMLElement>('[data-state="unchecked"]');
        if (indicator) click(indicator);
      } else {
        return { ok: false, error: `Catégorie « ${listing.category} » introuvable après rendu` };
      }
    }

    // Étape 1 → 2 : clic « Continuer » pour arriver à l'étape photo.
    const nextStep = async () => {
      const button = [...document.querySelectorAll('button')].find(
        (b) => /continuer|suivant|valider/i.test(b.textContent ?? '') && !(b as HTMLButtonElement).disabled,
      );
      if (button) {
        await human.scroll(button);
        await human.read();
        click(button);
        await human.read();
        await new Promise((r) => setTimeout(r, 300));
      }
      return Boolean(button);
    };

    setStep('publish/clic-continuer-1');
    console.log('[FluxLibre] publish: étape 1 terminée');
    await nextStep();

    // Étape 2 (photos) : le bouton « Importer » déclenche un input file caché.
    setStep('publish/photos');
    console.log('[FluxLibre] publish: étape photos —', listing.images.length, 'à importer');
    if (listing.images.length > 0) {
      // L'input file est créé quand l'étape photo est rendue : on l'attend.
      await waitForAny(['input[type="file"]'], 8_000);
      let fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!fileInput) {
        // Repli : clic sur « Importer » puis injection sur l'input apparu.
        const importer = document.querySelector('span[data-spark-component="file-upload-trigger"]');
        if (importer) {
          click(importer);
          await waitForAny(['input[type="file"]'], 5_000);
          fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
        }
      }
      if (fileInput) await uploadPhotos(fileInput, listing.images);
      else console.warn('[FluxLibre] input file introuvable à l’étape photo');
    }

    // Étape 3 (détails) : « État » est requis — valeur par défaut « Bon état ».
    setStep('publish/details-etat');
    await waitForText('État', 5_000);
    const etatCombobox = document.querySelector<HTMLInputElement>(
      'input[data-spark-component="combobox-input"][role="combobox"]',
    );
    if (etatCombobox) {
      await human.scroll(etatCombobox);
      // Ouvre le sélecteur (le champ est en lecture seule : on ne tape pas dedans).
      click(etatCombobox);
      await waitForText('Bon état', 4_000);
      // L'option apparaît dans une liste (role="option", li ou button).
      const option = [...document.querySelectorAll('[role="option"], li, button')].find((el) =>
        /^bon état$/i.test((el.textContent ?? '').trim()),
      );
      if (option) {
        await human.beat();
        click(option);
        await new Promise((r) => setTimeout(r, 300));
      }
      // Dernier repli : setter natif + événements React.
      if (!/bon état/i.test(etatCombobox.value)) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(etatCombobox, 'Bon état');
        etatCombobox.dispatchEvent(new Event('input', { bubbles: true }));
        etatCombobox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // Étape 3 → 4 : « Continuer » vers description / prix.
    setStep('publish/clic-continuer-2');
    await nextStep();

    setStep('publish/description-prix');
    console.log('[FluxLibre] publish: étape description/prix');
    const descriptionInput =
      document.querySelector<HTMLTextAreaElement>('textarea[name="body"]') ??
      document.querySelector<HTMLElement>('[contenteditable="true"]');
    const priceInput = document.querySelector<HTMLInputElement>('input[name="price"]');
    if (descriptionInput) await human.type(descriptionInput, listing.description);
    let finalPrice: string | null = null;
    if (priceInput) {
      const target = String(listing.price);
      const ensurePrice = async (label: string) => {
        const current = priceInput.value.replace(/[\s€]/g, '');
        if (current !== target) {
          console.log(`[FluxLibre] prix corrigé (${label}): ${current} -> ${target}`);
          await human.type(priceInput, target);
        }
        finalPrice = priceInput.value.replace(/[\s€]/g, '');
      };

      await human.type(priceInput, target);
      // L'IA de Leboncoin écrase le prix à des délais variables : on vérifie
      // à 1,2 s, 3,5 s et 6 s, puis juste avant de quitter l'étape.
      await new Promise((r) => setTimeout(r, 1_200));
      await ensurePrice('1.2s');
      await new Promise((r) => setTimeout(r, 2_300));
      await ensurePrice('3.5s');
      await new Promise((r) => setTimeout(r, 2_500));
      await ensurePrice('6s');
    }

    // Adresse de remise du bien : champ « Adresse » avec autocomplétion.
    if (listing.address) {
      const addressInput =
        document.querySelector<HTMLInputElement>('input[placeholder*="Adresse" i]') ??
        document.querySelector<HTMLInputElement>('input[name="address"]') ??
        [...document.querySelectorAll<HTMLInputElement>('input[type="text"]')].find((i) =>
          /adresse/i.test(i.getAttribute('placeholder') ?? ''),
        );
      if (addressInput) {
        await human.scroll(addressInput);
        await human.type(addressInput, listing.address);
        await new Promise((r) => setTimeout(r, 500));
        // Choisir la première suggestion d'adresse.
        const suggestion = [...document.querySelectorAll('[role="option"], li, button')].find((el) =>
          (el.textContent ?? '').toLowerCase().includes(listing.address!.toLowerCase().split('(')[0]!.trim().slice(0, 5)),
        );
        if (suggestion) click(suggestion);
      }
    }

    // Livraison : décocher « Activer la livraison » si l'annonce n'était pas en livraison.
    if (!listing.delivery) {
      await waitForText('Activer la livraison', 6_000);
      const toggle = [...document.querySelectorAll('input[type="checkbox"], [role="checkbox"], button')].find((el) => {
        const label = el.closest('label')?.textContent ?? el.getAttribute('aria-label') ?? '';
        return /activer la livraison/i.test(label);
      });
      if (toggle && (toggle as HTMLInputElement).checked !== false) {
        const state = toggle.getAttribute('aria-checked') ?? String((toggle as HTMLInputElement).checked);
        if (state === 'true' || (toggle as HTMLInputElement).checked) {
          await human.beat();
          click(toggle);
        }
      }
    }

    // Dernière vérification du prix avant de quitter le formulaire.
    if (priceInput && finalPrice !== String(listing.price)) {
      await human.type(priceInput, String(listing.price));
      finalPrice = priceInput.value.replace(/[\s€]/g, '');
    }
    console.log('[FluxLibre] prix final dans le formulaire:', finalPrice, '| attendu:', listing.price);

    // Étape livraison : cliquer « Continuer » pour arriver à l'écran de validation.
    setStep('publish/etape-livraison');
    await waitForText('En livraison', 6_000);
    const livraisonContinue = [...document.querySelectorAll('button')].find((b) =>
      /^continuer$/i.test((b.textContent ?? '').replace(/\s+/g, ' ').trim()) && !(b as HTMLButtonElement).disabled,
    );
    if (livraisonContinue) {
      await human.scroll(livraisonContinue);
      await human.read();
      click(livraisonContinue);
      await new Promise((r) => setTimeout(r, 600));
    }

    // Écran « Boostez votre annonce ! » : le dernier bouton est « Déposer sans booster mon annonce ».
    setStep('publish/ecran-boost');
    await waitForText('Boostez votre annonce', 6_000);
    if (autoSubmit) {
      const finalButton = [...document.querySelectorAll('button')].find((b) =>
        /déposer sans booster mon annonce/i.test(b.textContent ?? ''),
      );
      if (finalButton) {
        await human.read();
        click(finalButton);
        await new Promise((r) => setTimeout(r, 1_200));
      }

      // Modale de feedback « Parlez-nous de votre expérience » (inconstante).
      const feedback = [...document.querySelectorAll('*')].some((el) =>
        el.children.length === 0 && /Parlez-nous de votre expérience/i.test(el.textContent ?? ''),
      );
      if (feedback) {
        const neutre = [...document.querySelectorAll('input[type="radio"], label, button')].find((el) =>
          /^neutre$/i.test((el.textContent ?? '').replace(/\s+/g, ' ').trim()),
        );
        if (neutre) {
          await human.beat();
          click(neutre);
          await new Promise((r) => setTimeout(r, 300));
        }
        const suivant = [...document.querySelectorAll('button')].find((b) =>
          /^suiv/i.test((b.textContent ?? '').replace(/\s+/g, ' ').trim()),
        );
        if (suivant) {
          await human.beat();
          click(suivant);
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }

    setStep('publish/terminé');
    console.log('[FluxLibre] publish: terminé —', autoSubmit ? 'déposé automatiquement' : 'en attente de validation manuelle');
    if (missing.length > 0) {
      const buttons = [...document.querySelectorAll('button')]
        .map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 20);
      return { ok: false, error: `Formulaire — manquants=[${missing.join(', ')}] boutons=[${JSON.stringify(buttons)}]` };
    }

    // Le dépôt final (« Déposer sans booster mon annonce ») a déjà été cliqué
    // plus haut en mode auto : ne pas re-cliquer un « Publier » inexistant.
    return { ok: true, url: location.href, data: { finalPrice } };
  },

  async renew(job) {
    return cardAction(job, /Réactiver|Renouveler/i, s.renew ?? [], 'Réactiver l’annonce');
  },

  async pause(job) {
    return cardAction(job, /Mettre en pause/i, s.pause ?? [], 'Mettre en pause');
  },

  async remove(job) {
    const result = await cardAction(job, /Supprimer/i, s.delete ?? [], 'Supprimer');
    if (!result.ok) return result;
    // Modale de confirmation « Supprimer l'annonce » : attendre son rendu puis cliquer « Valider ».
    await waitForText('Supprimer l’annonce', 5_000);
    await waitForText('Valider', 5_000);
    const confirm = [...document.querySelectorAll('button')].find((b) =>
      /^valider$/i.test((b.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    if (confirm) {
      await human.scroll(confirm);
      await human.beat();
      click(confirm);
      await new Promise((r) => setTimeout(r, 700));
    }

    // Deuxième modale : « Pourquoi supprimez-vous cette annonce ? » → cocher « Autre » puis Valider.
    await waitForText('Pourquoi supprimez-vous cette annonce', 5_000);
    const autre = [...document.querySelectorAll('button, label, [role="radio"]')].find((el) =>
      /^autre$/i.test((el.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    if (autre) {
      await human.scroll(autre);
      await human.beat();
      click(autre);
      await new Promise((r) => setTimeout(r, 250));
    }
    const finalConfirm = [...document.querySelectorAll('button')].find((b) =>
      /^valider$/i.test((b.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    if (finalConfirm) {
      await human.beat();
      click(finalConfirm);
      await new Promise((r) => setTimeout(r, 700));
    }
    await human.read();
    return result;
  },

  async enrich(job): Promise<JobResult> {
    // Attend le rendu de la galerie photo.
    await waitForAny(['img[src*="lbcpb1"]', '[data-testid*="gallery" i]', '[class*="gallery" i]'], 12_000);
    // Petit parcours visuel avant de lire la galerie.
    await human.scroll();
    await human.scroll();
    await human.read();

    // UNIQUEMENT les images de l'annonce : Leboncoin marque les vignettes de la
    // galerie avec un alt du type « Titre (image 1) », « Titre (image 2) »…
    // Les pubs, logos et moyens de paiement n'ont pas ce marqueur.
    const galleryImages = [...document.querySelectorAll('img')].filter((img) =>
      /\(\s*image\s+\d+\s*\)/i.test(img.getAttribute('alt') ?? ''),
    );

    const urls = new Set<string>();
    for (const img of galleryImages) {
      for (const attr of ['src', 'data-src', 'srcset']) {
        const value = img.getAttribute(attr);
        if (!value) continue;
        for (const candidate of value.split(/[\s,]+/)) {
          if (/^https?:\/\/img\.leboncoin\.fr\/api\/v1\/lbcpb1\//.test(candidate)) {
            // On garde le paramètre `rule` : sans lui, Leboncoin renvoie 400.
            urls.add(candidate);
          }
        }
      }
    }
    // L'image principale (alt vide, rule=ad-thumb) peut ne pas être dans la galerie.
    const primary = document.querySelector<HTMLImageElement>('img[src*="rule=ad-thumb"]');
    if (primary) {
      const src = primary.getAttribute('src');
      if (src?.includes('/api/v1/lbcpb1/')) urls.add(src);
    }

    const images = [...urls].slice(0, 20);

    const description =
      (document.querySelector('[data-qa-id="adview_description_container"]')?.textContent ?? '')
        .replace(/Voir plus$/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || null;

    // Catégorie depuis le fil d'Ariane : les liens de catégorie ont un href
    // contenant /c/ ou /@/ ; on exclut les liens d'accessibilité et la nav.
    const categoryLinks = [...document.querySelectorAll('a[href]')].filter((a) => {
      const href = a.getAttribute('href') ?? '';
      const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
      return (
        text.length > 2 &&
        !/aller au contenu|accueil|leboncoin|déposer|recherche|favoris|messages/i.test(text) &&
        (href.includes('/c/') || href.includes('/@/') || /^https?:\/\/www\.leboncoin\.fr\/[^/]+/.test(href))
      );
    });
    const category = categoryLinks[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

    // Description nettoyée : on garde uniquement le texte de la description,
    // pas le prix ni les infos de la page.
    const cleanDescription = description
      ? description
          .split(/\n|\s{2,}/)
          .map((line) => line.trim())
          .filter((line) => line && !/€|Baisse de prix|Transaction|Payez en|simulation|il y a|à La Grande-Motte/i.test(line))
          .join("\n")
          .slice(0, 5000)
      : null;

    return {
      ok: true,
      adId: String(job.payload['adId'] ?? '') || undefined,
      url: location.href,
      data: {
        images,
        description: cleanDescription || null,
        delivery: /livraison/i.test(document.body.innerText ?? ''),
        category,
      },
    };
  },

  async check(job): Promise<JobResult> {
    const text = document.body.innerText ?? '';
    const pending = /en cours de vérification|en cours de modération|vérification en cours/i.test(text);
    const introuvable = /annonce introuvable|annonce désactivée|cette annonce n'est plus/i.test(text);
    return {
      ok: true,
      adId: String(job.payload['adId'] ?? '') || undefined,
      url: location.href,
      data: { status: introuvable ? 'missing' : pending ? 'pending' : 'published' },
    };
  },

  async refresh(job): Promise<JobResult> {
    await waitForAny(['[data-qa-id*="description" i], [class*="description" i], h1'], 12_000);

    // Ouvrir la galerie complète si un bouton « Voir les N photos » est présent.
    const viewAll = [...document.querySelectorAll('button')].find((b) =>
      /voir les \d+ photos/i.test(b.textContent ?? ''),
    );
    const expectedCount = Number(viewAll?.textContent?.match(/(\d+)/)?.[1] ?? 0);
    if (viewAll) {
      click(viewAll);
      await new Promise((r) => setTimeout(r, 700));
    }

    // La galerie se remplit progressivement : on attend que le nombre
    // d'images soit stable avant de les collecter.
    let count = -1;
    for (let i = 0; i < 15; i += 1) {
      const next = document.querySelectorAll('img[alt*="(image"]').length;
      if (next === count && next > 0) break;
      count = next;
      await new Promise((r) => setTimeout(r, 400));
    }

    // Photos de la galerie (marqueur « (image N) »).
    const gallery = [...document.querySelectorAll('img')].filter((img) =>
      /\(\s*image\s+\d+\s*\)/i.test(img.getAttribute('alt') ?? ''),
    );
    const seen = new Set<string>();
    const imagesList: string[] = [];
    for (const img of gallery) {
      for (const attr of ['src', 'data-src', 'srcset']) {
        const value = img.getAttribute(attr);
        if (!value) continue;
        for (const c of value.split(/[\s,]+/)) {
          if (/^https?:\/\/img\.leboncoin\.fr\/api\/v1\/lbcpb1\//.test(c)) {
            // Déduplique par hash mais garde l'URL complète (le paramètre
            // `rule` est obligatoire, sinon Leboncoin renvoie 400).
            const hash = c.split('?')[0] ?? c;
            if (!seen.has(hash)) {
              seen.add(hash);
              imagesList.push(c);
            }
          }
        }
      }
    }
    // Description : UNIQUEMENT le conteneur dédié de l'annonce.
    // (adview_spotlight_description_container contient prix/date : on l'exclut)
    const descEl = document.querySelector('[data-qa-id="adview_description_container"]');
    const description = descEl
      ? (descEl.textContent ?? '')
          .replace(/Voir plus$/i, '')
          .replace(/\s{2,}/g, ' ')
          .trim() || null
      : null;

    // Prix : le <p> de classe « text-headline-2 » (prix principal de l'annonce).
    const priceText = document
      .querySelector('p.text-headline-2')
      ?.textContent?.match(/(\d[\d\s.,]*)\s*€/)?.[1]
      ?.replace(/\s/g, '')
      .replace(',', '.');
    const price = priceText ? Number(priceText) : null;

    // Catégorie : 2e lien du fil d'Ariane (après Accueil) ou lien de catégorie.
    const categoryLink = [...document.querySelectorAll('a[href]')].find((a) => {
      const href = a.getAttribute('href') ?? '';
      const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
      return text.length > 2 && !/accueil|aller au contenu|leboncoin|déposer/i.test(text) && /\/c\/|\/@\//.test(href);
    });
    // Adresse : texte « À <ville> <code> » ou « <ville> <code> » dans la page.
    const addressMatch = (document.body.innerText ?? '').match(/À\s+([A-Za-zÀ-ÿ'’\-]+\s+\d{5})/);

    return {
      ok: true,
      adId: String(job.payload['adId'] ?? '') || undefined,
      url: location.href,
      data: {
        images: imagesList.slice(0, expectedCount || 20),
        description: description ?? null,
        price,
        category: categoryLink?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
        address: addressMatch?.[1] ?? null,
        // Vrai badge « Livraison » (élément court), pas le texte générique de la page.
        delivery: [...document.querySelectorAll('span, p')].some((el) =>
          el.children.length === 0 && /^livraison$/i.test((el.textContent ?? '').trim()),
        ),
      },
    };
  },

  async sync(): Promise<JobResult> {
    await waitForAny(s.listingRow ?? [], 12_000);
    const links = [
      ...new Set([...document.querySelectorAll('a[href*="/ad/"]')].filter((a) => /\/\d+/.test(a.getAttribute('href') ?? ''))),
    ];
    if (links.length === 0) {
      return { ok: false, error: `Aucune annonce trouvée — ${diagnosePage()}` };
    }
    const data = links.map((link) => {
      const href = link.getAttribute('href') ?? '';
      const url = href.startsWith('http') ? href : `https://www.leboncoin.fr${href}`;
      // Remonte jusqu'au conteneur qui contient à la fois l'IMAGE et le PRIX :
      // c'est le niveau de la carte complète (les niveaux internes n'ont que les boutons).
      let card: Element | null = link;
      for (let i = 0; i < 10 && card?.parentElement; i += 1) {
        card = card.parentElement;
        const t = card.textContent ?? '';
        if (card.querySelector('img') && /€/.test(t)) break;
      }
      const text = (card?.textContent ?? link.textContent ?? '').replace(/\s+/g, ' ');
      // Le DOM contient deux versions du titre (desktop + mobile) : l'attribut title est la bonne.
      const title =
        link.querySelector('p[title]')?.getAttribute('title') ??
        (link.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      // Le prix est dans un élément dédié : on le cherche d'abord directement,
      // puis on retombe sur le texte de la carte.
      const priceElement = [...(card?.querySelectorAll('p, span, div') ?? [])].find((el) => {
        const value = (el.textContent ?? '').trim();
        return el.children.length === 0 && /^\d[\d\s.,]*\s*€$/.test(value);
      });
      const priceText =
        (priceElement?.textContent ?? '').match(/(\d[\d\s.,]*)\s*€/)?.[1] ??
        text.match(/(\d[\d\s.,]*)\s*€/)?.[1] ??
        null;
      const price = priceText ? priceText.replace(/\s/g, '').replace(',', '.') : null;
      const img = card?.querySelector('img');
      const image =
        img?.getAttribute('src') ??
        img?.getAttribute('data-src') ??
        img?.getAttribute('data-lazy-src') ??
        img?.getAttribute('srcset')?.split(' ')[0] ??
        null;
      // Catégorie : chercher un élément feuille dont le texte EST une catégorie
      // connue, à côté de « Créée… ». Jamais de texte de carte entier.
      const CATEGORIES = [
        'Accessoires informatique', 'Ordinateurs', 'Consoles', 'Jeux vidéo',
        'Photo, audio & vidéo', 'Sport & Plein air', 'Instruments de musique',
        'Mode', 'Maison & Jardin', 'Véhicules', 'Immobilier', 'Loisirs',
        'Électroménager', 'High-Tech', 'Matériel pro', 'Famille',
      ];
      const categoryElement = [...(card?.querySelectorAll('p, span, div') ?? [])].find((el) => {
        if (el.children.length) return false;
        const v = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        return CATEGORIES.some((c) => c.toLowerCase() === v.toLowerCase());
      });
      const category = categoryElement?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      const paused = /réactiver l['’]annonce|annonce mise en pause/i.test(text);
      const delivery = /livraison/i.test(text);
      return {
        adId: href.match(/\/ad\/[^/]+\/(\d+)/)?.[1] ?? href.match(/\/ad\/(\d+)/)?.[1] ?? null,
        title,
        url,
        price: price ? Number(price) : null,
        image,
        category,
        status: paused ? 'paused' : 'published',
        delivery,
      };
    });
    return { ok: true, data };
  },
};

bootstrap(adapter);

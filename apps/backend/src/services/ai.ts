import type { AiGenerateRequest, AiGenerateResponse, Platform } from '@fluxlibre/shared';
import { getConfig } from '../config.js';

const PLATFORM_HINTS: Record<Platform, string> = {
  leboncoin:
    'Leboncoin (France) : titre clair et factuel, mots-clés locaux, description simple avec état, dimensions et raison de la vente. Pas de marketing excessif.',
  vinted:
    'Vinted (mode seconde main) : titre court avec marque + modèle + taille, description avec état précis, matière, mesures et hashtags pertinents.',
};

function systemPrompt(platform: Platform, tone: string): string {
  return [
    'Tu es un rédacteur expert d’annonces de revente en ligne.',
    `Plateforme cible : ${PLATFORM_HINTS[platform]}.`,
    `Ton : ${tone || 'neutre et confiant'}.`,
    'Réponds uniquement avec un objet JSON valide, sans texte autour, avec exactement les clés :',
    '{"title": string, "description": string, "tags": string[]}.',
    'Le titre doit respecter les usages de la plateforme. La description doit être informative et honnête.',
    'Ne invente jamais de caractéristique absente des informations fournies.',
  ].join('\n');
}

function userPrompt(input: AiGenerateRequest): string {
  return [
    `Titre actuel : ${input.title ?? '(aucun)'}`,
    `Catégorie : ${input.category ?? '(aucune)'}`,
    `Description actuelle : ${input.description ?? '(aucune)'}`,
  ].join('\n');
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Réponse IA invalide : aucun objet JSON trouvé');
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

function normalize(value: unknown): AiGenerateResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Réponse IA invalide');
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.title !== 'string' || typeof obj.description !== 'string') {
    throw new Error('Réponse IA invalide : title/description manquants');
  }
  const tags = Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [];
  return { title: obj.title, description: obj.description, tags };
}

async function callProvider(system: string, user: string): Promise<string> {
  const config = getConfig();
  if (config.aiProvider === 'none') {
    throw new Error('Aucun fournisseur IA configuré. Régle aiProvider dans /api/config.');
  }
  if (config.aiProvider === 'ollama') {
    const base = config.aiBaseUrl || 'http://localhost:11434';
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.aiModel || 'llama3.1',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
        format: 'json',
      }),
    });
    if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
    const data = (await response.json()) as { message?: { content?: string } };
    return data.message?.content ?? '';
  }
  if (config.aiProvider === 'gemini') {
    if (!config.aiApiKey) throw new Error('Clé API Gemini manquante (FLUXLIBRE_AI_KEY).');
    const model = config.aiModel || 'gemini-2.0-flash';
    const response = await fetch(
      `${config.aiBaseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(config.aiApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
        }),
      },
    );
    if (!response.ok) throw new Error(`Gemini ${response.status}: ${await response.text()}`);
    const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  }
  if (config.aiProvider === 'groq') {
    if (!config.aiApiKey) throw new Error('Clé API Groq manquante (FLUXLIBRE_AI_KEY).');
    const response = await fetch(`${config.aiBaseUrl || 'https://api.groq.com/openai'}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.aiApiKey}`,
      },
      body: JSON.stringify({
        model: config.aiModel || 'llama-3.3-70b-versatile',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Groq ${response.status}: ${await response.text()}`);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }
  if (config.aiProvider === 'anthropic') {
    if (!config.aiApiKey) throw new Error('Clé API Anthropic manquante (FLUXLIBRE_AI_KEY).');
    const response = await fetch(`${config.aiBaseUrl || 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.aiApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.aiModel || 'claude-3-5-haiku-latest',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic ${response.status}: ${await response.text()}`);
    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    return (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  }
  if (!config.aiApiKey) throw new Error('Clé API OpenAI manquante (FLUXLIBRE_AI_KEY).');
  const response = await fetch(`${config.aiBaseUrl || 'https://api.openai.com'}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.aiApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiModel || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

export async function generateListing(input: AiGenerateRequest): Promise<AiGenerateResponse> {
  const platform = input.platform ?? 'leboncoin';
  const text = await callProvider(systemPrompt(platform, input.tone ?? ''), userPrompt(input));
  return normalize(extractJson(text));
}

/** Génère les variantes pour les deux plateformes en parallèle. */
export async function generateBoth(input: AiGenerateRequest): Promise<Record<Platform, AiGenerateResponse>> {
  const [leboncoin, vinted] = await Promise.all([
    generateListing({ ...input, platform: 'leboncoin' }),
    generateListing({ ...input, platform: 'vinted' }),
  ]);
  return { leboncoin, vinted };
}

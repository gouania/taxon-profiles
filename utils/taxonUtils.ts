import { ComparisonData, Mode, TaxonData } from '../types';
import { sanitizeSources } from './sanitize';

export const CACHE_VERSION = 2;
export const CACHE_PREFIX = 'taxon_profile_cache_v2_';

export interface CacheEnvelope<T> {
  version: number;
  generatedAt: string;
  mode: Mode;
  query: {
    taxa: string[];
    locality?: string;
  };
  data: T;
}

export class MalformedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedResponseError';
  }
}

export type ErrorCategory =
  | 'missing_auth'
  | 'permission'
  | 'quota'
  | 'unavailable'
  | 'network'
  | 'malformed'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  title: string;
  message: string;
  guidance?: string;
  retryable: boolean;
  canOpenKeySelector: boolean;
  technicalDetails?: string;
}

const normalizeToken = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

export const normalizeInputList = (values: string[]): string[] =>
  values.map((v) => v.trim()).filter((v) => v.length > 0);

/**
 * Builds an order-preserving cache key so reversing comparison inputs
 * resolves to a distinct cached column order.
 */
export const buildCacheKey = (mode: Mode, taxa: string[], locality: string): string => {
  const normalizedTaxa = taxa.map((t) => encodeURIComponent(normalizeToken(t)));
  const normalizedLocality = encodeURIComponent(normalizeToken(locality));
  return `${CACHE_PREFIX}${mode}::${normalizedLocality}::${normalizedTaxa.join('|')}`;
};

const isNonEmptyString = (val: unknown): val is string =>
  typeof val === 'string' && val.trim().length > 0;

const isStringArray = (val: unknown): val is string[] =>
  Array.isArray(val) && val.every((item) => typeof item === 'string');

export const validateTaxonData = (raw: unknown): TaxonData => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MalformedResponseError('Profile response was empty or had an unexpected structure.');
  }

  const obj = raw as Record<string, unknown>;
  const requiredTextFields = [
    'scientificName',
    'commonName',
    'quickRecap',
    'diagnosticDescription',
    'ecology',
    'etymology',
    'history',
    'distribution',
  ] as const;

  for (const field of requiredTextFields) {
    if (!isNonEmptyString(obj[field])) {
      throw new MalformedResponseError(`Profile response is missing required "${field}" content.`);
    }
  }

  if (!isStringArray(obj.lineage)) {
    throw new MalformedResponseError('Profile response has an invalid taxonomic lineage list.');
  }

  if (!Array.isArray(obj.confusedTaxa)) {
    throw new MalformedResponseError('Profile response has an invalid similar taxa list.');
  }

  const confusedTaxa = obj.confusedTaxa.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new MalformedResponseError('Profile response contains a malformed similar-taxon entry.');
    }
    const entry = item as Record<string, unknown>;
    if (!isNonEmptyString(entry.name) || typeof entry.difference !== 'string' || typeof entry.keyFeature !== 'string') {
      throw new MalformedResponseError('Profile response contains an incomplete similar-taxon entry.');
    }
    return {
      name: entry.name.trim(),
      difference: entry.difference,
      keyFeature: entry.keyFeature,
    };
  });

  const optionalString = (val: unknown): string | undefined =>
    typeof val === 'string' ? val : undefined;

  return {
    scientificName: (obj.scientificName as string).trim(),
    author: typeof obj.author === 'string' ? obj.author.trim() : '',
    commonName: (obj.commonName as string).trim(),
    lineage: obj.lineage.map((l) => l.trim()).filter(Boolean),
    includedTaxaCount: optionalString(obj.includedTaxaCount),
    localIncludedTaxaCount: optionalString(obj.localIncludedTaxaCount),
    synonyms: isStringArray(obj.synonyms) ? obj.synonyms.map((s) => s.trim()).filter(Boolean) : [],
    conservationStatus: optionalString(obj.conservationStatus),
    hazards: optionalString(obj.hazards),
    fieldNotes: optionalString(obj.fieldNotes),
    seasonality: optionalString(obj.seasonality),
    humanRelevance: optionalString(obj.humanRelevance),
    localityContext: optionalString(obj.localityContext),
    quickRecap: obj.quickRecap as string,
    diagnosticDescription: obj.diagnosticDescription as string,
    confusedTaxa,
    ecology: obj.ecology as string,
    etymology: obj.etymology as string,
    history: obj.history as string,
    distribution: obj.distribution as string,
    sources: sanitizeSources(obj.sources),
  };
};

export const validateComparisonData = (raw: unknown, expectedTaxaCount?: number): ComparisonData => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MalformedResponseError('Comparison response was empty or had an unexpected structure.');
  }

  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.taxa) || obj.taxa.length < 2) {
    throw new MalformedResponseError('Comparison response did not return profiles for at least two taxa.');
  }

  if (typeof expectedTaxaCount === 'number' && obj.taxa.length !== expectedTaxaCount) {
    throw new MalformedResponseError(
      `Comparison response returned ${obj.taxa.length} taxa instead of the ${expectedTaxaCount} requested.`
    );
  }

  const taxa = obj.taxa.map((t) => validateTaxonData(t));

  if (!Array.isArray(obj.keyDifferences)) {
    throw new MalformedResponseError('Comparison response is missing key diagnostic differences.');
  }

  const keyDifferences = obj.keyDifferences.map((diff) => {
    if (!diff || typeof diff !== 'object') {
      throw new MalformedResponseError('Comparison response contains a malformed diagnostic row.');
    }
    const row = diff as Record<string, unknown>;
    if (!isNonEmptyString(row.feature) || !Array.isArray(row.states) || row.states.length !== taxa.length) {
      throw new MalformedResponseError('Comparison response contains an incomplete diagnostic row.');
    }
    const states = row.states.map((s) => (typeof s === 'string' ? s : 'N/A'));
    return {
      feature: row.feature.trim(),
      states,
    };
  });

  return {
    taxa,
    keyDifferences,
    sources: sanitizeSources(obj.sources),
    localityContext: typeof obj.localityContext === 'string' ? obj.localityContext : undefined,
  };
};

export const getCachedResult = <T>(
  mode: Mode,
  taxa: string[],
  locality: string,
  validator: (raw: unknown) => T
): CacheEnvelope<T> | null => {
  if (typeof window === 'undefined') return null;

  const fullKey = buildCacheKey(mode, taxa, locality);
  let rawValue: string | null = null;

  try {
    rawValue = window.localStorage.getItem(fullKey);
  } catch {
    return null;
  }

  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as Partial<CacheEnvelope<unknown>>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.version !== CACHE_VERSION ||
      parsed.mode !== mode ||
      typeof parsed.generatedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.generatedAt))
    ) {
      throw new Error('Invalid cache envelope');
    }

    const validatedData = validator(parsed.data);
    return {
      version: CACHE_VERSION,
      generatedAt: parsed.generatedAt,
      mode,
      query: {
        taxa: Array.isArray(parsed.query?.taxa) ? parsed.query.taxa : taxa,
        locality: typeof parsed.query?.locality === 'string' ? parsed.query.locality : locality || undefined,
      },
      data: validatedData,
    };
  } catch {
    try {
      window.localStorage.removeItem(fullKey);
    } catch {
      // Ignore storage removal errors
    }
    return null;
  }
};

export const setCachedResult = <T>(
  mode: Mode,
  taxa: string[],
  locality: string,
  data: T
): CacheEnvelope<T> => {
  const envelope: CacheEnvelope<T> = {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    query: {
      taxa: [...taxa],
      locality: locality || undefined,
    },
    data,
  };

  if (typeof window !== 'undefined') {
    const fullKey = buildCacheKey(mode, taxa, locality);
    try {
      window.localStorage.setItem(fullKey, JSON.stringify(envelope));
    } catch {
      // Storage quota exceeded or unavailable; proceed without failing search
    }
  }

  return envelope;
};

const redactCredentials = (text: string): string =>
  text
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-key]')
    .replace(/(api[_-]?key\s*[:=]\s*)['"]?[^\s'"]+/gi, '$1[redacted]');

export const classifyApiError = (error: unknown, inAiStudio: boolean): ClassifiedError => {
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const lower = rawMessage.toLowerCase();
  const safeTechnical = rawMessage ? redactCredentials(rawMessage) : undefined;
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : undefined;

  if (error instanceof MalformedResponseError || error instanceof SyntaxError || lower.includes('unexpected token') || lower.includes('json')) {
    return {
      category: 'malformed',
      title: 'Incomplete or malformed response',
      message: 'The response could not be read cleanly as a complete taxon profile.',
      guidance: 'Try again, or simplify the taxon name to a genus or species.',
      retryable: true,
      canOpenKeySelector: false,
      technicalDetails: safeTechnical,
    };
  }

  if (
    lower.includes('api key is missing') ||
    lower.includes('missing api key') ||
    lower.includes('unauthenticated') ||
    status === 401
  ) {
    return {
      category: 'missing_auth',
      title: 'API authentication is not configured',
      message: 'No Gemini API key is currently available to the server.',
      guidance: inAiStudio
        ? 'Select an API key in AI Studio, then retry your search.'
        : 'Set GEMINI_API_KEY in your server environment (or Settings > Secrets) and restart the server.',
      retryable: true,
      canOpenKeySelector: inAiStudio,
      technicalDetails: safeTechnical,
    };
  }

  if (
    lower.includes('403') ||
    lower.includes('permission_denied') ||
    lower.includes('unregistered callers') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    status === 403
  ) {
    return {
      category: 'permission',
      title: 'API access or permission error',
      message: 'The server could not authenticate this request with the Gemini API.',
      guidance: inAiStudio
        ? 'Check or re-select your API key in AI Studio, then retry.'
        : 'Verify that GEMINI_API_KEY in the server environment is valid and enabled for the Gemini API.',
      retryable: true,
      canOpenKeySelector: inAiStudio,
      technicalDetails: safeTechnical,
    };
  }

  if (
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    status === 429
  ) {
    return {
      category: 'quota',
      title: 'Rate limit or quota reached',
      message: 'The API temporarily rejected the request because a rate limit or quota was reached.',
      guidance: 'Wait a moment before retrying.',
      retryable: true,
      canOpenKeySelector: false,
      technicalDetails: safeTechnical,
    };
  }

  if (
    lower.includes('404') ||
    lower.includes('not_found') ||
    lower.includes('requested entity was not found') ||
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('502') ||
    lower.includes('504') ||
    status === 404 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return {
      category: 'unavailable',
      title: 'Model or upstream service unavailable',
      message: 'The requested AI model or resource could not be reached right now.',
      guidance: 'This is usually temporary or caused by an unavailable model configuration. Try again shortly.',
      retryable: true,
      canOpenKeySelector: false,
      technicalDetails: safeTechnical,
    };
  }

  if (
    error instanceof TypeError ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    return {
      category: 'network',
      title: 'Connection error',
      message: 'Could not reach the application server.',
      guidance: 'Check your network connection and retry.',
      retryable: true,
      canOpenKeySelector: false,
      technicalDetails: safeTechnical,
    };
  }

  return {
    category: 'unknown',
    title: 'Unable to complete search',
    message: 'An unexpected error occurred while generating the profile.',
    guidance: 'Check the taxon spelling or try a broader taxonomic rank (such as genus or family).',
    retryable: true,
    canOpenKeySelector: false,
    technicalDetails: safeTechnical,
  };
};

export const formatGeneratedTime = (isoString: string): string => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

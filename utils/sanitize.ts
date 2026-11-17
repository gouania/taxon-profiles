import DOMPurify from 'dompurify';
import { parse } from 'marked';
import { Source } from '../types';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
];

const ALLOWED_ATTR = ['href', 'title', 'target', 'rel'];

let hooksRegistered = false;

export const parseSafeHttpUrl = (rawUri: unknown): URL | null => {
  if (typeof rawUri !== 'string') return null;
  const trimmed = rawUri.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

const ensurePurifyHooks = () => {
  if (hooksRegistered || typeof window === 'undefined') return;
  if (typeof DOMPurify.addHook !== 'function') return;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const rawHref = node.getAttribute('href');
      const safeUrl = parseSafeHttpUrl(rawHref);
      if (safeUrl) {
        node.setAttribute('href', safeUrl.href);
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      } else {
        node.removeAttribute('href');
        node.removeAttribute('target');
        node.removeAttribute('rel');
      }
    }
  });

  hooksRegistered = true;
};

export const renderSafeMarkdown = (markdown: string): string => {
  if (!markdown || typeof markdown !== 'string') return '';
  ensurePurifyHooks();

  const rawHtml = parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'svg', 'img'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover'],
  });
};

export const sanitizeSources = (rawSources: unknown): Source[] => {
  if (!Array.isArray(rawSources)) return [];

  const deduped = new Map<string, Source>();
  for (const item of rawSources) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { title?: unknown; uri?: unknown };
    const safeUrl = parseSafeHttpUrl(candidate.uri);
    if (!safeUrl) continue;

    const rawTitle = typeof candidate.title === 'string' ? candidate.title.trim() : '';
    const title = rawTitle || safeUrl.hostname;
    if (!deduped.has(safeUrl.href)) {
      deduped.set(safeUrl.href, {
        title,
        uri: safeUrl.href,
      });
    }
  }

  return Array.from(deduped.values());
};

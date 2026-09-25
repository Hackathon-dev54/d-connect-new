// Domain and Subdomain Extraction Utilities for Dynamic Node Identity & Crawler Tags

export function cleanDomain(input: string): string {
  let cleaned = (input || '').trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, '');
  cleaned = cleaned.replace(/\/.*$/, '');
  return cleaned;
}

export function deriveSubdomain(domainOrHost: string): string {
  if (!domainOrHost) return 'node';
  const clean = domainOrHost.replace(/^https?:\/\//, '').replace(/:\d+$/, '').trim().toLowerCase();
  // If email, return username before @
  if (clean.includes('@')) {
    return clean.split('@')[0];
  }
  const parts = clean.split('.');
  if (parts.length >= 3) {
    return parts[0];
  }
  if (parts.length === 2) {
    if (parts[1] === 'local' || parts[1] === 'internal') return parts[0];
    return parts[0];
  }
  return clean || 'node';
}

export const deriveDomainUsername = deriveSubdomain;

/**
 * Resolves a target input (which can be a bare subdomain like "ais-pre-xxx", a tag like "#d-connect-2",
 * a full domain like "d-connect-2.vercel.app", or a URL) into a fully qualified host that the crawler can reach.
 */
export function resolveTargetHost(targetInput: string, currentHost?: string): string {
  let target = (targetInput || '').trim().toLowerCase();
  // Strip leading hashtag or at-sign (#d-connect-2 -> d-connect-2)
  target = target.replace(/^[#@]+/, '').trim();
  target = target.replace(/^https?:\/\//, '');
  target = target.replace(/\/.*$/, '');
  if (!target) return '';

  // If already contains dots or port (e.g. "d-connect-2.vercel.app" or "localhost:3000")
  if (target.includes('.') || target.includes(':')) {
    return target;
  }

  // Use current site host from parameter or window.location.host
  const rawHost = currentHost || (typeof window !== 'undefined' ? window.location.host : '');
  const cleanHost = cleanDomain(rawHost);

  // If host is not an email, extract its parent domain suffix
  if (cleanHost && !cleanHost.includes('@')) {
    const parts = cleanHost.split('.');
    if (parts.length >= 2) {
      // e.g. "d-connect-1.vercel.app" -> suffix is "vercel.app"
      // e.g. "ais-dev-xxx.asia-southeast1.run.app" -> suffix is "asia-southeast1.run.app"
      const suffix = parts.slice(1).join('.');
      return `${target}.${suffix}`;
    }
  }

  return target;
}

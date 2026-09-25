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

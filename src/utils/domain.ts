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

/**
 * Resolves a target input (which can be a bare subdomain like "ais-pre-xxx", a full domain,
 * or a URL) into a fully qualified host that the crawler can reach.
 */
export function resolveTargetHost(targetInput: string, currentHost: string): string {
  let target = (targetInput || '').trim().toLowerCase();
  target = target.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!target) return '';

  // If already contains dots or port (e.g. "ais-pre.run.app" or "localhost:3000")
  if (target.includes('.') || target.includes(':')) {
    return target;
  }

  // If bare subdomain (e.g. "ais-pre-3adlco6h5rvvpf7asnanza-320046163787" or "friend")
  const cleanCurrent = cleanDomain(currentHost);
  const parts = cleanCurrent.split('.');
  if (parts.length >= 3) {
    // Current host has subdomains: e.g. "ais-dev-xxx.asia-southeast1.run.app"
    // Base suffix: ".asia-southeast1.run.app"
    const suffix = parts.slice(1).join('.');
    return `${target}.${suffix}`;
  }

  return target;
}

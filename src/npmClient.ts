import * as https from 'https';
import { beginNetworkRequest, endNetworkRequest } from './activity';

export type AdvisorySeverity = 'low' | 'moderate' | 'high' | 'critical' | 'unknown';

export interface Advisory {
  id?: string;
  title?: string;
  url?: string;
  severity: AdvisorySeverity;
  vulnerableVersions?: string;
  patchedVersions?: string;
}

// Simple in-memory caching to prevent registry flooding.
const versionCache = new Map<string, string>();
const vulnerabilityCache = new Map<string, Advisory[]>();

export function clearCaches() {
  versionCache.clear();
  vulnerabilityCache.clear();
}

/**
 * Latest version with cache.
 */
export async function getLatestVersionCached(pkgName: string): Promise<string | null> {
  const cached = versionCache.get(pkgName);
  if (cached) {
    return cached;
  }

  beginNetworkRequest();
  try {
    const latest = await fetchLatestVersion(pkgName);
    if (latest) {
      versionCache.set(pkgName, latest);
    }
    return latest;
  } finally {
    endNetworkRequest();
  }
}

/**
 * Vulnerabilities for (pkgName, version) with cache.
 */
export async function getVulnerabilitiesCached(pkgName: string, version: string): Promise<Advisory[]> {
  const key = `${pkgName}@${version}`;
  const cached = vulnerabilityCache.get(key);
  if (cached) {
    return cached;
  }

  beginNetworkRequest();
  try {
    const advisories = await fetchVulnerabilities(pkgName, version);
    vulnerabilityCache.set(key, advisories);
    return advisories;
  } finally {
    endNetworkRequest();
  }
}

/**
 * GET https://registry.npmjs.org/<pkg>/latest
 */
function fetchLatestVersion(pkgName: string): Promise<string | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`;

  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode === 404) {
          res.resume();
          resolve(null);
          return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`Status ${res.statusCode}`));
          return;
        }

        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (typeof json.version === 'string') {
              resolve(json.version);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      })
      .on('error', () => resolve(null));
  });
}

/**
 * POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk
 */
function fetchVulnerabilities(pkgName: string, version: string): Promise<Advisory[]> {
  const payload: Record<string, string[]> = {
    [pkgName]: [version],
  };
  const body = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: 'registry.npmjs.org',
        path: '/-/npm/v1/security/advisories/bulk',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          resolve([]);
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            if (!data) {
              resolve([]);
              return;
            }

            const json = JSON.parse(data) as Record<string, any[]>;
            const list = Array.isArray(json[pkgName]) ? json[pkgName] : [];

            const advisories: Advisory[] = list.map(normalizeAdvisory);
            resolve(advisories);
          } catch {
            resolve([]);
          }
        });
      },
    );

    req.on('error', () => resolve([]));
    req.write(body);
    req.end();
  });
}

function normalizeAdvisory(raw: any): Advisory {
  const severity = String(raw.severity ?? 'unknown').toLowerCase() as AdvisorySeverity;

  return {
    id: raw.id?.toString() ?? undefined,
    title: raw.title ?? undefined,
    url: raw.url ?? undefined,
    severity,
    vulnerableVersions: raw.vulnerable_versions ?? undefined,
    patchedVersions: raw.patched_versions ?? undefined,
  };
}

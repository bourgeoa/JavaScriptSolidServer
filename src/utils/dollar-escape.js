/**
 * Solid $ Escaping — URL ↔ Filesystem mapping for extensionless RDF resources
 *
 * Solid servers (NSS, CSS) use the `$` delimiter to store extensionless RDF
 * resources with a file extension on disk. This module provides both
 * directions of that mapping.
 *
 * Examples:
 *   URL:    /profile/card
 *   Disk:   /profile/card$.jsonld
 *
 *   URL:    /alice/data
 *   Disk:   /alice/data$.ttl        (if Content-Type: text/turtle)
 */

import path from 'path';

const EXT_FROM_CONTENT_TYPE = {
  'application/ld+json': '.jsonld',
  'application/json': '.jsonld',
  'text/turtle': '.ttl',
  'text/n3': '.n3',
  'application/n-triples': '.nt',
  'application/rdf+xml': '.rdf',
};

const EXTENSIONS = ['.jsonld', '.ttl', '.n3', '.nt', '.rdf'];

/**
 * File → URL: strip `$ext` from a filename for display in container listings
 * and response URLs.
 *
 *   card$.jsonld  → card
 *   index.html    → index.html    (no $, unchanged)
 *
 * @param {string} filename
 * @returns {string}
 */
export function fileNameToUrlName(filename) {
  const dollar = filename.indexOf('$');
  if (dollar === -1) return filename;
  return filename.slice(0, dollar);
}

/**
 * URL → File (write): convert a URL path and Content-Type to a `$`-escaped
 * storage path. Only applies when the URL has no extension AND the
 * Content-Type maps to a known RDF extension.
 *
 *   /profile/card + application/ld+json  → /profile/card$.jsonld
 *   /profile/card                 → /profile/card  (unchanged)
 *   /readme.txt    + text/plain          → /readme.txt           (unchanged)
 *
 * @param {string} urlPath - URL path (e.g. /profile/card)
 * @param {string} contentType - Content-Type header value
 * @returns {string} - Storage path
 */
export function urlToStoragePath(urlPath, contentType) {
  // Already has an extension — store as-is
  if (path.extname(urlPath)) return urlPath;

  // Dot-files (.acl, .meta, .htpasswd …) have no extension per path.extname
  // but must be stored exactly as named — never dollar-escape them.
  const base = path.basename(urlPath);
  if (base.startsWith('.')) return urlPath;

  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  const ext = EXT_FROM_CONTENT_TYPE[ct];
  if (!ext) return urlPath; // non-RDF, store as-is

  // /profile/card → /profile/card$.jsonld
  return urlPath + '$' + ext;
}

/**
 * URL → File (read): given an extensionless URL path and a stat function,
 * try each $ variant in priority order. Returns the first path that exists,
 * or the original path if none do.
 *
 * Used by GET/HEAD/DELETE/PATCH handlers when `stat(path)` returns null
 * and the URL has no extension.
 *
 * @param {string} urlPath - URL path (e.g. /profile/card)
 * @param {(p: string) => Promise<object|null>} statFn - async stat function
 * @returns {Promise<string>} - The resolved storage path
 */
export async function resolveDollarPath(urlPath, statFn) {
  // Already has an extension — nothing to try
  if (path.extname(urlPath)) return urlPath;

  // Try $ escaping first (card$.jsonld, card$.ttl, etc.)
  for (const ext of EXTENSIONS) {
    const candidate = urlPath + '$' + ext;
    const stats = await statFn(candidate);
    if (stats) return candidate;
  }

  // Fallback: try plain extension (card.jsonld) for older pods
  for (const ext of EXTENSIONS) {
    const candidate = urlPath + ext;
    const stats = await statFn(candidate);
    if (stats) return candidate;
  }

  return urlPath;
}

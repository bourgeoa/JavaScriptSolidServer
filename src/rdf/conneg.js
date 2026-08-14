/**
 * Content Negotiation for RDF Resources
 *
 * Handles Accept header parsing and format selection.
 *
 * JSS is a JSON-LD native implementation: without --conneg, generic or
 * absent Accept headers get JSON-LD. Explicit requests for supported RDF
 * types (Turtle/N3) are honored regardless of --conneg, since the Solid
 * Protocol requires Turtle support. --conneg additionally tunes the
 * default representation (Turtle for extensionless RDF URLs, text/*
 * handling, Turtle/N3 on the write side).
 */

import { turtleToJsonLd, jsonLdToTurtle } from './turtle.js';
import { safeJsonParse } from '../utils/url.js';

// RDF content types we support
export const RDF_TYPES = {
  JSON_LD: 'application/ld+json',
  TURTLE: 'text/turtle',
  N3: 'text/n3',
  NTRIPLES: 'application/n-triples',
  RDF_XML: 'application/rdf+xml'  // Not supported, but recognized
};

// Content types we can accept for input (always for Turtle/N3 — the Solid
// Protocol requires Turtle support — and under conneg for the rest)
const SUPPORTED_INPUT = [RDF_TYPES.JSON_LD, RDF_TYPES.TURTLE, RDF_TYPES.N3];

/**
 * Parse Accept header and select best content type
 * @param {string} acceptHeader - Accept header value
 * @param {boolean} connegEnabled - Whether content negotiation is enabled
 * @returns {string} Selected content type
 *
 * Explicitly named, supported RDF types are honored regardless of the
 * --conneg flag (the Solid Protocol requires Turtle support). The flag
 * only changes what generic Accept values (no Accept, a wildcard, or
 * text wildcard) resolve to: the JSON-LD native default when off,
 * Turtle-friendly handling when on.
 */
export function selectContentType(acceptHeader, connegEnabled = false) {
  // Parse Accept header (q-sorted, highest weight first)
  const accepts = parseAcceptHeader(acceptHeader || '');

  // Find best match
  for (const { type } of accepts) {
    // Explicit RDF requests are always honored — a Solid client asking for
    // Turtle must get Turtle even on a JSON-LD-native deployment.
    if (type === RDF_TYPES.TURTLE || type === RDF_TYPES.N3) {
      return type;
    }
    if (type === RDF_TYPES.JSON_LD || type === 'application/json') {
      return RDF_TYPES.JSON_LD;
    }
    // Generic Accept values only get Turtle-friendly handling under --conneg.
    if (connegEnabled) {
      if (type === '*/*' || type === 'application/*') {
        return RDF_TYPES.JSON_LD;
      }
      // Handle text/* preference
      if (type === 'text/*') {
        return RDF_TYPES.TURTLE;
      }
    }
  }

  // Default to JSON-LD
  return RDF_TYPES.JSON_LD;
}

/**
 * Parse Accept header into sorted list
 */
function parseAcceptHeader(header) {
  const types = header.split(',').map(part => {
    const [type, ...params] = part.trim().split(';');
    let q = 1;

    for (const param of params) {
      const [key, value] = param.trim().split('=');
      if (key === 'q') {
        q = parseFloat(value) || 0;
      }
    }

    return { type: type.trim().toLowerCase(), q };
  });

  // Sort by q value descending
  return types.sort((a, b) => b.q - a.q);
}

/**
 * Check if content type is RDF
 */
export function isRdfType(contentType) {
  if (!contentType) return false;
  const type = contentType.split(';')[0].trim().toLowerCase();
  return Object.values(RDF_TYPES).includes(type) ||
         type === 'application/json'; // Treat as JSON-LD
}

/**
 * Check if we can accept this input type for RDF resources
 * Non-RDF content types are always accepted (passthrough)
 */
export function canAcceptInput(contentType, connegEnabled = false) {
  if (!contentType) return true; // No content type = accept

  const type = contentType.split(';')[0].trim().toLowerCase();

  // Always accept JSON-LD and JSON
  if (type === RDF_TYPES.JSON_LD || type === 'application/json') {
    return true;
  }

  // Check if it's an RDF type we need to handle
  const isRdf = Object.values(RDF_TYPES).includes(type);

  // Non-RDF types are accepted as-is (passthrough)
  if (!isRdf) {
    return true;
  }

  // Turtle/N3 are accepted regardless of the --conneg flag (the Solid
  // Protocol requires Turtle support).
  if (type === RDF_TYPES.TURTLE || type === RDF_TYPES.N3) {
    return true;
  }

  // Remaining RDF types (e.g. rdf+xml) only if conneg enabled
  if (connegEnabled) {
    return SUPPORTED_INPUT.includes(type);
  }

  // RDF type but unsupported - reject
  return false;
}

/**
 * Convert content to JSON-LD (internal storage format)
 * @param {Buffer|string} content - Input content
 * @param {string} contentType - Content-Type header
 * @param {string} baseUri - Base URI
 * @param {boolean} connegEnabled - Whether conneg is enabled
 * @returns {Promise<object>} JSON-LD document
 */
export async function toJsonLd(content, contentType, baseUri, connegEnabled = false) {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  const text = Buffer.isBuffer(content) ? content.toString() : content;

  // JSON-LD or JSON
  if (type === RDF_TYPES.JSON_LD || type === 'application/json' || !type) {
    return safeJsonParse(text);
  }

  // Turtle/N3 - convert to JSON-LD (the internal storage format).
  // Accepted regardless of --conneg (Solid requires Turtle support).
  if (type === RDF_TYPES.TURTLE || type === RDF_TYPES.N3) {
    return turtleToJsonLd(text, baseUri);
  }

  throw new Error(`Unsupported content type: ${type}`);
}

/**
 * Convert JSON-LD to requested format
 * @param {object} jsonLd - JSON-LD document
 * @param {string} targetType - Target content type
 * @param {string} baseUri - Base URI
 * @param {boolean} connegEnabled - Whether conneg is enabled
 * @returns {Promise<{content: string, contentType: string}>}
 */
export async function fromJsonLd(jsonLd, targetType, baseUri, connegEnabled = false) {
  // The targetType drives the output; connegEnabled is kept for call-site
  // compatibility. Explicit Turtle requests are honored on all deployments
  // (Solid requires Turtle support).
  if (targetType === RDF_TYPES.TURTLE) {
    const turtle = await jsonLdToTurtle(jsonLd, baseUri);
    return { content: turtle, contentType: RDF_TYPES.TURTLE };
  }

  // JSON-LD (or fallback for any other type)
  return {
    content: JSON.stringify(jsonLd, null, 2),
    contentType: RDF_TYPES.JSON_LD
  };
}

/**
 * Get Vary header value for content negotiation
 *
 * Must be identical across all variants of a given URL — inconsistent Vary
 * across variants confuses browser caches and can cause the wrong variant
 * to be served on reload (see #315).
 *
 * - `Accept` — response body depends on Accept (conneg or mashlib HTML shell)
 * - `Authorization` — response body depends on the authenticated user (WAC)
 * - `Origin` — CORS headers echo the request's Origin
 */
export function getVaryHeader(connegEnabled, mashlibEnabled = false) {
  // Response bodies now depend on Accept on every deployment — explicit
  // text/turtle requests are honored even without --conneg — so Vary must
  // always list Accept. The flags are kept for call-site compatibility.
  return 'Accept, Authorization, Origin';
}

/**
 * Get Accept-* headers for responses.
 *
 * The advertised RDF types are aligned with what this module accepts:
 *   - JSON-LD (application/ld+json) and JSON (application/json alias)
 *   - Turtle (text/turtle) and N3 (text/n3) on every deployment —
 *     canAcceptInput() accepts them regardless of --conneg (Solid
 *     requires Turtle support).
 *
 * Note: a wildcard (asterisk-slash-asterisk) is included as a broad
 * interoperability hint for generic clients and proxies. It is not a
 * strict contract that every media type matching the wildcard will be
 * accepted by canAcceptInput() (e.g., application/n-triples and
 * application/rdf+xml are not accepted).
 */
export function getAcceptHeaders(connegEnabled, isContainer = false) {
  const headers = {};

  if (isContainer) {
    headers['Accept-Post'] = `${RDF_TYPES.JSON_LD}, application/json, ${RDF_TYPES.TURTLE}, ${RDF_TYPES.N3}, */*`;
  }

  headers['Accept-Put'] = `${RDF_TYPES.JSON_LD}, application/json, ${RDF_TYPES.TURTLE}, ${RDF_TYPES.N3}, */*`;

  headers['Accept-Patch'] = 'text/n3, application/sparql-update';

  return headers;
}

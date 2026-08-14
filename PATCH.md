# PATCH.md — bourgeoa/dollar-escape-v0.0.219

Patches applied on top of [origin/gh-pages](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer).

---

## 1. Port support for base domain

**Files:** `src/utils/url.js`, `src/server.js`, `test/url.test.js`

`--base-domain` now accepts a port (e.g., `pivot-test.local:4443`). The
`getBaseDomainHost()` helper strips the port so subdomain matching works
correctly with non-standard ports. Previously `alice.localhost:4443` would
fail to match `localhost:4443` as a base domain.

```
jss start --subdomains --base-domain pivot-test.local:4443 --port 4443
```

---

## 2. Extended ACL — Turtle/N3 on .acl, owner editing, WAC PATCH Append

**Files:** `src/auth/middleware.js`, `src/handlers/resource.js`, `test/auth.test.js`, `test/conneg.test.js`

- **Turtle/N3 PUT on `.acl`** is accepted when conneg is enabled. Origin
  locks `.acl` to JSON-only (#295) to prevent round-trip data loss. This
  patch trusts the N3.js converter and allows Turtle/N3 ACL writes.
  The test suite reflects this: `conneg.test.js` retains bourgeoa's
  ACL-accepting test cases and adds origin's #409 (index.html browser Accept)
  regression tests on top.

- **Owner can edit any ACL** regardless of `acl:Control` mode. When the
  authenticated WebID matches the pod owner, ACL write checks pass even
  without explicit `acl:Control` in the ACL document.

- **WAC PATCH Append** support: `PATCH` with `application/sparql-update`
  is now authorized against `acl:Append` mode for non-existent resources,
  matching Solid spec semantics.

---

## 3. Phanpy ActivityPub — Mastodon API compatibility

**Files:** `src/ap/routes/mastodon.js` (+1600 lines), `src/ap/index.js`, `src/ap/keys.js`, `src/ap/routes/*`, `src/ap/store.js`, `src/server.js`, `test/mastodon-api.test.js`

Implements Mastodon-compatible REST API routes so the [Phanpy](https://phanpy.social/)
client can connect to JSS ActivityPub pods:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/instance` | Server info |
| `GET /api/v1/apps` | OAuth app registration |
| `POST /api/v1/apps` | Create OAuth app |
| `POST /oauth/token` | OAuth token exchange |
| `GET /api/v1/accounts/verify_credentials` | Current user |
| `GET /api/v1/accounts/:id` | Account lookup |
| `GET /api/v1/timelines/home` | Home timeline |
| `GET /api/v1/timelines/public` | Public timeline |
| `GET /api/v1/statuses/:id` | Status detail |
| `POST /api/v1/statuses` | Create status |
| `GET /api/v1/notifications` | Notifications |
| `GET /api/v1/accounts/:id/followers` | Account followers |
| `GET /api/v1/accounts/:id/following` | Account following |

These routes bypass auth in the server's WAC hook via `isApPublicPath`
and `/api/v1/` prefix matching.

**CLI:** `--activitypub` enables the AP plugin (including Mastodon routes).

### Timelines (added 2026-08-14)

- `GET /api/v1/timelines/public` — public timeline, no auth required.
  Returns the union of the default user's, the request (subdomain) user's,
  and the authenticated user's posts — and always answers 200 with an
  array, so Mastodon clients (Phanpy/Elk) polling with
  `?limit=1&local=true&since_id=…` no longer 404.
- `GET /api/v1/timelines/direct` — empty-array stub (no DMs in the facade).
- `GET /api/v1/timelines/tag/:hashtag` — empty-array stub.

(`GET /api/v1/streaming/health` was added separately — Phanpy/Elk probe it
before opening the streaming WebSocket.)

---

## 4. RemoteStorage fixes

**Files:** `src/remotestorage.js` (+19), `test/remotestorage.test.js` (new, 258 lines)

| Fix | Issue |
|-----|-------|
| Multiuser username check | Hardcoded `'me'` rejected all other users via `checkUsername`. Now skips the gate when `ownerWebId` is null (multiuser). |
| Subdomain path prefix | Data written to `data-4443/todos/` instead of `data-4443/alice/todos/`. `getStoragePath` now prepends `request.podName`. |
| Suffix pod support | Falls back to `request.params.user` as pod prefix when subdomain mode is off. |
| JSON object body | `Buffer.from(object)` threw `ERR_INVALID_ARG_TYPE`. Objects are now stringified before buffering. |
| Public folder check | `startsWith('/public/')` broke after pod prefix was added. Changed to `includes('/public/')`. |

---

## 5. Mashlib merge + fixes

**Files:** `src/mashlib/index.js`, `src/handlers/resource.js`, `src/server.js`,
`src/auth/middleware.js`, `package.json`

- Merged origin's `viewableTypes` array (markdown, playlists, `audio/*`)
  with the correct `{serve, reason}` return format in `getMashlibDecision`.
- Adopted origin's `getMashlibEtag` refactoring for mashlib-aware ETags.
- Fixed missing `shouldServeMashlib` import causing 500 on all requests.

### Mashlib-local: serve from `node_modules/mashlib/dist/`

Local mode (`--mashlib`) no longer requires a separate `src/mashlib-local/`
build directory. Instead, mashlib is installed as a `file:` dependency in
`package.json` pointing to the local `solidos/workspaces/mashlib` workspace:

```json
"mashlib": "file:../../solidos/workspaces/mashlib"
```

Static files (`mashlib.min.js`, `mash.css`, `databrowser.html`, etc.) are
served from `node_modules/mashlib/dist/` via an `onRequest` hook in
`src/server.js`. This runs before any route handler and serves only
root-level files (no subdirectory traversal).

### databrowser.html shell template

When `mashlibLocal` is true, `generateDatabrowserHtml()` receives
`{ localBase: '/' }` and takes the CDN/localBase code path. This path:

1. Fetches `/databrowser.html` from the local server
2. Applies it as the body shell via `applyShellFromTemplate()` (which also
   transfers `data-app-shell="databrowser"` and other body attributes)
3. Loads `/mashlib.min.js` and calls `panes.runDataBrowser()`

This replaces the older fallback template (hardcoded `PageHeader`/`DummyUUID`
structure) with the modern `solid-ui-provider` → `app-shell` → `MainContent`
structure from mashlib's dist.

**Note:** `bin/jss.js` CLI help and `docs/` still reference the old
`src/mashlib-local/dist/` path — these need a follow-up doc update.

### Cross-format PUT fix (dollar-escape)

**Files:** `src/handlers/resource.js`

When mashlib PUTs `profile/card` with `Content-Type: text/turtle`, the
`urlToStoragePath` helper maps it to `card$.ttl` based on the incoming
content type. The existing file on disk is `card$.jsonld` (created during
pod setup). The old code then called `resolveDollarPath('card$.ttl', …)`
which saw an extension and returned immediately — never finding the real
file. Result: 412 Precondition Failed.

Fix: save the original extensionless URL path before `urlToStoragePath`
transforms it, and pass that original path to `resolveDollarPath` so it
can find the existing file regardless of which `$ext` it uses on disk.

### Turtle round-trip fidelity: no JSON-LD conversion for .ttl/.n3 files

**Files:** `src/handlers/resource.js`

Previously, ALL Turtle/N3 PUTs were converted to JSON-LD before storage
when conneg was enabled — even for `.ttl` files. This caused:

- **Relative IRI loss**: the n3 `Parser` resolves relative IRIs against
  the base URL during Turtle→JSON-LD. The n3 `Writer` can't recover them.
- **Default prefix spam**: the hardcoded `DEFAULT_PREFIXES` (rdf, rdfs,
  xsd, foaf, ldp, solid, acl, pim, dc, schema, vcard) were injected into
  every Turtle output regardless of the original document.

Fix: only convert Turtle/N3→JSON-LD for **extensionless** URLs (which use
the `$`-escape convention) and for `.acl`/`.meta` dotfiles (which are
always JSON-LD per `getContentType`). Files with `.ttl`/`.n3` extensions
keep their native format on disk and are served as-is. The GET handler already handles this gracefully — `safeJsonParse`
fails on raw Turtle bytes and falls through to "serve as-is".

---

## 6. Turtle.js — binary merge + restore + NUL sentinel fix

**Files:** `src/rdf/turtle.js`

Git detected `turtle.js` as a binary file during merge (UTF-16 encoding on
disk) and could not produce conflict markers. The auto-resolved result was
the bourgeoa version, which had accidentally removed three origin features:
`applyTerminatorSpacing` (#419), `id`/`type` alias support (#415), and CID
namespace predicates. This was resolved by:

1. Replacing the file with origin's gh-pages version (541 lines).
2. Adding back bourgeoa's `@graph` container support for ACL files.
3. Fixing the UTF-16 encoding (normalized to UTF-8, 600 lines after fix).

Also fixed an **upstream bug** in origin's `applyTerminatorSpacing`: the
restore regex `/(\d+)/g` matched all digit sequences, including numeric
Turtle literals like `30`, replacing them with `placeholders[30]` (undefined).
Switched to NUL-delimited sentinels (`\x00<N>\x00`) as the original comment
intended — NUL bytes never appear in n3.js output.

---

## 7. User switching: kept origin's implementation

During the merge, origin's `handleSwitchAccount` (#384) was preferred over
the bourgeoa branch's older `handleRelogin`. Both implement "sign in as a
different user" but origin's version uses POST (not GET) and cleaner naming.
No bourgeoa-specific changes in this area.

---

## 8. Canonical WebID: `profile/card` (extensionless)

**Files:** `src/auth/nostr.js`, `src/handlers/container.js`, `src/idp/well-known-did-nostr.js`, `src/server.js`, `bin/jss.js`

The canonical WebID profile path is **`profile/card`** (no `.jsonld` extension).
This applies everywhere — pod creation, WebID construction, DID resolution,
CID verification method lookup, single-user pod seeding, and ActivityPub
actor routes.

A fallback chain in `src/server.js` detects existing pods created by older
JSS versions and preserves their WebID shape:

```
hasJsonLd (profile/card.jsonld) → use profile/card.jsonld#me
hasLegacy (profile/card)        → use profile/card#me
fresh pod                       → use profile/card#me (canonical)
```

This is paired with the `$`-escape filesystem layer (section 9) which handles
the actual on-disk filename (`card$.jsonld`) transparently.

---

## 9. Dollar-escape: `$` URL-to-filesystem mapping

**Files:** `src/utils/dollar-escape.js` (new), `src/handlers/resource.js`, `src/handlers/container.js`, `src/idp/well-known-did-nostr.js`

Implements the Solid `$` convention for storing extensionless RDF resources
with a file extension on disk:

| URL | Disk |
|-----|------|
| `/profile/card` | `/profile/card$.jsonld` |
| `/alice/data` (Turtle) | `/alice/data$.ttl` |

**Exports:**

- **`urlToStoragePath(urlPath, contentType)`** — URL → disk on write.
  `/profile/card` + `application/ld+json` → `/profile/card$.jsonld`.
  Non-RDF content types and paths that already have an extension pass through
  unchanged. Dot-files (`.acl`, `.meta`) are never dollar-escaped.

- **`resolveDollarPath(urlPath, statFn)`** — URL → disk on read.
  Tries `$ext` variants first (`card$.jsonld`, `card$.ttl`, …), then plain
  extension fallback for older pods (`card.jsonld`), then returns the original
  path. Used by GET/HEAD/DELETE/PATCH handlers when `stat()` returns null on
  the plain URL path.

- **`fileNameToUrlName(filename)`** — Disk → URL for container listings.
  `card$.jsonld` → `card`.

Dot-files (`.acl`, `.meta`) are stored as-is, never `$`-escaped. Non-RDF files
(e.g. `index.html`, `avatar.png`) also pass through unchanged.

---

## 10. Explicit Turtle/N3 without `--conneg` (Solid protocol)

**Files:** `src/rdf/conneg.js`, `src/handlers/resource.js`,
`src/handlers/container.js`, `bin/jss.js`, `src/server.js`, `test/conneg.test.js`

JSS is JSON-LD native, but the Solid Protocol requires Turtle support. Explicit
requests for a supported RDF serialization are now honored regardless of the
`--conneg` flag:

- `Accept: text/turtle` / `text/n3` return Turtle even with `--conneg` off.
- `Accept: application/ld+json` and generic/no Accept keep the JSON-LD native
  default.
- `--conneg` now only changes the default for generic Accept (extensionless
  URLs, `text/*` handling).

Same principle on the write side: Turtle/N3 PUT/POST bodies (including `.acl`)
are accepted and converted to JSON-LD for canonical storage, independent of
`--conneg`. `Vary` always lists `Accept`, and `Accept-Put`/`Accept-Post` always
advertise Turtle/N3.

Fixes the solid-panes bug where the Storage navbar item never appeared: the
client fetches containers with `Accept: text/turtle` and hardcodes parsing the
response as Turtle, which got JSON-LD before.

---

## 11. Pod roots typed `pim:Storage`

**Files:** `src/ldp/container.js`, `src/handlers/resource.js`, `test/conneg.test.js`

solid-panes discovers storage by checking the container the WebID profile
points at via `pim:storage` for a `pim:Storage` type (`isPodStorage()`). JSS
listings only carried `ldp:Container/BasicContainer/Resource`, so the Storage
navbar item never appeared.

`generateContainerJsonLd()` now takes an `isPodStorage` flag and adds
`pim:Storage` to the container's `@type` (with a `pim` context prefix).
`handleGet` computes the flag with a new `isPodRootContainer()` helper:

- root-pod (single-user): `/`
- subdomain mode: `/` (the pod's origin root)
- path-based / single-user named pods: `/<podName>/`
- public mode: never

Both the JSON-LD listing and its Turtle conversion now declare
`<> a pim:Storage` on pod roots, completing the Storage-navbar fix from
section 10.

---

## Test summary

```
1131 tests | 1127 pass | 3 fail (WSL1) | 1 skip | 0 cancelled
```

All 3 failures are WSL1 environment limitations, not code bugs:
- `test/port.test.js` (2): Windows SO_REUSEADDR prevents exclusive port binding — `findFreePort` cannot detect busy ports
- `test/port-shift-cli.test.js` (1): CLI child process hangs after TOKEN_SECRET warning on drvfs

These pass on native Linux (WSL2 / GitHub Actions CI).

---

## New test files (not in gh-pages)

| File | Lines | Added by |
|------|-------|----------|
| `test/remotestorage.test.js` | 258 | Section 4 |
| `test/mastodon-api.test.js` | 482 | Section 3 |
| `test/adapter.test.js` | 85 | Subdomain base-domain root files (#307) |

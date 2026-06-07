# PATCH.md — bourgeoa/patched-v0.0.204

Patches applied on top of [origin/gh-pages v0.0.284](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer).

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

These routes bypass auth in the server's WAC hook via `isApPublicPath`
and `/api/v1/` prefix matching.

**CLI:** `--activitypub` enables the AP plugin (including Mastodon routes).

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

**Files:** `src/mashlib/index.js`, `src/handlers/resource.js`

- Merged origin's `viewableTypes` array (markdown, playlists, `audio/*`)
  with the correct `{serve, reason}` return format in `getMashlibDecision`.
- Adopted origin's `getMashlibEtag` refactoring for mashlib-aware ETags.
- Fixed missing `shouldServeMashlib` import causing 500 on all requests.

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

## Test summary

```
963 tests | 961 pass | 1 fail (WSL1 POSIX 0o600) | 1 skip
```

The single failure is `keys-provision-integration.test.js` — expects `0o600`
file permissions on a secret key, but WSL1 on DrvFs returns `0o777`. This is
a WSL1/Windows filesystem limitation, not a code bug.

---

## New test files

| File | Lines |
|------|-------|
| `test/remotestorage.test.js` | 258 |
| `test/mastodon-api.test.js` | 482 |
| `test/adapter.test.js` | 57 |
| `test/subdomain-base-files.test.js` | 53 |

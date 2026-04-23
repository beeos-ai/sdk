# @beeos-ai/sdk

TypeScript (Fetch API) client for the BeeOS OpenAPI contract — served
exclusively by [`openapi-gateway`](https://github.com/beeos-ai/openagent/tree/main/backend/services/openapi-gateway).

The spec is [`backend/openapi/beeos-platform-v1.yaml`](https://github.com/beeos-ai/openagent/blob/main/backend/openapi/beeos-platform-v1.yaml)
and is generated via [OpenAPI Generator](https://github.com/OpenAPITools/openapi-generator)
(`typescript-fetch`). The main BeeOS Gateway is **not** part of this contract —
it serves web / desktop / mobile routes under its own URL scheme.

## Install

```bash
npm add @beeos-ai/sdk
```

## Usage

- **Base URL** — point the client at your `openapi-gateway` host (e.g.
  `http://localhost:8095` in dev, `https://openapi.beeos.ai` in prod).
- **Auth** — the client does **not** include JWT. Pass
  `Authorization: Bearer <jwt>` or `Authorization: Bearer oag_<user-api-key>`
  via `RequestInit` / the generated `Configuration`.

## Regenerate (maintainers)

From the monorepo: `cd sdks/openapi-sdk && ./generate.sh` (or `npm run gen`).

**Repository:** this directory is mirrored / published as its own GitHub repo
(`github.com/beeos-ai/sdk`, npm `@beeos-ai/sdk`), synchronized from the
openagent monorepo on release.

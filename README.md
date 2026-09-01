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

For the stable, task-focused facade:

```ts
import { BeeOSClient } from "@beeos-ai/sdk";

const beeos = new BeeOSClient({ apiKey: process.env.BEEOS_API_KEY! });
const agents = await beeos.listAgents();
const task = await beeos.createTask(agents[0].id, { message: "Open Settings" });
const snapshot = await beeos.getTask(agents[0].id, task.data.taskId);
```

The generated APIs and models remain available from the package root for
callers that need the complete Platform OpenAPI surface.

For phone automation across Device Agent, BeeRunner, and Redroid:

```ts
import { MobileClient } from "@beeos-ai/sdk/facade";

const mobile = new MobileClient({
  apiKey: process.env.BEEOS_API_KEY!,
  agentId: "agent-id",
  instanceId: "instance-id",
});
await mobile.waitReady();
const result = await mobile.run({ message: "Open Settings" });
```

`mobile.mobile` exposes the generated atomic-control API, including UI tree,
app discovery, open app, drag, double tap, and long press. BeeRunner uses the
durable task methods; its atomic-control capability is intentionally not
advertised until a trusted Portal adapter exists.

## Regenerate (maintainers)

From the monorepo: `cd sdks/openapi-sdk && ./generate.sh` (or `npm run gen`).

**Repository:** this directory is mirrored / published as its own GitHub repo
(`github.com/beeos-ai/sdk`, npm `@beeos-ai/sdk`), synchronized from the
openagent monorepo on release.

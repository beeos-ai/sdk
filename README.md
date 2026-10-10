# @beeos-ai/sdk

> **Archived — use [`beeos-cloud-sdks`](https://github.com/beeos-ai/beeos-cloud-sdks) instead.** This package targeted the retired BeeOS OpenAPI gateway and is no longer maintained. The TypeScript client is now `@beeos-ai/cloud-sdk` from `beeos-cloud-sdks`. Published `@beeos-ai/sdk` versions stay installable but receive no updates.

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

- **Base URL** — the facade uses `https://openapi.beeos.ai` by default. Set
  `BEEOS_API_URL` or pass `baseUrl` to target another environment.
- **Auth** — set `BEEOS_API_KEY`, or pass `apiKey` explicitly. The generated
  client also supports custom authorization through `Configuration`.

For the stable, task-focused facade:

```ts
import { BeeOSClient } from "@beeos-ai/sdk";

const beeos = new BeeOSClient();
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

## Resource Facade (Unreleased)

The additions below are implemented in the local development branch. They are
not in the published `0.8.0` package yet. Generated API exports remain available.

```ts
const instance = beeos.instance(process.env.BEEOS_INSTANCE_ID!);
await instance.mobile.waitReady({ timeoutMs: 60_000 });
const info = await instance.mobile.info();
if (info.data?.supportedActions?.includes('ui_tree')) {
  const tree = await instance.mobile.uiTree({ format: 'compact' });
  console.log(tree.data);
}

const task = await beeos.submitTask(process.env.BEEOS_AGENT_ID!, {
  message: 'Open Settings and report the battery level without changing settings',
  idempotencyKey: crypto.randomUUID(),
});
const result = await task.wait({ timeoutMs: 120_000 });
console.log(result.data.result);
```

Use an explicit agent belonging to the chosen instance, not the first item in
the account. Inspect runtime capabilities before atomic control; this facade
does not bypass `action_unsupported` or `device_busy`.

- `instances.create/get/list` and `instance.start/stop/restart/destroy` reuse the
  existing lifecycle API. Destroy only resources this workflow created.
- `instance.computer.click/move/scroll/type/key/screenshot` bind desktop control
  to the same instance. The raw generated APIs are still an escape hatch.
- `task.get/wait/cancel/messages/events` resume an existing task without
  resubmitting. `wait` requires `completed` by default; `TaskExecutionError`
  retains the failed snapshot. `requireSuccess: false` explicitly accepts any
  terminal. The pre-existing `MobileClient.run` keeps its terminal-only behavior.
- Local timeout/abort never cancels the durable task implicitly. Call
  `task.cancel()` explicitly; do not blindly retry a write after a timeout/409.
- For SSE use `task.events({ since, signal: AbortSignal.timeout(120_000) })`.
  Persist offsets, which are increasing but not necessarily contiguous. Handle
  `backfill_truncated` explicitly. Breaking the loop releases the connection.
- `beeos.files.download(fileId, { maxBytes, expectedContentType })` returns a
  `Uint8Array`. It resolves owner-authorized metadata, defaults to a 32 MiB cap,
  rejects redirects/non-HTTPS URLs, and never forwards the API key to storage.
  `allowInsecureHttp: true` is an explicit option for a trusted local fixture.

These convenience methods do not imply that every runtime supports every
operation, or that a `completed` task produced a valid PDF/business result.

## Regenerate (maintainers)

From the monorepo: `cd sdks/openapi-sdk && ./generate.sh` (or `npm run gen`).

**Repository:** this directory is mirrored / published as its own GitHub repo
(`github.com/beeos-ai/sdk`, npm `@beeos-ai/sdk`), synchronized from the
openagent monorepo on release.

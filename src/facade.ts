import { AgentsApi, MobileApi, TasksApi } from './apis/index';
import type {
  AgentDTO,
  AgentListResponse,
  CancelTaskRequest,
  CreateTaskRequest,
  TaskCreatedResponse,
  TaskResponse,
} from './models/index';
import { Configuration } from './runtime';
import { BeeOSTimeoutError, RequestOptions, delay, requireID, withDeadline } from './async';
import { FilesResource, InstancesResource, MobileResource, TaskExecutionError, TaskResource } from './resources';

export { BeeOSTimeoutError } from './async';
export type { RequestOptions } from './async';
export * from './resources';

export interface BeeOSClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface TaskEvent {
  event: string;
  id?: string;
  data: unknown;
}

export interface MobileClientOptions extends BeeOSClientOptions {
  agentId: string;
  instanceId: string;
}

export interface WaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

/** Stable convenience client. The complete generated API remains exported. */
export class BeeOSClient {
  readonly agents: AgentsApi;
  readonly tasks: TasksApi;
  readonly instances: InstancesResource;
  readonly files: FilesResource;
  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected readonly fetchApi: typeof globalThis.fetch;

  constructor(options: BeeOSClientOptions = {}) {
    const apiKey = options.apiKey?.trim() || readEnvironmentVariable('BEEOS_API_KEY');
    if (!apiKey) {
      throw new Error('apiKey is required; pass it explicitly or set BEEOS_API_KEY');
    }
    this.apiKey = apiKey;
    this.baseUrl = (
      options.baseUrl?.trim()
      || readEnvironmentVariable('BEEOS_API_URL')
      || 'https://openapi.beeos.ai'
    ).replace(/\/+$/, '');
    this.fetchApi = options.fetch ?? globalThis.fetch;
    const configuration = new Configuration({
      basePath: this.baseUrl,
      accessToken: this.apiKey,
      fetchApi: this.fetchApi,
    });
    this.agents = new AgentsApi(configuration);
    this.tasks = new TasksApi(configuration);
    this.instances = new InstancesResource(this, configuration);
    this.files = new FilesResource(configuration, this.fetchApi);
  }

  async listAgents(): Promise<AgentDTO[]> {
    const response: AgentListResponse = await this.agents.listAgents();
    return response.data;
  }

  createTask(agentId: string, request: CreateTaskRequest, options: RequestOptions = {}): Promise<TaskCreatedResponse> {
    requireID(agentId, 'agentId');
    return withDeadline((signal) => this.tasks.createTask({ agentId, createTaskRequest: request }, { signal }), options);
  }

  getTask(agentId: string, taskId: string, options: RequestOptions = {}): Promise<TaskResponse> {
    requireID(agentId, 'agentId'); requireID(taskId, 'taskId');
    return withDeadline((signal) => this.tasks.getTask({ agentId, taskId }, { signal }), options);
  }

  cancelTask(
    agentId: string,
    taskId: string,
    request?: CancelTaskRequest,
    options: RequestOptions = {},
  ): Promise<TaskResponse> {
    requireID(agentId, 'agentId'); requireID(taskId, 'taskId');
    return withDeadline((signal) => this.tasks.cancelTask({ agentId, taskId, cancelTaskRequest: request }, { signal }), options);
  }

  instance(id: string) { return this.instances.ref(id); }

  task(agentId: string, taskId: string) { return new TaskResource(this, agentId, taskId); }

  async submitTask(agentId: string, request: CreateTaskRequest, options: RequestOptions = {}) {
    const response = await this.createTask(agentId, request, options);
    return this.task(agentId, requireID(response.data?.taskId, 'created taskId'));
  }

  async waitTask(agentId: string, taskId: string, options: WaitOptions & { requireSuccess?: boolean } = {}): Promise<TaskResponse> {
    requireID(agentId, 'agentId'); requireID(taskId, 'taskId');
    try {
      return await withDeadline(async (signal) => {
        while (true) {
          const snapshot = await this.tasks.getTask({ agentId, taskId }, { signal });
          if (snapshot.data?.taskId !== taskId || snapshot.data.agentId !== agentId) throw new Error('Task response identity does not match the requested task');
          if (snapshot.data?.truncated) throw new Error('Task snapshot is truncated; resume taskEvents for the authoritative tail');
          if (isTerminalTaskStatus(snapshot.data?.status)) {
            if (options.requireSuccess !== false && snapshot.data.status !== 'completed') throw new TaskExecutionError(snapshot);
            return snapshot;
          }
          await delay(options.pollIntervalMs ?? 1_000, signal);
        }
      }, options, 120_000);
    } catch (error) {
      if (error instanceof BeeOSTimeoutError) {
        error.message = `Task ${taskId} did not finish before timeout; it was not automatically cancelled`;
      }
      throw error;
    }
  }

  async *taskEvents(
    agentId: string,
    taskId: string,
    options: { since?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<TaskEvent> {
    requireID(agentId, 'agentId'); requireID(taskId, 'taskId');
    if (options.since !== undefined && (!Number.isSafeInteger(options.since) || options.since < 0)) throw new RangeError('since must be a nonnegative integer');
    options.signal?.throwIfAborted();
    const url = new URL(
      `${this.baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(taskId)}/events`,
    );
    if (options.since !== undefined) url.searchParams.set('since', String(options.since));
    const response = await this.fetchApi(url, {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal: options.signal,
    });
    if (!response.ok || !response.body || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`task event stream failed: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const encoder = new TextEncoder();
    let buffer = '';
    let lastId: string | undefined;
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
          const frame = buffer.slice(0, boundary.index).replace(/\r\n/g, '\n');
          buffer = buffer.slice(boundary.index + boundary[0].length);
          if (encoder.encode(frame).byteLength > 4 * 1024 * 1024) throw new Error('Task event frame exceeds the 4 MiB buffer limit');
          for (const line of frame.split('\n')) {
            if (line === 'id' || line.startsWith('id:')) {
              const value = line === 'id' ? '' : line.slice(3).replace(/^ /, '');
              if (!value.includes('\0')) lastId = value;
            }
          }
          const parsed = parseSSEFrame(frame);
          if (parsed) {
            yield { ...parsed, id: lastId };
            if (parsed.event === 'end') return;
          }
        }
        if (encoder.encode(buffer).byteLength > 4 * 1024 * 1024) throw new Error('Task event frame exceeds the 4 MiB buffer limit');
        if (done) break;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}

/** Task-first facade for Device Agent, BeeRunner, and Redroid. */
export class MobileClient extends BeeOSClient {
  readonly mobile: MobileApi;
  readonly agentId: string;
  readonly instanceId: string;

  constructor(options: MobileClientOptions) {
    super(options);
    if (!options.agentId) throw new Error('agentId is required');
    if (!options.instanceId) throw new Error('instanceId is required');
    this.agentId = options.agentId;
    this.instanceId = options.instanceId;
    this.mobile = new MobileApi(new Configuration({
      basePath: this.baseUrl,
      accessToken: this.apiKey,
      fetchApi: this.fetchApi,
    }));
  }

  async waitReady(options: WaitOptions = {}): Promise<GetMobileInfoResult> {
    return new MobileResource(this.mobile, this.instanceId).waitReady(options);
  }

  async run(request: CreateTaskRequest, options: WaitOptions = {}): Promise<TaskResponse> {
    return withDeadline(async (signal) => {
      const created = await this.createTask(this.agentId, request, { signal });
      return this.waitTask(this.agentId, created.data.taskId, {
        ...options, signal, requireSuccess: false,
        timeoutMs: options.timeoutMs ?? request.deadlineMs ?? 120_000,
      });
    }, options, request.deadlineMs ?? 120_000);
  }

  watch(taskId: string, options: { since?: number; signal?: AbortSignal } = {}): AsyncGenerator<TaskEvent> {
    return this.taskEvents(this.agentId, taskId, options);
  }

  cancel(taskId: string, request?: CancelTaskRequest): Promise<TaskResponse> {
    return this.cancelTask(this.agentId, taskId, request);
  }
}

type GetMobileInfoResult = Awaited<ReturnType<MobileApi['getMobileInfo']>>;

function readEnvironmentVariable(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.[name]?.trim() || undefined;
}

function isTerminalTaskStatus(status: string): boolean {
  return new Set(['completed', 'failed', 'canceled', 'cancelled', 'timeout', 'rejected']).has(status);
}

function parseSSEFrame(frame: string): TaskEvent | undefined {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return undefined;
  const raw = data.join('\n');
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    // SSE data may intentionally be plain text.
  }
  return { event, id, data: value };
}

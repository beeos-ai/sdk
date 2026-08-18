import { AgentsApi, TasksApi } from './apis/index';
import type {
  AgentDTO,
  AgentListResponse,
  CancelTaskRequest,
  CreateTaskRequest,
  TaskCreatedResponse,
  TaskResponse,
} from './models/index';
import { Configuration } from './runtime';

export interface BeeOSClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface TaskEvent {
  event: string;
  id?: string;
  data: unknown;
}

/** Stable convenience client. The complete generated API remains exported. */
export class BeeOSClient {
  readonly agents: AgentsApi;
  readonly tasks: TasksApi;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchApi: typeof globalThis.fetch;

  constructor(options: BeeOSClientOptions) {
    if (!options.apiKey) throw new Error('apiKey is required');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://openapi.beeos.ai').replace(/\/+$/, '');
    this.fetchApi = options.fetch ?? globalThis.fetch;
    const configuration = new Configuration({
      basePath: this.baseUrl,
      accessToken: this.apiKey,
      fetchApi: this.fetchApi,
    });
    this.agents = new AgentsApi(configuration);
    this.tasks = new TasksApi(configuration);
  }

  async listAgents(): Promise<AgentDTO[]> {
    const response: AgentListResponse = await this.agents.listAgents();
    return response.data;
  }

  createTask(agentId: string, request: CreateTaskRequest): Promise<TaskCreatedResponse> {
    return this.tasks.createTask({ agentId, createTaskRequest: request });
  }

  getTask(agentId: string, taskId: string): Promise<TaskResponse> {
    return this.tasks.getTask({ agentId, taskId });
  }

  cancelTask(
    agentId: string,
    taskId: string,
    request?: CancelTaskRequest,
  ): Promise<TaskResponse> {
    return this.tasks.cancelTask({ agentId, taskId, cancelTaskRequest: request });
  }

  async *taskEvents(
    agentId: string,
    taskId: string,
    options: { since?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<TaskEvent> {
    const url = new URL(
      `/api/v1/agents/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(taskId)}/events`,
      this.baseUrl,
    );
    if (options.since !== undefined) url.searchParams.set('since', String(options.since));
    const response = await this.fetchApi(url, {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal: options.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`task event stream failed: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseSSEFrame(frame);
          if (parsed) yield parsed;
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  }
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

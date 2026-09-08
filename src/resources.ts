import { ComputerApi, FilesApi, InstancesApi, MobileApi } from './apis/index';
import type { ListInstancesRequest, MobileGetUiTreeRequest, MobileListAppsRequest } from './apis/index';
import type {
  CancelTaskRequest, ClickRequest, DeployInstanceRequest, DragRequest,
  InstanceDataDTO, LongPressRequest, MoveRequest, PressButtonRequest,
  ScrollRequest, SwipeRequest, TapRequest, TaskResponse,
} from './models/index';
import { Configuration } from './runtime';
import type { BeeOSClient, WaitOptions } from './facade';
import { RequestOptions, delay, requireID, withDeadline } from './async';

export class TaskExecutionError extends Error {
  constructor(readonly snapshot: TaskResponse) {
    super(`Task ${snapshot.data.taskId} ended with ${snapshot.data.status}${snapshot.data.error ? `: ${snapshot.data.error}` : ''}`);
    this.name = 'TaskExecutionError';
  }
}

export class TaskResource {
  constructor(private readonly client: BeeOSClient, readonly agentId: string, readonly id: string) {
    requireID(agentId, 'agentId');
    requireID(id, 'taskId');
  }
  get(options: RequestOptions = {}) { return this.client.getTask(this.agentId, this.id, options); }
  wait(options: WaitOptions & { requireSuccess?: boolean } = {}) { return this.client.waitTask(this.agentId, this.id, options); }
  cancel(request?: CancelTaskRequest, options: RequestOptions = {}) { return this.client.cancelTask(this.agentId, this.id, request, options); }
  events(options: { since?: number; signal?: AbortSignal } = {}) { return this.client.taskEvents(this.agentId, this.id, options); }
  messages(options: { since?: number; limit?: number; includeDeltas?: boolean } = {}, request: RequestOptions = {}) {
    return withDeadline((signal) => this.client.tasks.listTaskMessages({ ...options, agentId: this.agentId, taskId: this.id }, { signal }), request);
  }
}

export class InstancesResource {
  readonly api: InstancesApi;
  constructor(private readonly client: BeeOSClient, private readonly configuration: Configuration) {
    this.api = new InstancesApi(configuration);
  }
  ref(id: string) { return new InstanceResource(this.client, this.configuration, requireID(id, 'instanceId')); }
  async get(id: string, options: RequestOptions = {}) {
    const resource = this.ref(id);
    await resource.refresh(options);
    return resource;
  }
  async create(request: DeployInstanceRequest, options: RequestOptions = {}) {
    const response = await withDeadline((signal) => this.api.deployInstance({ deployInstanceRequest: request }, { signal }), options);
    return new InstanceResource(this.client, this.configuration, requireID(response.data?.id, 'created instanceId'), response.data);
  }
  list(filter: ListInstancesRequest = {}, options: RequestOptions = {}) {
    return withDeadline((signal) => this.api.listInstances(filter, { signal }), options);
  }
}

export class InstanceResource {
  readonly mobile: MobileResource;
  readonly computer: ComputerResource;
  private readonly api: InstancesApi;
  constructor(
    private readonly client: BeeOSClient,
    configuration: Configuration,
    readonly id: string,
    public data?: InstanceDataDTO,
  ) {
    this.api = new InstancesApi(configuration);
    this.mobile = new MobileResource(new MobileApi(configuration), id);
    this.computer = new ComputerResource(new ComputerApi(configuration), id);
  }
  async refresh(options: RequestOptions = {}) {
    const response = await withDeadline((signal) => this.api.getInstance({ id: this.id }, { signal }), options);
    if (response.data?.id !== this.id) throw new Error('Instance response identity does not match the requested instance');
    this.data = response.data;
    return this;
  }
  async waitReady(options: WaitOptions = {}) {
    return withDeadline(async (signal) => {
      while (true) {
        const response = await this.api.getInstance({ id: this.id }, { signal });
        if (response.data?.id !== this.id) throw new Error('Instance response identity does not match the requested instance');
        this.data = response.data;
        if (this.data.status === 'running' && this.data.connectivity === 'online') return this;
        if (['failed', 'error', 'destroyed', 'terminated'].includes(this.data.status)) {
          throw new Error(`Instance ${this.id} cannot become ready: ${this.data.status}`);
        }
        await delay(options.pollIntervalMs ?? 1_000, signal);
      }
    }, options, 60_000);
  }
  agents(options: RequestOptions = {}) {
    return withDeadline((signal) => this.client.agents.listAgents({ instanceId: this.id }, { signal }), options);
  }
  start(options: RequestOptions = {}) { return withDeadline((signal) => this.api.startInstance({ id: this.id }, { signal }), options); }
  stop(options: RequestOptions = {}) { return withDeadline((signal) => this.api.stopInstance({ id: this.id }, { signal }), options); }
  restart(options: RequestOptions = {}) { return withDeadline((signal) => this.api.restartInstance({ id: this.id }, { signal }), options); }
  destroy(options: RequestOptions = {}) { return withDeadline((signal) => this.api.destroyInstance({ id: this.id }, { signal }), options); }
}

export class MobileResource {
  constructor(readonly api: MobileApi, readonly instanceId: string) {}
  info(options: RequestOptions = {}) { return withDeadline((signal) => this.api.getMobileInfo({ id: this.instanceId }, { signal }), options); }
  async waitReady(options: WaitOptions = {}) {
    return withDeadline(async (signal) => {
      while (true) {
        const response = await this.api.getMobileInfo({ id: this.instanceId }, { signal });
        if (response.data?.online) return response;
        await delay(options.pollIntervalMs ?? 1_000, signal);
      }
    }, options, 60_000);
  }
  screenshot(options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileScreenshot({ id: this.instanceId }, { signal }), options); }
  uiTree(query: Omit<MobileGetUiTreeRequest, 'id'> = {}, options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileGetUiTree({ ...query, id: this.instanceId }, { signal }), options); }
  listApps(query: Omit<MobileListAppsRequest, 'id'> = {}, options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileListApps({ includeSystem: false, launchableOnly: true, ...query, id: this.instanceId }, { signal }), options); }
  tap(request: TapRequest, options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileTap({ id: this.instanceId, tapRequest: request }, { signal }), options); }
  doubleTap(request: TapRequest, options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileDoubleTap({ id: this.instanceId, tapRequest: request }, { signal }), options); }
  longPress(request: LongPressRequest, options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileLongPress({ id: this.instanceId, longPressRequest: request }, { signal }), options); }
  drag(request: DragRequest, options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileDrag({ id: this.instanceId, dragRequest: request }, { signal }), options); }
  swipe(request: SwipeRequest, options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileSwipe({ id: this.instanceId, swipeRequest: request }, { signal }), options); }
  scroll(request: ScrollRequest, options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileScroll({ id: this.instanceId, scrollRequest: request }, { signal }), options); }
  type(text: string, options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileType({ id: this.instanceId, typeRequest: { text } }, { signal }), options); }
  key(key: string, options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileKey({ id: this.instanceId, keyRequest: { keys: [key] } }, { signal }), options); }
  pressButton(button: PressButtonRequest['button'], options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobilePressButton({ id: this.instanceId, pressButtonRequest: { button } }, { signal }), options); }
  openApp(app: string, options: RequestOptions = {}) { return withDeadline((signal) => this.api.mobileOpenApp({ id: this.instanceId, openAppRequest: { app } }, { signal }), options); }
}

export class ComputerResource {
  constructor(readonly api: ComputerApi, readonly instanceId: string) {}
  info(options: RequestOptions = {}) { return withDeadline((signal) => this.api.getComputerInfo({ id: this.instanceId }, { signal }), options); }
  screenshot(options: RequestOptions = {}) { return withDeadline((signal) => this.api.computerScreenshot({ id: this.instanceId }, { signal }), options); }
  click(request: ClickRequest, options: RequestOptions = {}) { return withDeadline((signal) => this.api.computerClick({ id: this.instanceId, clickRequest: request }, { signal }), options); }
  move(request: MoveRequest, options: RequestOptions = {}) { return withDeadline((signal) => this.api.computerMove({ id: this.instanceId, moveRequest: request }, { signal }), options); }
  scroll(request: ScrollRequest, options: RequestOptions = {}) { return withDeadline((signal) => this.api.computerScroll({ id: this.instanceId, scrollRequest: request }, { signal }), options); }
  type(text: string, options: RequestOptions = {}) { return withDeadline((signal) => this.api.computerType({ id: this.instanceId, typeRequest: { text } }, { signal }), options); }
  key(keys: string | string[], options: RequestOptions = {}) { return withDeadline((signal) => this.api.computerKey({ id: this.instanceId, keyRequest: { keys: typeof keys === 'string' ? [keys] : keys } }, { signal }), options); }
}

export interface DownloadOptions extends RequestOptions {
  maxBytes?: number;
  expectedContentType?: string;
  allowInsecureHttp?: boolean;
}

export class FilesResource {
  private readonly api: FilesApi;
  constructor(configuration: Configuration, private readonly fetchApi: typeof globalThis.fetch) {
    this.api = new FilesApi(configuration);
  }
  get(fileId: string, options: RequestOptions = {}) {
    requireID(fileId, 'fileId');
    return withDeadline((signal) => this.api.getFile({ id: fileId }, { signal }), options);
  }
  async download(fileId: string, options: DownloadOptions = {}): Promise<Uint8Array> {
    requireID(fileId, 'fileId');
    const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be a positive safe integer');
    return withDeadline(async (signal) => {
      const resolved = await this.api.getFile({ id: fileId }, { signal });
      const metadata = resolved.data;
      if (metadata?.fileId !== fileId || !metadata.downloadUrl) throw new Error('File response is missing an authorized download URL');
      const url = new URL(metadata.downloadUrl);
      if (url.username || url.password || !(['https:'].includes(url.protocol) || options.allowInsecureHttp && url.protocol === 'http:')) {
        throw new Error('File download requires an HTTPS URL without embedded credentials');
      }
      if (metadata.size !== undefined && metadata.size > maxBytes) throw new Error('File exceeds maxBytes');
      // A presigned object-store request must never receive the BeeOS API key.
      const response = await this.fetchApi(url, { signal, credentials: 'omit', redirect: 'error' });
      if (!response.ok || !response.body) throw new Error(`File download failed: HTTP ${response.status}`);
      const reader = response.body.getReader();
      try {
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if (options.expectedContentType && contentType !== options.expectedContentType.toLowerCase()) throw new Error('Downloaded file has an unexpected content type');
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) throw new Error('File exceeds maxBytes');
          chunks.push(value);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return bytes;
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }, options);
  }
}

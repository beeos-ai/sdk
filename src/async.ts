export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class BeeOSTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BeeOSTimeoutError';
  }
}

export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: RequestOptions = {},
  defaultTimeoutMs = 30_000,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new RangeError('timeoutMs must be a positive finite timer duration');
  }
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new BeeOSTimeoutError('BeeOS operation timed out')), timeoutMs);
  try {
    const result = await operation(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError('pollIntervalMs must be nonnegative and finite');
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function requireID(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

import { native } from "../native-bridge/native";

type Subscriber = (source: string | null) => void;
type Request = {
  appId: string;
  revision: string;
  generation: number;
  subscribers: Set<Subscriber>;
  started: boolean;
};
const maxBytes = 32 * 1024 * 1024;
const maxEntries = 256;
let generation = 0;
let revision = "";
let active = 0;
let bytes = 0;
const cache = new Map<string, { source: string | null; bytes: number }>();
const requests = new Map<string, Request>();

function remember(appId: string, source: string | null) {
  // Count UTF-16 storage conservatively, including the complete data URL.
  const size = source === null ? 0 : source.length * 2;
  if (size > maxBytes) return;
  cache.set(appId, { source, bytes: size });
  bytes += size;
  while (bytes > maxBytes || cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    bytes -= cache.get(oldest)?.bytes ?? 0;
    cache.delete(oldest);
  }
}

function drain() {
  for (const request of requests.values()) {
    if (active >= 4) break;
    if (request.started || request.subscribers.size === 0) continue;
    request.started = true;
    active += 1;
    void native
      .icon(request.appId, request.revision)
      .then((source) => {
        if (request.generation !== generation) return;
        remember(request.appId, source);
        for (const notify of request.subscribers) notify(source);
      })
      .catch(() => {
        // Transport failures remain retryable on the next subscription.
        if (request.generation === generation)
          for (const notify of request.subscribers) notify(null);
      })
      .finally(() => {
        if (requests.get(request.appId) === request)
          requests.delete(request.appId);
        active -= 1;
        drain();
      });
  }
}

export function resetIconSession() {
  generation += 1;
  cache.clear();
  bytes = 0;
  for (const request of requests.values())
    for (const notify of request.subscribers) notify(null);
  requests.clear();
}

export function setIconCatalogRevision(next: string) {
  if (revision === next) return;
  resetIconSession();
  revision = next;
}

export function subscribeIcon(
  appId: string,
  catalogRevision: string,
  notify: Subscriber,
) {
  if (catalogRevision !== revision) return () => {};
  const cached = cache.get(appId);
  if (cached) {
    cache.delete(appId);
    cache.set(appId, cached);
    notify(cached.source);
    return () => {};
  }
  let request = requests.get(appId);
  if (!request) {
    request = {
      appId,
      revision,
      generation,
      subscribers: new Set(),
      started: false,
    };
    requests.set(appId, request);
  }
  request.subscribers.add(notify);
  drain();
  return () => {
    request.subscribers.delete(notify);
    if (
      !request.started &&
      request.subscribers.size === 0 &&
      requests.get(appId) === request
    )
      requests.delete(appId);
  };
}

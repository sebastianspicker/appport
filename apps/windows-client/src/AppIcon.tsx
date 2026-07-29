import { useEffect, useState, type Dispatch } from "react";
import { native } from "./native";

const maxConcurrentIconLoads = 4;
let session = 0;
let activeLoads = 0;
const successfulIcons = new Map<string, string>();
const pendingLoads: Array<{
  appId: string;
  resolve: Dispatch<string | null>;
  session: number;
}> = [];

function drainIconPool() {
  while (activeLoads < maxConcurrentIconLoads && pendingLoads.length > 0) {
    const request = pendingLoads.shift();
    if (!request) return;
    if (request.session !== session) {
      request.resolve(null);
      continue;
    }
    activeLoads += 1;
    void native
      .icon(request.appId)
      .then((value) => {
        if (request.session === session && value)
          successfulIcons.set(request.appId, value);
        request.resolve(request.session === session ? value : null);
      })
      .catch(() => {
        request.resolve(null);
      })
      .finally(() => {
        activeLoads -= 1;
        drainIconPool();
      });
  }
}

function loadIcon(appId: string) {
  const cached = successfulIcons.get(appId);
  if (cached) return Promise.resolve(cached);
  const requestSession = session;
  return new Promise<string | null>((resolve) => {
    pendingLoads.push({ appId, resolve, session: requestSession });
    drainIconPool();
  });
}

/** Successful icon values are intentionally scoped to a signed-in client session. */
export function resetIconSession() {
  session += 1;
  successfulIcons.clear();
  while (pendingLoads.length > 0) pendingLoads.shift()?.resolve(null);
}

export function AppIcon({
  appId,
  hasIcon,
  name,
  sessionKey,
}: {
  appId: string;
  hasIcon: boolean;
  name: string;
  sessionKey: number;
}) {
  const requestKey = `${sessionKey}:${appId}`;
  const [loadedIcon, setLoadedIcon] = useState<{
    requestKey: string;
    source: string;
  }>();
  useEffect(() => {
    if (!hasIcon) return;
    let active = true;
    void loadIcon(appId).then((value) => {
      if (active && value) setLoadedIcon({ requestKey, source: value });
    });
    return () => {
      active = false;
    };
  }, [appId, hasIcon, requestKey]);
  const source =
    loadedIcon?.requestKey === requestKey ? loadedIcon.source : undefined;
  if (source)
    return (
      <span
        className="app-icon"
        aria-hidden="true"
        style={{ backgroundImage: `url(${source})` }}
      />
    );
  return (
    <span className="app-icon placeholder" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

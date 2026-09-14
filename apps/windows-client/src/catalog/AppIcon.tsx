import { useEffect, useRef, useState } from "react";
import { subscribeIcon } from "./iconPool";

export { resetIconSession } from "./iconPool";

export function AppIcon({
  appId,
  hasIcon,
  name,
  sessionKey,
  catalogRevision,
}: {
  appId: string;
  hasIcon: boolean;
  name: string;
  sessionKey: number;
  catalogRevision: string;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const requestKey = `${sessionKey}:${catalogRevision}:${appId}`;
  const [loadedIcon, setLoadedIcon] = useState<{
    requestKey: string;
    source: string;
  }>();
  useEffect(() => {
    const target = element.current;
    if (!hasIcon || !target) return;
    let unsubscribe: (() => void) | undefined;
    let subscribed = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (visible && !subscribed) {
          subscribed = true;
          unsubscribe = subscribeIcon(appId, catalogRevision, (source) => {
            setLoadedIcon(source ? { requestKey, source } : undefined);
          });
        } else if (!visible) {
          subscribed = false;
          unsubscribe?.();
          unsubscribe = undefined;
          setLoadedIcon(undefined);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
      unsubscribe?.();
    };
  }, [appId, catalogRevision, hasIcon, requestKey]);
  const source =
    hasIcon && loadedIcon?.requestKey === requestKey
      ? loadedIcon.source
      : undefined;
  return (
    <span
      ref={element}
      className={`app-icon${source ? "" : " placeholder"}`}
      aria-hidden="true"
      style={source ? { backgroundImage: `url(${source})` } : undefined}
    >
      {source ? null : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

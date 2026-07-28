import { useEffect, useState } from "react";
import { native } from "./native";

export function AppIcon({ appId, name }: { appId: string; name: string }) {
  const [source, setSource] = useState<string>();
  useEffect(() => {
    let active = true;
    void native.icon(appId).then((value) => { if (active && value) setSource(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [appId]);
  if (source) return <span className="app-icon" aria-hidden="true" style={{ backgroundImage: `url(${source})` }} />;
  return <span className="app-icon placeholder" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

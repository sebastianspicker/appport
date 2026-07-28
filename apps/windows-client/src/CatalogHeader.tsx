import { text, type Copy, type Locale } from "./appCopy";
import type { NativeBootstrap } from "./models";

export function CatalogHeader({ bootstrap, locale, onConnect, onSignOut }: { bootstrap: NativeBootstrap | undefined; locale: Locale; onConnect: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const copy: Copy = text[locale];
  const device = bootstrap ? `${bootstrap.user.displayName} · ${bootstrap.device.name}` : copy.currentDevice;
  return <header><div><p className="eyebrow">RELUTION</p><h1>Appport</h1><p className="device">{device}</p></div><SessionButton authenticated={Boolean(bootstrap)} copy={copy} onConnect={onConnect} onSignOut={onSignOut} /></header>;
}

function SessionButton({ authenticated, copy, onConnect, onSignOut }: { authenticated: boolean; copy: Copy; onConnect: () => Promise<void>; onSignOut: () => Promise<void> }) {
  if (authenticated) return <button className="secondary" onClick={() => void onSignOut()}>{copy.signOut}</button>;
  return <button className="secondary" onClick={() => void onConnect()}>{copy.signIn}</button>;
}

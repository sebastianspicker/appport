import { useEffect } from "react";
import { CatalogPage } from "../catalog/CatalogPage";
import { useCatalog } from "../catalog/useCatalog";
import { localeFor } from "../i18n/copy";
import { native } from "../native-bridge/native";
import { SessionControls } from "../session/SessionControls";
import { useConnect, useSignOut } from "../session/useSession";
import { SupportPanel } from "../support/SupportPanel";

export function App() {
  const locale = localeFor(navigator.language);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const { catalog, control } = useCatalog(locale);
  const connect = useConnect(locale, control);
  const signOut = useSignOut(locale, control);
  const warning = signOut.signOutWarning ?? connect.backgroundCheckWarning;
  const { bootstrap, phase } = catalog;
  return (
    <CatalogPage
      catalog={catalog}
      locale={locale}
      sessionWarning={warning}
      sessionControls={
        <SessionControls
          key={bootstrap ? "connected" : "signed-out"}
          problem={phase === "ready" ? undefined : phase}
          warning={warning}
          bootstrap={bootstrap}
          locale={locale}
          onConnect={connect.connect}
          onOpenPortal={native.openRelutionPortal}
          onSignOut={signOut.signOut}
        />
      }
      supportPanel={(active) =>
        bootstrap ? (
          <SupportPanel
            key={catalog.iconSession}
            bootstrap={bootstrap}
            locale={locale}
            active={active}
          />
        ) : null
      }
    />
  );
}

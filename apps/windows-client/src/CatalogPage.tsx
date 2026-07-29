import {
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { CatalogHeader } from "./CatalogHeader";
import { CatalogNavigation } from "./CatalogNavigation";
import { CatalogResults } from "./CatalogResults";
import { copyFor, type Locale } from "./appCopy";
import { native } from "./native";
import type {
  AppAction,
  AvailableApp,
  ClientProblem,
  NativeBootstrap,
} from "./models";
import type { PollingState, SourceFilter, View } from "./useAppCatalog";

type Phase = "ready" | ClientProblem;
export type Catalog = {
  actionFailures: ReadonlyMap<string, string>;
  actions: ReadonlyMap<string, AppAction>;
  apps: AvailableApp[];
  bootstrap: NativeBootstrap | undefined;
  busy: string | undefined;
  connect: (relutionUsername: string, accessToken: string) => Promise<void>;
  iconSession: number;
  load: (view?: View, showLoading?: boolean) => Promise<void>;
  mounted: MutableRefObject<boolean>;
  phase: Phase;
  polling: ReadonlyMap<string, PollingState>;
  query: string;
  resumeAction: (appId: string) => void;
  rows: AvailableApp[];
  setApps: Dispatch<SetStateAction<AvailableApp[]>>;
  setBootstrap: Dispatch<SetStateAction<NativeBootstrap | undefined>>;
  setPhase: Dispatch<SetStateAction<Phase>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setSourceFilter: Dispatch<SetStateAction<SourceFilter>>;
  setView: Dispatch<SetStateAction<View | undefined>>;
  signOut: () => Promise<void>;
  signOutWarning: string | undefined;
  sourceFilter: SourceFilter;
  startAction: (application: AvailableApp) => Promise<void>;
  view: View | undefined;
};

export function CatalogPage({
  catalog,
  locale,
}: {
  catalog: Catalog;
  locale: Locale;
}) {
  const copy = copyFor(locale);
  const [confirmation, setConfirmation] = useState<{
    application: AvailableApp;
    opener: HTMLElement;
  }>();
  return (
    <main>
      <CatalogHeader
        bootstrap={catalog.bootstrap}
        locale={locale}
        onConnect={catalog.connect}
        onOpenPortal={native.openRelutionPortal}
        onSignOut={catalog.signOut}
      />
      <CatalogNavigation
        bootstrap={catalog.bootstrap}
        locale={locale}
        view={catalog.view}
        onSelect={(view) => {
          catalog.setPhase("loading");
          catalog.setView(view);
          void catalog.load(view, false);
        }}
      />
      <CatalogToolbar catalog={catalog} locale={locale} />
      <CatalogResults
        catalog={catalog}
        locale={locale}
        onConfirm={(application, opener) =>
          setConfirmation({ application, opener })
        }
      />
      {catalog.signOutWarning && (
        <p className="sign-out-warning" role="alert">
          {catalog.signOutWarning}
        </p>
      )}
      {confirmation && (
        <ConfirmationDialog
          application={confirmation.application}
          deviceName={catalog.bootstrap?.device.name ?? copy.currentDevice}
          locale={locale}
          returnFocus={confirmation.opener}
          onCancel={() => {
            setConfirmation(undefined);
          }}
          onConfirm={() => {
            const application = confirmation.application;
            setConfirmation(undefined);
            void catalog.startAction(application);
          }}
        />
      )}
    </main>
  );
}

function CatalogToolbar({
  catalog,
  locale,
}: {
  catalog: Catalog;
  locale: Locale;
}) {
  const copy = copyFor(locale);
  return (
    <section className="toolbar">
      <label>
        {copy.search}
        <input
          value={catalog.query}
          onChange={(event) => {
            catalog.setQuery(event.target.value);
          }}
          placeholder={copy.searchPlaceholder}
        />
      </label>
      <label>
        {copy.source}
        <select
          value={catalog.sourceFilter}
          onChange={(event) =>
            catalog.setSourceFilter(event.target.value as SourceFilter)
          }
        >
          <option value="all">{copy.allSources}</option>
          <option value="winget">Winget</option>
          <option value="windows_msi">MSI</option>
          <option value="windows_exe">EXE</option>
        </select>
      </label>
      <span className="device-chip">{copy.forDevice}</span>
    </section>
  );
}

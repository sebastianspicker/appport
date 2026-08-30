import { useState } from "react";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { CatalogNavigation } from "./CatalogNavigation";
import { CatalogResults } from "./CatalogResults";
import { copyFor, type Locale } from "../i18n/copy";
import type { ReactNode } from "react";
import type { ConfirmationRequest } from "./confirmation";
import type { Catalog } from "./model";
import type { SourceFilter } from "./types";

export function CatalogPage({
  catalog,
  locale,
  sessionControls,
  supportPanel,
}: {
  catalog: Catalog;
  locale: Locale;
  sessionControls: ReactNode;
  supportPanel: ReactNode;
}) {
  const copy = copyFor(locale);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest>();
  return (
    <main>
      {sessionControls}
      {supportPanel}
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
        onConfirm={setConfirmation}
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
          onChange={(event) => {
            catalog.setSourceFilter(event.target.value as SourceFilter);
          }}
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

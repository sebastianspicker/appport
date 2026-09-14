import { AppCard } from "./AppCards";
import { copyFor, type Locale } from "../i18n/copy";
import type { ConfirmationHandler } from "./confirmation";
import type { Catalog } from "./model";
import { Status } from "../ui/Status";

export function CatalogResults({
  catalog,
  locale,
  onConfirm,
}: {
  catalog: Catalog;
  locale: Locale;
  onConfirm: ConfirmationHandler;
}) {
  if (hasNoResults(catalog))
    return (
      <p className="search-empty" role="status">
        {copyFor(locale).noSearchResults}
      </p>
    );
  if (catalog.phase !== "ready")
    return (
      <Status
        problem={catalog.phase}
        locale={locale}
        retry={() => catalog.load(catalog.view, true, true)}
      />
    );
  return (
    <section className="catalog-list" aria-live="polite">
      {catalog.rows.map((application) => (
        <AppCard
          key={application.id}
          application={application}
          action={catalog.actions.get(application.id)}
          actionFailure={catalog.actionFailures.get(application.id)}
          busy={catalog.busyApps.has(application.id)}
          iconSession={catalog.iconSession}
          catalogRevision={catalog.catalogRevision}
          locale={locale}
          onConfirm={onConfirm}
          polling={catalog.polling.get(application.id)}
          onResume={catalog.resumeAction}
          deviceName={
            catalog.bootstrap?.device.name ?? copyFor(locale).currentDevice
          }
          writesEnabled={catalog.bootstrap?.writesEnabled === true}
        />
      ))}
    </section>
  );
}

function hasNoResults(catalog: Catalog) {
  return (
    catalog.phase === "ready" &&
    (catalog.query.trim().length > 0 || catalog.sourceFilter !== "all") &&
    catalog.rows.length === 0
  );
}

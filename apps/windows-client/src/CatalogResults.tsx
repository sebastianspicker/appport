import { AppCard } from "./AppCards";
import { copyFor, type Locale } from "./appCopy";
import type { ConfirmationHandler } from "./catalogInteraction";
import { Status } from "./Status";
import type { Catalog } from "./CatalogPage";

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
      <Status problem={catalog.phase} locale={locale} retry={catalog.load} />
    );
  return (
    <section className="grid" aria-live="polite">
      {catalog.rows.map((application) => (
        <AppCard
          key={application.id}
          application={application}
          action={catalog.actions.get(application.id)}
          actionFailure={catalog.actionFailures.get(application.id)}
          busy={catalog.busy === application.id}
          iconSession={catalog.iconSession}
          locale={locale}
          onConfirm={onConfirm}
          polling={catalog.polling.get(application.id)}
          onResume={catalog.resumeAction}
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

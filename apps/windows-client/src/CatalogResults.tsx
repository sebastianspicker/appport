import { AppCard } from "./AppCards";
import { text, type Locale } from "./appCopy";
import { Status } from "./Status";
import type { AvailableApp } from "./models";
import type { Catalog } from "./CatalogPage";

export function CatalogResults({
  catalog,
  locale,
  onConfirm,
}: {
  catalog: Catalog;
  locale: Locale;
  onConfirm: (application: AvailableApp, opener: HTMLElement) => void;
}) {
  if (hasNoResults(catalog))
    return (
      <p className="search-empty" role="status">
        {text[locale].noSearchResults}
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
          action={catalog.actions[application.id]}
          actionFailure={catalog.actionFailures[application.id]}
          busy={catalog.busy === application.id}
          iconSession={catalog.iconSession}
          locale={locale}
          onConfirm={onConfirm}
          polling={catalog.polling[application.id]}
          onResume={catalog.resumeAction}
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

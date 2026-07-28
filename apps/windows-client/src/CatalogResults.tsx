import { AppCard, InstalledCard } from "./AppCards";
import { text, type Locale } from "./appCopy";
import { Status } from "./Status";
import type { AvailableApp } from "./models";
import type { Catalog } from "./CatalogPage";

export function CatalogResults({ catalog, locale, onConfirm }: { catalog: Catalog; locale: Locale; onConfirm: (application: AvailableApp, opener: HTMLElement) => void }) {
  if (hasNoResults(catalog)) return <p className="search-empty" role="status">{text[locale].noSearchResults}</p>;
  if (catalog.phase !== "ready") return <Status problem={catalog.phase} locale={locale} retry={catalog.phase === "session-expired" ? catalog.connect : catalog.load} />;
  return <section className="grid" aria-live="polite">{catalog.rows.map((application) => <CatalogRow key={"packageId" in application ? application.packageId : application.id} application={application} catalog={catalog} locale={locale} onConfirm={onConfirm} />)}</section>;
}

function hasNoResults(catalog: Catalog) { return catalog.phase === "ready" && (catalog.query.trim().length > 0 || catalog.sourceFilter !== "all") && catalog.rows.length === 0; }

function CatalogRow({ application, catalog, locale, onConfirm }: { application: Catalog["rows"][number]; catalog: Catalog; locale: Locale; onConfirm: (application: AvailableApp, opener: HTMLElement) => void }) {
  if ("packageId" in application) return <InstalledCard application={application} locale={locale} />;
  return <AppCard application={application} action={catalog.actions[application.id]} busy={catalog.busy === application.id} locale={locale} onConfirm={onConfirm} />;
}

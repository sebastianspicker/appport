import { copyFor, type Locale } from "../i18n/copy";
import { Icon } from "../ui/Icon";
import type { Catalog, SourceFilter } from "./model";

export function CatalogToolbar({
  catalog,
  locale,
}: {
  catalog: Catalog;
  locale: Locale;
}) {
  const copy = copyFor(locale);
  const filtered =
    catalog.query.trim().length > 0 || catalog.sourceFilter !== "all";
  return (
    <>
      <section className="toolbar" aria-label={copy.catalogToolbar}>
        <label className="search-field">
          <Icon name="search" size={20} />
          <input
            aria-label={copy.searchPlaceholder}
            value={catalog.query}
            onChange={(event) => {
              catalog.setQuery(event.target.value);
            }}
            placeholder={copy.searchPlaceholder}
          />
        </label>
        <label className="source-field">
          <span className="visually-hidden">{copy.source}</span>
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
      </section>
      <div className="catalog-result-bar">
        <p aria-live="polite">
          {catalog.phase === "ready" || catalog.phase === "empty"
            ? (filtered
                ? copy.filteredResultsCount
                : catalog.rows.length === 1
                  ? copy.resultCount
                  : copy.resultsCount
              )
                .replace("{count}", String(catalog.rows.length))
                .replace("{total}", String(catalog.apps.length))
            : ""}
        </p>
        {filtered && (
          <button
            className="text-button"
            onClick={() => {
              catalog.setQuery("");
              catalog.setSourceFilter("all");
            }}
          >
            {copy.clearFilters}
          </button>
        )}
      </div>
    </>
  );
}

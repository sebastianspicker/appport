import { text, type Locale } from "./appCopy";
import type { NativeBootstrap } from "./models";
import type { View } from "./useAppCatalog";

const views: View[] = ["apps", "updates"];

export function CatalogNavigation({
  bootstrap,
  locale,
  view,
  onSelect,
}: {
  bootstrap: NativeBootstrap | undefined;
  locale: Locale;
  view: View | undefined;
  onSelect: (view: View) => void;
}) {
  return (
    <nav aria-label="Software views">
      {views.map((item) => (
        <ViewButton
          key={item}
          active={view === item}
          bootstrap={bootstrap}
          item={item}
          locale={locale}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function ViewButton({
  active,
  bootstrap,
  item,
  locale,
  onSelect,
}: {
  active: boolean;
  bootstrap: NativeBootstrap | undefined;
  item: View;
  locale: Locale;
  onSelect: (view: View) => void;
}) {
  const copy = text[locale];
  const label =
    item === "apps"
      ? copy.apps
      : `${copy.updates}${bootstrap?.updates.count ? ` (${bootstrap.updates.count})` : ""}`;
  return (
    <button className={active ? "active" : ""} onClick={() => onSelect(item)}>
      {label}
    </button>
  );
}

import type { Dispatch } from "react";
import { copyFor, type Locale } from "../i18n/copy";
import type { NativeBootstrap } from "../native-bridge/types";
import type { View } from "./model";

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
  onSelect: Dispatch<View>;
}) {
  return (
    <nav className="catalog-navigation" aria-label="Software">
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
  onSelect: Dispatch<View>;
}) {
  const copy = copyFor(locale);
  const { count, label } = viewDetails(bootstrap, copy, item);
  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={`nav-item${active ? " active" : ""}`}
      onClick={() => {
        onSelect(item);
      }}
    >
      <span>{copy[item]}</span>
      {count !== undefined && (
        <span
          className={`nav-count${item === "updates" && count > 0 ? " attention" : ""}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function viewDetails(
  bootstrap: NativeBootstrap | undefined,
  copy: ReturnType<typeof copyFor>,
  item: View,
) {
  if (!bootstrap) return { count: undefined, label: copy[item] };
  const count =
    item === "apps" ? bootstrap.availableCount : bootstrap.updates.count;
  return { count, label: `${copy[item]} (${count})` };
}

import type { Dispatch } from "react";
import { copyFor, type Locale } from "../i18n/copy";
import type { NativeBootstrap } from "../native-bridge/types";
import type { View } from "./types";

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
  onSelect: Dispatch<View>;
}) {
  const copy = copyFor(locale);
  const label = bootstrap
    ? item === "apps"
      ? `${copy.apps} (${bootstrap.availableCount})`
      : `${copy.updates} (${bootstrap.updates.count})`
    : item === "apps"
      ? copy.apps
      : copy.updates;
  return (
    <button
      className={active ? "active" : ""}
      onClick={() => {
        onSelect(item);
      }}
    >
      {label}
    </button>
  );
}

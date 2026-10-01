import type { copyForBrowser } from "./copy";
import type { View } from "./data";

type Copy = ReturnType<typeof copyForBrowser>;

export function DemoHeader({ copy }: { copy: Copy }) {
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          A
        </span>
        <strong>Appport</strong>
      </div>
      <p className="device-plate">
        <span className="plate-label">{copy.assignedDevice}</span>
        <span className="device-plate-name">DEMO-PC-047</span>
        <span className="device-plate-status">{copy.compliant}</span>
      </p>
      <div className="header-actions">
        <a className="header-link" href="#support">
          {copy.supportLink}
        </a>
        <span className="header-user">Demo User</span>
      </div>
    </header>
  );
}

export function DemoNavigation({
  copy,
  counts,
  view,
  onViewChange,
}: {
  copy: Copy;
  counts: Record<View, number>;
  view: View;
  onViewChange: (view: View) => void;
}) {
  return (
    <nav className="catalog-navigation" aria-label={copy.softwareViews}>
      <NavButton
        active={view === "available"}
        count={counts.available}
        label={copy.available}
        onClick={() => onViewChange("available")}
      />
      <NavButton
        active={view === "updates"}
        attention
        count={counts.updates}
        label={copy.updates}
        onClick={() => onViewChange("updates")}
      />
    </nav>
  );
}

function NavButton({
  active,
  attention = false,
  count,
  label,
  onClick,
}: {
  active: boolean;
  attention?: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={`${label} (${count})`}
      aria-current={active ? "page" : undefined}
      className={`nav-item${active ? " active" : ""}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <span
        className={`nav-count${attention && count > 0 ? " attention" : ""}`}
      >
        {count}
      </span>
    </button>
  );
}

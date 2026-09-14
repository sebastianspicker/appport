import { Icon } from "./Icon";
import type { copyForBrowser } from "./copy";
import type { View } from "./data";

export function DemoNavigation({
  copy,
  counts,
  view,
  onViewChange,
}: {
  copy: ReturnType<typeof copyForBrowser>;
  counts: Record<View, number>;
  view: View;
  onViewChange: (view: View) => void;
}) {
  return (
    <aside className="navigation-rail">
      <div className="brand-lockup">
        <span className="brand-mark">
          <Icon name="mark" size={17} />
        </span>
        <span>
          <strong>Appport</strong>
          <small>{copy.managedSoftware}</small>
        </span>
      </div>
      <nav aria-label={copy.softwareViews}>
        <NavButton
          active={view === "available"}
          count={counts.available}
          icon="apps"
          label={copy.available}
          onClick={() => onViewChange("available")}
        />
        <NavButton
          active={view === "updates"}
          count={counts.updates}
          icon="updates"
          label={copy.updates}
          onClick={() => onViewChange("updates")}
        />
      </nav>
      <a className="nav-item support-link" href="#support">
        <Icon name="support" />
        <span>{copy.support}</span>
      </a>
      <div className="demo-session">
        <div className="device-card">
          <div className="device-name">
            <Icon name="device" size={16} />
            DEMO-PC-047
          </div>
          <p>
            <span className="online-dot" /> {copy.demoOnly} · {copy.compliant}
          </p>
        </div>
        <div className="user-row">
          <span className="avatar" aria-hidden="true">
            DU
          </span>
          <span className="user-name">Demo User</span>
        </div>
      </div>
    </aside>
  );
}

function NavButton({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  icon: "apps" | "updates";
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
      <Icon name={icon} />
      <span>{label}</span>
      <span className="nav-count">{count}</span>
    </button>
  );
}

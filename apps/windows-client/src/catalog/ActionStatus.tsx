export function ActionStatus({
  label,
  state,
  status,
}: {
  label: string;
  state: string | null | undefined;
  status: string;
}) {
  const tone =
    state === "succeeded"
      ? "success"
      : state === "failed" || state === "cancelled"
        ? "danger"
        : "neutral";
  const icon =
    state === "succeeded" ? "check" : tone === "danger" ? "error" : "updates";
  return (
    <span className={`status-pill ${tone}`} role="status">
      <Icon name={icon} size={14} />
      {state ? `${status}: ${label}` : label}
    </span>
  );
}
import { Icon } from "../ui/Icon";

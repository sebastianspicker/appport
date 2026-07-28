export function ActionStatus({ label, state, status }: { label: string; state: string | null | undefined; status: string }) {
  return <small>{state ? `${status}: ${label}` : label}</small>;
}

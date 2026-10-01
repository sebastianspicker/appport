type IconName = "check" | "error" | "search" | "warning";

const paths: Record<IconName, React.ReactNode> = {
  check: <path d="m4.5 10.5 3.6 3.6 7.4-7.6" />,
  error: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="m12.6 7.4-5.2 5.2m0-5.2 5.2 5.2" />
    </>
  ),
  search: (
    <>
      <circle cx="8.75" cy="8.75" r="5.75" />
      <path d="m13.2 13.2 3.55 3.55" />
    </>
  ),
  warning: (
    <>
      <path d="M10 3.5 17.5 16h-15L10 3.5Z" />
      <path d="M10 8v3.4M10 13.8h.01" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 20 20"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

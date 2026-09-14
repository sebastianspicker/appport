type IconName =
  | "apps"
  | "arrow"
  | "check"
  | "device"
  | "download"
  | "error"
  | "mark"
  | "search"
  | "signout"
  | "support"
  | "updates"
  | "warning";

const paths: Record<IconName, React.ReactNode> = {
  apps: (
    <>
      <rect x="3" y="3" width="5.5" height="5.5" rx="1" />
      <rect x="11.5" y="3" width="5.5" height="5.5" rx="1" />
      <rect x="3" y="11.5" width="5.5" height="5.5" rx="1" />
      <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" />
    </>
  ),
  arrow: <path d="M3 10h14m-6-6 6 6-6 6" />,
  check: <path d="m4.5 10.5 3.6 3.6 7.4-7.6" />,
  device: (
    <>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 16.5h6" />
    </>
  ),
  download: (
    <>
      <path d="M10 3v9" />
      <path d="m6.5 8.5 3.5 3.5 3.5-3.5" />
      <path d="M3.5 16.5h13" />
    </>
  ),
  error: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="m12.6 7.4-5.2 5.2m0-5.2 5.2 5.2" />
    </>
  ),
  mark: <path d="M3 17 9 3h2l6 14M6 11h8" strokeWidth="3" />,
  search: (
    <>
      <circle cx="8.75" cy="8.75" r="5.75" />
      <path d="m13.2 13.2 3.55 3.55" />
    </>
  ),
  signout: (
    <>
      <path d="M8 3.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h3" />
      <path d="M12.5 13.5 16 10l-3.5-3.5M16 10H8" />
    </>
  ),
  support: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.6 7.4a2.5 2.5 0 1 1 3.5 2.9c-.8.4-1.1.8-1.1 1.7" />
      <path d="M10 14.6h.01" />
    </>
  ),
  updates: <path d="M16 10a6 6 0 1 1-1.76-4.24M16 3.5v3h-3" />,
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

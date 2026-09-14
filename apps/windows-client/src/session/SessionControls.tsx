import { useState } from "react";
import { copyFor, type Locale } from "../i18n/copy";
import type {
  ClientProblem,
  ConnectRequest,
  NativeBootstrap,
} from "../native-bridge/types";
import { Icon } from "../ui/Icon";
import { AccountDialog } from "./AccountDialog";
import { ConnectForm } from "./ConnectForm";
import { PortalButton } from "./PortalButton";

export function SessionControls({
  bootstrap,
  locale,
  problem,
  warning,
  onConnect,
  onOpenPortal,
  onSignOut,
}: {
  bootstrap: NativeBootstrap | undefined;
  locale: Locale;
  problem?: ClientProblem;
  warning?: string;
  onConnect: (request: ConnectRequest) => Promise<void>;
  onOpenPortal: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const copy = copyFor(locale);
  const [accountOpen, setAccountOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  if (!bootstrap)
    return (
      <section className="connect-wrap" aria-labelledby="connect-title">
        <div className="connect-panel">
          <div className="connect-brand">
            <span className="brand-mark">
              <Icon name="mark" size={25} />
            </span>
            <strong>{copy.appTitle}</strong>
          </div>
          <h1 id="connect-title">{copy.signInTitle}</h1>
          <p>{copy.signInSummary}</p>
          <ConnectForm
            copy={copy}
            locale={locale}
            problem={problem}
            onConnect={onConnect}
          />
          <PortalButton copy={copy} onOpen={onOpenPortal} />
          <small className="token-guidance">{copy.tokenGuidance}</small>
        </div>
      </section>
    );
  return (
    <div className="session-controls">
      <button
        className="secondary account-button"
        onClick={(event) => {
          setOpener(event.currentTarget);
          setAccountOpen(true);
        }}
        aria-haspopup="dialog"
      >
        {copy.account}
      </button>
      {accountOpen && (
        <AccountDialog
          bootstrap={bootstrap}
          locale={locale}
          problem={problem}
          warning={warning}
          opener={opener}
          onClose={() => setAccountOpen(false)}
          onConnect={onConnect}
          onOpenPortal={onOpenPortal}
          onSignOut={onSignOut}
        />
      )}
    </div>
  );
}

import { useState } from "react";
import { copyFor, type Locale } from "../i18n/copy";
import type {
  ClientProblem,
  ConnectRequest,
  NativeBootstrap,
} from "../native-bridge/types";
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
        <div className="connect-intro">
          <div className="connect-brand">
            <span className="brand-mark" aria-hidden="true">
              A
            </span>
            <strong>{copy.appTitle}</strong>
          </div>
          <p className="connect-pitch">{copy.signInPitch}</p>
          <ol className="connect-steps">
            {copy.signInSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <div className="connect-panel">
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

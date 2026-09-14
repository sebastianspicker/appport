import { useRef, useState } from "react";
import { copyFor, type Locale } from "../i18n/copy";
import type {
  ClientProblem,
  ConnectRequest,
  NativeBootstrap,
} from "../native-bridge/types";
import { useModalDialog } from "../ui/useModalDialog";
import { ConnectForm } from "./ConnectForm";
import { PortalButton } from "./PortalButton";

export function AccountDialog({
  bootstrap,
  locale,
  problem,
  warning,
  opener,
  onClose,
  onConnect,
  onOpenPortal,
  onSignOut,
}: {
  bootstrap: NativeBootstrap;
  locale: Locale;
  problem?: ClientProblem;
  warning?: string;
  opener: HTMLElement | null;
  onClose: () => void;
  onConnect: (request: ConnectRequest) => Promise<void>;
  onOpenPortal: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const copy = copyFor(locale);
  const dialogRef = useModalDialog(opener);
  const pending = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signOut() {
    if (pending.current) return;
    pending.current = true;
    setSigningOut(true);
    setFailed(false);
    try {
      await onSignOut();
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setSigningOut(false);
    }
  }
  return (
    <dialog
      ref={dialogRef}
      className="account-dialog"
      aria-labelledby="account-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!signingOut) onClose();
      }}
    >
      <header className="account-header">
        <h2 id="account-title">{copy.account}</h2>
        <button
          className="secondary"
          autoFocus
          disabled={signingOut}
          onClick={onClose}
        >
          {copy.close}
        </button>
      </header>
      <div className="account-identity">
        <strong>{bootstrap.user.displayName}</strong>
        <p>
          {copy.forThisDevice}: {bootstrap.device.name}
        </p>
        <p>
          {copy.supportDeviceStatus}: {bootstrap.device.status}
        </p>
      </div>
      <fieldset className="account-settings" disabled={signingOut}>
        <details className="replace-token">
          <summary>{copy.replaceToken}</summary>
          <ConnectForm
            copy={copy}
            locale={locale}
            problem={problem}
            onConnect={onConnect}
            replacing
          />
        </details>
        <PortalButton copy={copy} onOpen={onOpenPortal} />
        <p className="token-guidance">{copy.tokenGuidance}</p>
      </fieldset>
      <div className="account-actions">
        <button
          className="secondary"
          disabled={signingOut}
          onClick={() => void signOut()}
        >
          {signingOut ? copy.signingOut : copy.signOut}
        </button>
      </div>
      {signingOut && (
        <p className="connect-status" role="status">
          {copy.signOutWaiting}
        </p>
      )}
      {(failed || warning) && (
        <p className="inline-error" role="alert">
          {failed ? copy.signOutFailed : warning}
        </p>
      )}
    </dialog>
  );
}

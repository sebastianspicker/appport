import { useRef, useState } from "react";
import type { Copy } from "../i18n/copy";

export function PortalButton({
  copy,
  onOpen,
}: {
  copy: Copy;
  onOpen: () => Promise<void>;
}) {
  const pending = useRef(false);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  async function open() {
    if (pending.current) return;
    pending.current = true;
    setOpening(true);
    setFailed(false);
    try {
      await onOpen();
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setOpening(false);
    }
  }
  return (
    <>
      <button
        className="portal-link"
        disabled={opening}
        onClick={() => void open()}
      >
        {opening ? copy.portalOpening : copy.manageToken}
      </button>
      {opening && (
        <p role="status" className="connect-status">
          {copy.portalOpening}
        </p>
      )}
      {failed && (
        <p role="alert" className="inline-error">
          {copy.portalFailed}
        </p>
      )}
    </>
  );
}

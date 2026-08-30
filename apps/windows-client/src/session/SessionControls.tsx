import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { copyFor, type Copy, type Locale } from "../i18n/copy";
import type { ConnectRequest, NativeBootstrap } from "../native-bridge/types";
import { native } from "../native-bridge/native";

export function SessionControls({
  bootstrap,
  locale,
  onConnect,
  onOpenPortal,
  onSignOut,
}: {
  bootstrap: NativeBootstrap | undefined;
  locale: Locale;
  onConnect: (request: ConnectRequest) => Promise<void>;
  onOpenPortal: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const copy: Copy = copyFor(locale);
  const device = bootstrap
    ? `${bootstrap.user.displayName} · ${bootstrap.device.name}`
    : copy.currentDevice;
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">RELUTION</p>
          <h1>Appport</h1>
          <p className="device">{device}</p>
        </div>
        <div className="session-controls">
          {bootstrap ? (
            <>
              <details className="replace-token">
                <summary>{copy.replaceToken}</summary>
                <ConnectForm copy={copy} onConnect={onConnect} />
              </details>
              <button
                className="secondary"
                onClick={() => {
                  void onSignOut();
                }}
              >
                {copy.signOut}
              </button>
            </>
          ) : (
            <ConnectForm copy={copy} onConnect={onConnect} />
          )}
          <button
            className="portal-link"
            onClick={() => {
              void onOpenPortal();
            }}
          >
            {copy.manageToken}
          </button>
        </div>
      </header>
    </>
  );
}

function ConnectForm({
  copy,
  onConnect,
}: {
  copy: Copy;
  onConnect: (request: ConnectRequest) => Promise<void>;
}) {
  const [relutionUsername, setRelutionUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [isPending, setIsPending] = useState(false);
  const loginPending = useRef(false);
  const usernameInput = useRef<HTMLInputElement>(null);
  const secretInput = useRef<HTMLInputElement>(null);

  const clearCredentials = useCallback(() => {
    setRelutionUsername("");
    setSecret("");
    if (usernameInput.current) usernameInput.current.value = "";
    if (secretInput.current) secretInput.current.value = "";
  }, []);

  useEffect(() => clearCredentials, [clearCredentials]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (loginPending.current) return;
    const username = relutionUsername;
    const request = {
      authMethod: "personal_token" as const,
      relutionUsername: username,
      accessToken: secret,
    };
    loginPending.current = true;
    setIsPending(true);
    clearCredentials();
    void onConnect(request).finally(() => {
      loginPending.current = false;
      setIsPending(false);
    });
  }

  return (
    <form className="connect-form" onSubmit={submit}>
      <label>
        {copy.relutionUsername}
        <input
          ref={usernameInput}
          name="relution-username"
          autoComplete="username"
          disabled={isPending}
          required
          value={relutionUsername}
          onChange={(event) => {
            setRelutionUsername(event.target.value);
          }}
        />
      </label>
      <label>
        {copy.accessToken}
        <input
          ref={secretInput}
          name="relution-access-token"
          type="password"
          autoComplete="off"
          disabled={isPending}
          required
          value={secret}
          onChange={(event) => {
            setSecret(event.target.value);
          }}
        />
      </label>
      <button className="secondary" disabled={isPending} type="submit">
        {copy.connect}
      </button>
      <small>{copy.tokenGuidance}</small>
    </form>
  );
}

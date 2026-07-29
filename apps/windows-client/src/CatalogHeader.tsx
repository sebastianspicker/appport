import { useRef, useState, type FormEvent } from "react";
import { copyFor, type Copy, type Locale } from "./appCopy";
import type { NativeBootstrap } from "./models";

export function CatalogHeader({
  bootstrap,
  locale,
  onConnect,
  onOpenPortal,
  onSignOut,
}: {
  bootstrap: NativeBootstrap | undefined;
  locale: Locale;
  onConnect: (relutionUsername: string, accessToken: string) => Promise<void>;
  onOpenPortal: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const copy: Copy = copyFor(locale);
  const device = bootstrap
    ? `${bootstrap.user.displayName} · ${bootstrap.device.name}`
    : copy.currentDevice;
  return (
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
  );
}

function ConnectForm({
  copy,
  onConnect,
}: {
  copy: Copy;
  onConnect: (relutionUsername: string, accessToken: string) => Promise<void>;
}) {
  const [relutionUsername, setRelutionUsername] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const usernameInput = useRef<HTMLInputElement>(null);
  const tokenInput = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const username = relutionUsername;
    const token = accessToken;
    const operation = onConnect(username, token);
    setRelutionUsername("");
    setAccessToken("");
    if (usernameInput.current) usernameInput.current.value = "";
    if (tokenInput.current) tokenInput.current.value = "";
    void operation;
  }

  return (
    <form className="connect-form" onSubmit={submit}>
      <label>
        {copy.relutionUsername}
        <input
          ref={usernameInput}
          name="relution-username"
          autoComplete="username"
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
          ref={tokenInput}
          name="relution-access-token"
          type="password"
          autoComplete="off"
          required
          value={accessToken}
          onChange={(event) => {
            setAccessToken(event.target.value);
          }}
        />
      </label>
      <button className="secondary" type="submit">
        {copy.connect}
      </button>
      <small>{copy.tokenGuidance}</small>
    </form>
  );
}

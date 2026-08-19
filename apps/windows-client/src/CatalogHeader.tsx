import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { copyFor, type Copy, type Locale } from "./appCopy";
import type { AuthCapabilities, AuthMethod, NativeBootstrap } from "./models";
import { native } from "./native";
import type { useConnect } from "./useAppCatalog";

export function CatalogHeader({
  bootstrap,
  locale,
  onConnect,
  onOpenPortal,
  onSignOut,
}: {
  bootstrap: NativeBootstrap | undefined;
  locale: Locale;
  onConnect: ReturnType<typeof useConnect>["connect"];
  onOpenPortal: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const copy: Copy = copyFor(locale);
  const [authCapabilities, setAuthCapabilities] = useState<AuthCapabilities>({
    personalToken: true,
    password: false,
  });
  useEffect(() => {
    let active = true;
    void native
      .authCapabilities()
      .then((capabilities) => {
        if (active) setAuthCapabilities(capabilities);
      })
      .catch(() => {
        // Keep the safe token-only form when capability discovery is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);
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
              <ConnectForm
                authCapabilities={authCapabilities}
                copy={copy}
                onConnect={onConnect}
              />
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
          <ConnectForm
            authCapabilities={authCapabilities}
            copy={copy}
            onConnect={onConnect}
          />
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
  authCapabilities,
  copy,
  onConnect,
}: {
  authCapabilities: AuthCapabilities;
  copy: Copy;
  onConnect: ReturnType<typeof useConnect>["connect"];
}) {
  const [method, setMethod] = useState<AuthMethod>("personal_token");
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

  function changeMethod(nextMethod: AuthMethod) {
    if (nextMethod === method) return;
    clearCredentials();
    setMethod(nextMethod);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (loginPending.current) return;
    const username = relutionUsername;
    const request =
      method === "password"
        ? { authMethod: method, relutionUsername: username, password: secret }
        : {
            authMethod: method,
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

  const secretLabel = method === "password" ? copy.password : copy.accessToken;
  const secretGuidance =
    method === "password" ? copy.passwordGuidance : copy.tokenGuidance;

  return (
    <form className="connect-form" onSubmit={submit}>
      {authCapabilities.password ? (
        <fieldset>
          <legend>{copy.authMethod}</legend>
          <label>
            <input
              checked={method === "personal_token"}
              disabled={isPending}
              name="auth-method"
              onChange={() => {
                changeMethod("personal_token");
              }}
              type="radio"
            />
            {copy.personalTokenMethod}
          </label>
          <label>
            <input
              checked={method === "password"}
              disabled={isPending}
              name="auth-method"
              onChange={() => {
                changeMethod("password");
              }}
              type="radio"
            />
            {copy.password}
          </label>
        </fieldset>
      ) : null}
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
        {secretLabel}
        <input
          ref={secretInput}
          name={
            method === "password"
              ? "relution-password"
              : "relution-access-token"
          }
          type="password"
          autoComplete={method === "password" ? "current-password" : "off"}
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
      <small>{secretGuidance}</small>
    </form>
  );
}

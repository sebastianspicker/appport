import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { problemCopy, type Copy, type Locale } from "../i18n/copy";
import type { ClientProblem, ConnectRequest } from "../native-bridge/types";

export function ConnectForm({
  copy,
  locale,
  problem,
  onConnect,
  replacing = false,
}: {
  copy: Copy;
  locale: Locale;
  problem?: ClientProblem;
  onConnect: (request: ConnectRequest) => Promise<void>;
  replacing?: boolean;
}) {
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const usernameInput = useRef<HTMLInputElement>(null);
  const tokenInput = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();
  const clearCredentials = useCallback(() => {
    setUsername("");
    setSecret("");
    if (usernameInput.current) usernameInput.current.value = "";
    if (tokenInput.current) tokenInput.current.value = "";
  }, []);
  useEffect(() => clearCredentials, [clearCredentials]);
  const visibleProblem =
    submitted && !isPending ? (failed ? "unknown" : problem) : undefined;
  const error = connectionError(locale, visibleProblem);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    setSubmitted(true);
    setFailed(false);
    const request = {
      authMethod: "personal_token" as const,
      relutionUsername: username,
      accessToken: secret,
    };
    clearCredentials();
    try {
      await onConnect(request);
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setIsPending(false);
    }
  }
  return (
    <form
      className="connect-form"
      onSubmit={(event) => void submit(event)}
      aria-busy={isPending}
    >
      <label>
        {copy.relutionUsername}
        <input
          ref={usernameInput}
          name="relution-username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={!replacing}
          disabled={isPending}
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label>
        {copy.accessToken}
        <input
          ref={tokenInput}
          name="relution-access-token"
          type="password"
          autoComplete="off"
          aria-describedby={hintId}
          disabled={isPending}
          required
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
      </label>
      <small id={hintId}>{copy.tokenHint}</small>
      {error && (
        <div className="connect-error inline-error" role="alert" id={errorId}>
          <span>
            <strong>{error[0]}</strong>
            <br />
            {error[1]}
          </span>
        </div>
      )}
      <button className="primary" disabled={isPending} type="submit">
        {isPending
          ? copy.signingIn
          : replacing
            ? copy.replaceToken
            : copy.signIn}
      </button>
      {isPending && (
        <span role="status" className="connect-status">
          {copy.signingIn}
        </span>
      )}
    </form>
  );
}

function connectionError(locale: Locale, problem?: ClientProblem) {
  if (!problem || ["loading", "empty"].includes(problem)) return undefined;
  return problemCopy(locale, problem);
}

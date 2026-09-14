import { copyFor, problemCopy, type Copy, type Locale } from "../i18n/copy";
import type { ClientProblem } from "../native-bridge/types";
import { Icon } from "./Icon";

export function Status({
  problem,
  retry,
  locale,
}: {
  problem: ClientProblem;
  retry: () => Promise<void>;
  locale: Locale;
}) {
  const copy = copyFor(locale);
  const [title, body] = problemCopy(locale, problem);
  return (
    <section className="state" role={statusRole(problem)}>
      {problem !== "loading" && (
        <Icon name={problem === "empty" ? "apps" : "warning"} size={24} />
      )}
      <h2>{title}</h2>
      <p>{body}</p>
      {problem === "loading" && (
        <span
          className="indeterminate-progress loading-progress"
          role="progressbar"
          aria-label={title}
        >
          <i />
        </span>
      )}
      <StatusRetry
        problem={problem}
        retry={retry}
        label={retryLabel(problem, copy)}
      />
    </section>
  );
}

function statusRole(problem: ClientProblem) {
  return problem === "loading" || problem === "empty" ? "status" : "alert";
}
function retryLabel(problem: ClientProblem, copy: Copy) {
  return problem === "session-expired" ? copy.signIn : copy.retry;
}
function StatusRetry({
  problem,
  retry,
  label,
}: {
  problem: ClientProblem;
  retry: () => Promise<void>;
  label: string;
}) {
  if (
    [
      "loading",
      "empty",
      "authorization-denied",
      "device-match-failed",
      "session-expired",
    ].includes(problem)
  )
    return null;
  return (
    <button
      className="secondary action-button"
      onClick={() => {
        void retry();
      }}
    >
      {label}
    </button>
  );
}

"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function OidcSignInButton({
  className,
  callbackURL,
}: {
  className: string;
  callbackURL: string;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    setError("");
    const result = await authClient.signIn.oauth2({
      providerId: "relution-oidc",
      callbackURL,
      errorCallbackURL: `/sign-in?returnTo=${encodeURIComponent(callbackURL)}&error=oidc`,
    });
    if (result.error) {
      setError("Sign-in could not be started. Try again or contact support.");
      setPending(false);
    }
  }

  return (
    <>
      <button
        className={className}
        disabled={pending}
        onClick={() => void signIn()}
        type="button"
      >
        {pending ? "Opening sign-in…" : "Sign in with your organization"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

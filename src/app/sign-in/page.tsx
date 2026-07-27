import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthMode } from "@/server/auth/config";
import { getPortalUser } from "@/server/auth/session";
import { OidcSignInButton } from "@/components/auth/OidcSignInButton";
import { nativeConnectReturnTo } from "@/server/native/validation";
import styles from "./sign-in.module.css";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const parameters = await searchParams;
  const returnTo = nativeConnectReturnTo(parameters.returnTo);
  if (!returnTo) {
    redirect("/");
  }
  if (await getPortalUser()) {
    redirect(returnTo);
  }
  const mode = getAuthMode();

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="sign-in-heading">
        <div className={styles.brandMark} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <p className={styles.eyebrow}>Windows application</p>
        <h1 id="sign-in-heading">Connect Appport</h1>
        <p className={styles.copy}>
          Sign in to connect Appport on this Windows device.
        </p>
        {parameters.error && (
          <p className={styles.error} role="alert">
            Sign-in could not be completed. Try again from the Windows app.
          </p>
        )}
        {mode === "mock" ? (
          <form action="/api/auth/mock/sign-in" method="post">
            <input name="returnTo" type="hidden" value={returnTo} />
            <button className={styles.button} type="submit">
              Connect mock Appport
            </button>
          </form>
        ) : (
          <OidcSignInButton className={styles.button} callbackURL={returnTo} />
        )}
        <p className={styles.help}>
          Access is limited to the current managed device and software assigned
          to your account.
        </p>
      </section>
    </main>
  );
}

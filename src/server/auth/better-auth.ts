import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { getAuthMode, getAuthSecret, requireOidcConfig } from "./config";

const SESSION_TTL_SECONDS = 8 * 60 * 60;

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  authInstance ??= createAuth();
  return authInstance;
}

export function resetAuthForTests() {
  authInstance = undefined;
}

function createAuth() {
  const mode = getAuthMode();
  const oidc = mode === "oidc" ? requireOidcConfig() : null;
  return betterAuth({
    appName: "Appport",
    secret: getAuthSecret(),
    baseURL: oidc?.baseUrl ?? "http://localhost:3000",
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    },
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      disableSessionRefresh: true,
      cookieCache: {
        enabled: true,
        maxAge: SESSION_TTL_SECONDS,
        strategy: "jwe",
        refreshCache: true,
      },
    },
    account: {
      storeStateStrategy: "cookie",
      storeAccountCookie: true,
    },
    plugins: oidc
      ? [
          genericOAuth({
            config: [
              {
                providerId: "relution-oidc",
                discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
                clientId: oidc.clientId,
                clientSecret: oidc.clientSecret,
                scopes: ["openid", "profile", "email"],
                pkce: true,
                requireIssuerValidation: true,
                mapProfileToUser: (profile) => {
                  const username = profile[oidc.usernameClaim];
                  if (typeof username !== "string" || username.trim() === "") {
                    throw new Error(
                      `OIDC profile is missing ${oidc.usernameClaim}.`,
                    );
                  }
                  return {
                    id: String(profile.sub),
                    name:
                      typeof profile.name === "string"
                        ? profile.name
                        : username,
                    email:
                      typeof profile.email === "string"
                        ? profile.email
                        : `${username}@invalid.local`,
                    relutionUsername: username,
                  };
                },
              },
            ],
          }),
        ]
      : [],
    user: {
      additionalFields: {
        relutionUsername: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
  });
}

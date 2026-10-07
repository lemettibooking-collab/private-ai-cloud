import { isProxy } from "node:util/types";
import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";

// AI-038.2a Auth.js configuration (server-only; instantiated in `./next-auth.server`).
//
// Authentication only. GitHub is the one concrete provider; PAC authorization stays in the database
// (AI-038.1). Credentials come exclusively from the environment through Auth.js' own defaults
// (AUTH_SECRET, AUTH_GITHUB_ID, AUTH_GITHUB_SECRET); there are no fallback constants.
//
// Session strategy: stateless JWT, no Auth.js database adapter, no Auth.js-owned tables.
// The token and the session carry ONLY `pacIdentity: { provider, providerSubject }`:
//   * provider        = "github"
//   * providerSubject = account.providerAccountId (GitHub's stable numeric account id, String(profile.id)).
// Auth.js' `user.id` is a random UUID per sign-in, so it is never used; email, login, name, avatar,
// OAuth access/refresh/id tokens and the authorization code are never copied anywhere.

export const pacAuthProvider = "github" as const;

export type PacAuthIdentity = Readonly<{ provider: typeof pacAuthProvider; providerSubject: string }>;

// GitHub account ids are positive integers; bounded to 20 digits.
const githubSubjectPattern = /^[1-9][0-9]{0,19}$/u;

function ownData(input: unknown, key: string): unknown {
  try {
    if (typeof input !== "object" || input === null || isProxy(input) || Array.isArray(input)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function identity(provider: unknown, providerSubject: unknown): PacAuthIdentity | null {
  return provider === pacAuthProvider && typeof providerSubject === "string" && githubSubjectPattern.test(providerSubject)
    ? Object.freeze({ provider: pacAuthProvider, providerSubject })
    : null;
}

// From the OAuth account at sign-in: only `provider` and `providerAccountId` are read.
export function pacIdentityFromAccount(account: unknown): PacAuthIdentity | null {
  return identity(ownData(account, "provider"), ownData(account, "providerAccountId"));
}

// From our own token or session projection: exactly `{ provider, providerSubject }`.
export function pacIdentityFromProjection(input: unknown): PacAuthIdentity | null {
  try {
    if (typeof input !== "object" || input === null || isProxy(input) || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes("provider") || !keys.includes("providerSubject")) return null;
    return identity(ownData(input, "provider"), ownData(input, "providerSubject"));
  } catch {
    return null;
  }
}

type CallbackToken = Record<string, unknown>;

// The JWT holds nothing but the PAC identity projection. Returning null ends the session.
export function pacJwtCallback(params: Readonly<{ token: unknown; account?: unknown }>): CallbackToken | null {
  const pacIdentity = params.account
    ? pacIdentityFromAccount(params.account)
    : pacIdentityFromProjection(ownData(params.token, "pacIdentity"));
  return pacIdentity ? { pacIdentity: { provider: pacIdentity.provider, providerSubject: pacIdentity.providerSubject } } : null;
}

// The session object (also returned by /api/auth/session to the signed-in browser) exposes only the
// expiry and the PAC identity projection: no user name/email/image, no tokens.
export function pacSessionCallback(params: Readonly<{ session: unknown; token: unknown }>): Record<string, unknown> {
  const expires = ownData(params.session, "expires");
  const pacIdentity = pacIdentityFromProjection(ownData(params.token, "pacIdentity"));
  return {
    expires: typeof expires === "string" ? expires : new Date(0).toISOString(),
    ...(pacIdentity ? { pacIdentity: { provider: pacIdentity.provider, providerSubject: pacIdentity.providerSubject } } : {}),
  };
}

// Auth.js errors may carry provider responses; only the error name/code is logged.
const sanitizedLogger = Object.freeze({
  error(error: Error) {
    const name = typeof error === "object" && error !== null && typeof error.name === "string" ? error.name : "AuthError";
    console.error(`[auth] ${name}`);
  },
  warn(code: string) {
    console.warn(`[auth] warning ${typeof code === "string" ? code : "unknown"}`);
  },
  debug() {},
});

export function createPacAuthConfig(): NextAuthConfig {
  return {
    // Credentials are filled from AUTH_GITHUB_ID / AUTH_GITHUB_SECRET by Auth.js; email account
    // linking stays at its default (disabled) and no adapter is configured.
    providers: [GitHub],
    session: { strategy: "jwt" },
    debug: false,
    logger: sanitizedLogger,
    callbacks: {
      jwt: (params) => pacJwtCallback(params) as never,
      session: (params) => pacSessionCallback(params) as never,
    },
  };
}

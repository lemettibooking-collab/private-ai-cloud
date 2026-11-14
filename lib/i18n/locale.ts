// AI-038.6 Owner Console UI locale (pure; no I/O, no authority).
//
// The locale is a PRESENTATION preference only. It never takes part in auth, workspace resolution,
// project trust, tenant filtering, mutations, idempotency, audit or approvals. Domain / storage enum
// values stay canonical (English tokens); only their displayed labels are localized.

export const locales = ["ru", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ru";

// The only state: one cookie holding exactly "ru" or "en". Not HttpOnly (the switcher sets it in the
// browser); it carries no user, workspace, project or auth information.
export const localeCookieName = "pac_locale";
export const localeCookieMaxAgeSeconds = 60 * 60 * 24 * 365;

// Strict: anything other than exactly "ru" / "en" (missing, "RU", "en-US", arrays, objects…) is the
// default locale. There is no browser-language detection.
export function parseLocale(value: unknown): Locale {
  return value === "ru" || value === "en" ? value : defaultLocale;
}

export function serializeLocaleCookie(locale: Locale, secure: boolean): string {
  return `${localeCookieName}=${parseLocale(locale)}; Path=/; Max-Age=${localeCookieMaxAgeSeconds}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

// "{name}"-style placeholder substitution for dictionary templates. Unknown placeholders stay visible
// (a test catches unbalanced templates); values are rendered as plain text by React.
export function format(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/gu, (match, key: string) => (Object.hasOwn(values, key) ? String(values[key]) : match));
}

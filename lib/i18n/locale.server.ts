// AI-038.6: the ONE canonical server-side locale resolver (Server Components only).
// Reads the `pac_locale` preference cookie of the current request; anything but exactly "ru" / "en"
// is the default ("ru"). Memoized per request with React `cache`. The locale is presentation only:
// it is never passed to auth, workspace / project resolution, reads, mutations or audit.
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { localeCookieName, parseLocale, type Locale } from "./locale";
import { messages, type Messages } from "./messages";

export const getLocale = cache(async (): Promise<Locale> => parseLocale((await cookies()).get(localeCookieName)?.value));

export const getI18n = cache(async (): Promise<Readonly<{ locale: Locale; t: Messages }>> => {
  const locale = await getLocale();
  return Object.freeze({ locale, t: messages[locale] });
});

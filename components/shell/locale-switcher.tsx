"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "@/components/shell/icons";
import { locales, parseLocale, serializeLocaleCookie, type Locale } from "@/lib/i18n/locale";

// AI-038.6 interface-language selector (a LANGUAGE selector, not a country selector).
// Selecting a language only writes the `pac_locale` preference cookie and calls router.refresh():
// the pathname, `?project=` context and any task / run detail path stay exactly as they are. No API
// route, Server Action, DB write or navigation is involved; the locale grants nothing.

// Native names are fixed (each language is named in itself); flags are decorative.
const options: Readonly<Record<Locale, { flag: string; code: string; name: string }>> = {
  ru: { flag: "🇷🇺", code: "RU", name: "Русский" },
  en: { flag: "🇬🇧", code: "EN", name: "English" },
};

// The only side effect: the preference cookie (Path=/, SameSite=Lax, ~1 year, Secure on HTTPS).
function writeLocalePreference(locale: Locale) {
  document.cookie = serializeLocaleCookie(parseLocale(locale), window.location.protocol === "https:");
}

type LocaleSwitcherProps = {
  locale: Locale;
  // Localized in the CURRENT language, e.g. "Язык интерфейса: Русский" / "Interface language: English".
  ariaLabel: string;
  menuLabel: string;
};

export function LocaleSwitcher({ locale, ariaLabel, menuLabel }: LocaleSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = options[parseLocale(locale)];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(next: Locale) {
    const value = parseLocale(next);
    setOpen(false);
    if (value === locale) return;
    writeLocalePreference(value);
    router.refresh();
  }

  return (
    <div className="relative" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="pac-control flex h-8 items-center gap-1.5 px-2.5 text-[12px] font-medium text-ink-2 hover:text-ink"
        onClick={() => setOpen((value) => !value)}
        ref={button}
        type="button"
      >
        <span aria-hidden className="font-sans text-[13px] leading-none">{current.flag}</span>
        <span>{current.code}</span>
        <ChevronIcon className={`h-3 w-3 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul aria-label={menuLabel} className="pac-popover absolute right-0 z-30 mt-2 w-44 p-1.5" role="listbox">
          {locales.map((value) => {
            const option = options[value];
            const selected = value === locale;
            return (
              <li aria-selected={selected} key={value} role="option">
                <button
                  className={`flex w-full items-center gap-2.5 rounded-[7px] border border-transparent px-2.5 py-1.5 text-left text-[13px] ${
                    selected ? "pac-nav-active text-ink" : "text-ink-2 hover:bg-panel-2 hover:text-ink"}`}
                  lang={value}
                  onClick={() => choose(value)}
                  type="button"
                >
                  <span aria-hidden className="text-[14px] leading-none">{option.flag}</span>
                  <span className="flex-1">{option.name}</span>
                  <span className="text-[11px] font-medium text-ink-3">{option.code}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

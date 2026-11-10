import { z } from "zod";

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";

export const localeSchema = z.enum(LOCALES);

export function isLocale(value: string): value is Locale {
  return localeSchema.safeParse(value).success;
}

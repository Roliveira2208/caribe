import { getTranslations } from "next-intl/server";
import type { TodayRateBadgeLabels } from "@/components/today-rate-badge";

/**
 * Traducciones del badge resueltas en el servidor y pasadas como props
 * serializables al componente cliente. Así el search de claves de
 * `test/messages.test.ts` encuentra las claves `todayRate.*` en un único
 * namespace por archivo.
 */
export async function loadTodayRateLabels(): Promise<TodayRateBadgeLabels> {
  const t = await getTranslations("todayRate");
  return {
    label: t("label"),
    unit: t("unit"),
    datePrefix: t("datePrefix"),
    unavailable: t("unavailable"),
    loading: t("loading"),
  };
}

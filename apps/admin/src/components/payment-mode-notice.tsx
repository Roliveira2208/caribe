import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Alert } from "antd";
import { getTenantSettings } from "@/lib/tenant-settings-client";

interface PaymentModeNoticeProps {
  /** Solo se muestra para una agencia activa; el modo plataforma no tiene modo propio. */
  visible: boolean;
}

/**
 * Modo de aprobación de pagos de la agencia activa (spec `admin-ui`). Solo
 * owner/admin con agencia activa: cualquier 403/404 se traduce como no
 * disponible, nunca como un modo inventado.
 */
export async function PaymentModeNotice({ visible }: PaymentModeNoticeProps) {
  if (!visible) return null;
  const t = await getTranslations("paymentMode");
  const cookieStore = await cookies();
  let title = t("unavailable");
  try {
    const settings = await getTenantSettings({ cookieHeader: cookieStore.toString() });
    title = t(settings.paymentMode === "AUTO" ? "automatic" : "manual");
  } catch {
    // Modo indeterminado: se anuncia como no disponible y las acciones se ocultan.
  }
  return <Alert type="info" showIcon title={title} style={{ marginBottom: 16 }} />;
}

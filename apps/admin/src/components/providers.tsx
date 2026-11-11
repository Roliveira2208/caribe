"use client";

import type { ReactNode } from "react";
import { ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import esES from "antd/locale/es_ES";
import type { Locale } from "@caribe/shared";

interface ProvidersProps {
  locale: Locale;
  children: ReactNode;
}

/** ConfigProvider de antd con el paquete de idioma activo (es_ES / en_US). */
export function Providers({ locale, children }: ProvidersProps) {
  const antdLocale = locale === "en" ? enUS : esES;
  return <ConfigProvider locale={antdLocale}>{children}</ConfigProvider>;
}

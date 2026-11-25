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

/** ConfigProvider de antd con el paquete de idioma activo (es_ES / en_US) y los tokens Caribe. */
export function Providers({ locale, children }: ProvidersProps) {
  const antdLocale = locale === "en" ? enUS : esES;
  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        token: {
          colorPrimary: "#0E2A3D",
          colorWarning: "#F4A300",
          colorSuccess: "#1FA6A0",
          colorBgLayout: "#FBF7EF",
        },
        components: {
          Button: { primaryColor: "#FFFFFF" },
          Layout: { headerBg: "#FBF7EF", bodyBg: "#FBF7EF" },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}

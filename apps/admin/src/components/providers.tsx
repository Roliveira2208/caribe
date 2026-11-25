"use client";

import type { ReactNode } from "react";
import { ConfigProvider } from "antd";
import type { Locale } from "antd/es/locale";
import enUS from "antd/locale/en_US";
import esES from "antd/locale/es_ES";
import { useTranslations } from "next-intl";
import type { Locale as AppLocale } from "@caribe/shared";

interface ProvidersProps {
  locale: AppLocale;
  children: ReactNode;
}

/**
 * ConfigProvider de antd con los tokens Caribe. Los textos que antd pinta por su
 * cuenta (validación, vacíos, paginación, diálogos) se sobreescriben con los
 * mensajes es/en del panel: ninguna cadena visible depende del paquete de antd.
 */
export function Providers({ locale, children }: ProvidersProps) {
  const t = useTranslations("antd");
  const base = locale === "en" ? enUS : esES;
  const baseForm = base.Form ?? { defaultValidateMessages: {} };
  const label = "${label}";
  const typeMessage = t("form.type", { label, type: "${type}" });

  const antdLocale: Locale = {
    ...base,
    global: {
      ...base.global,
      placeholder: t("global.placeholder"),
      close: t("global.close"),
    },
    Table: {
      ...base.Table,
      emptyText: t("table.emptyText"),
      filterTitle: t("table.filterTitle"),
      filterConfirm: t("table.filterConfirm"),
      filterReset: t("table.filterReset"),
      filterEmptyText: t("table.filterEmptyText"),
      filterCheckAll: t("table.filterCheckAll"),
      filterSearchPlaceholder: t("table.filterSearchPlaceholder"),
      sortTitle: t("table.sortTitle"),
      triggerDesc: t("table.triggerDesc"),
      triggerAsc: t("table.triggerAsc"),
      cancelSort: t("table.cancelSort"),
    },
    Modal: {
      ...base.Modal,
      okText: t("modal.okText"),
      cancelText: t("modal.cancelText"),
      justOkText: t("modal.justOkText"),
    },
    Popconfirm: {
      ...base.Popconfirm,
      okText: t("popconfirm.okText"),
      cancelText: t("popconfirm.cancelText"),
    },
    Pagination: {
      ...base.Pagination,
      items_per_page: t("pagination.itemsPerPage"),
      jump_to: t("pagination.jumpTo"),
      jump_to_confirm: t("pagination.jumpToConfirm"),
      page: t("pagination.page"),
      prev_page: t("pagination.prevPage"),
      next_page: t("pagination.nextPage"),
      prev_5: t("pagination.prev5"),
      next_5: t("pagination.next5"),
      prev_3: t("pagination.prev3"),
      next_3: t("pagination.next3"),
      page_size: t("pagination.pageSize"),
    },
    Empty: {
      ...base.Empty,
      description: t("emptyDescription"),
    },
    Form: {
      ...base.Form,
      optional: t("form.optional"),
      defaultValidateMessages: {
        ...baseForm.defaultValidateMessages,
        default: t("form.default", { label }),
        required: t("form.required", { label }),
        whitespace: t("form.whitespace", { label }),
        types: {
          ...baseForm.defaultValidateMessages.types,
          string: typeMessage,
          method: typeMessage,
          array: typeMessage,
          object: typeMessage,
          number: typeMessage,
          date: typeMessage,
          boolean: typeMessage,
          integer: typeMessage,
          float: typeMessage,
          regexp: typeMessage,
          email: typeMessage,
          url: typeMessage,
          hex: typeMessage,
        },
        string: {
          ...baseForm.defaultValidateMessages.string,
          len: t("form.stringLen", { label, len: "${len}" }),
        },
        pattern: {
          ...baseForm.defaultValidateMessages.pattern,
          mismatch: t("form.patternMismatch", { label, pattern: "${pattern}" }),
        },
      },
    },
  };

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

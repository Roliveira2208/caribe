"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@caribe/shared";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  availabilityApiUrl,
  detailApiUrl,
  parseAvailabilityView,
  parseProductDetailView,
  staySelectionFromParams,
  type CatalogAvailabilityView,
  type CatalogProductDetailView,
} from "@/lib/detail-view";
import {
  ProductDetailView,
  type DetailStatus,
  type DetailViewLabels,
} from "./product-detail-view";

/** Parte interactiva de `/[locale]/hotels/[id]`: consulta detalle y disponibilidad. */
export function ProductDetailExperience({
  locale,
  productId,
}: {
  locale: Locale;
  productId: string;
}) {
  const t = useTranslations("detail");
  const params = useSearchParams();
  const selection = useMemo(() => staySelectionFromParams(params), [params]);
  const availabilityUrl = availabilityApiUrl(productId, selection);
  const detailUrl = detailApiUrl(productId);

  const labels: DetailViewLabels = {
    loading: t("loading"),
    error: t("error"),
    notFound: t("notFound"),
    backToSearch: t("backToSearch"),
    noPhotos: t("noPhotos"),
    basePrice: t("basePrice"),
    vesLabel: t("vesLabel"),
    amenitiesTitle: t("amenitiesTitle"),
    availabilityTitle: t("availabilityTitle"),
    availabilityEmpty: t("availabilityEmpty"),
    remaining: t("remaining"),
    cancellationTitle: t("cancellationTitle"),
    ruleTemplate: (hours, percent) => t("ruleTemplate", { hours, percent }),
    cancellationNone: t("cancellationNone"),
    reserve: t("reserve"),
    unavailable: t("unavailable"),
  };

  const [product, setProduct] = useState<CatalogProductDetailView | null>(null);
  const [availability, setAvailability] = useState<CatalogAvailabilityView | null>(null);
  const [status, setStatus] = useState<DetailStatus>("loading");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");

    const load = async (): Promise<void> => {
      try {
        const [detailResponse, availabilityResponse] = await Promise.all([
          fetch(detailUrl, { signal: controller.signal }),
          fetch(availabilityUrl, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;

        // Un producto no público o borrado responde 404 en ambas lecturas.
        if (detailResponse.status === 404) {
          setProduct(null);
          setAvailability(null);
          setStatus("not-found");
          return;
        }
        if (!detailResponse.ok || !availabilityResponse.ok) {
          throw new Error(`HTTP ${detailResponse.status}/${availabilityResponse.status}`);
        }

        const parsedProduct = parseProductDetailView(await detailResponse.json());
        const parsedAvailability = parseAvailabilityView(await availabilityResponse.json());
        if (controller.signal.aborted) return;
        if (!parsedProduct || !parsedAvailability) {
          setProduct(null);
          setAvailability(null);
          setStatus("error");
          return;
        }
        setProduct(parsedProduct);
        setAvailability(parsedAvailability);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) {
          setProduct(null);
          setAvailability(null);
          setStatus("error");
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [detailUrl, availabilityUrl]);

  return (
    <ProductDetailView
      locale={locale}
      productId={productId}
      product={product}
      availability={availability}
      selection={selection}
      status={status}
      labels={labels}
    />
  );
}

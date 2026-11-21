"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Locale } from "@caribe/shared";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import {
  bookingApiUrl,
  buildBookingRequest,
  checkoutErrorKind,
  checkoutStayFromParams,
  initialTravelers,
  parseBookingCreated,
  type BookingCreatedView,
  type CheckoutErrorKind,
  type CheckoutTraveler,
} from "@/lib/checkout-view";
import {
  availabilityApiUrl,
  detailApiUrl,
  parseAvailabilityView,
  parseProductDetailView,
  type CatalogAvailabilityView,
  type CatalogProductDetailView,
} from "@/lib/detail-view";
import {
  CheckoutView,
  type CheckoutStatus,
  type CheckoutViewLabels,
  type SummaryCurrency,
  type TravelerField,
} from "./checkout-view";

/** Parte interactiva de `/[locale]/checkout/[productId]`. */
export function CheckoutExperience({
  locale,
  productId,
}: {
  locale: Locale;
  productId: string;
}) {
  const t = useTranslations("checkout");
  const params = useSearchParams();
  const pathname = usePathname();
  const stay = useMemo(() => checkoutStayFromParams(params), [params]);
  const detailUrl = detailApiUrl(productId);
  const availabilityUrl = stay
    ? availabilityApiUrl(productId, {
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        guests: stay.guests,
      })
    : "";

  const labels: CheckoutViewLabels = {
    loading: t("loading"),
    backToDetail: t("backToDetail"),
    title: t("title"),
    subtitle: t("subtitle"),
    stayTitle: t("stayTitle"),
    checkIn: t("checkIn"),
    checkOut: t("checkOut"),
    guests: t("guests"),
    summaryTitle: t("summaryTitle"),
    nightPrice: t("nightPrice"),
    availabilityEmpty: t("availabilityEmpty"),
    currencyTitle: t("currencyTitle"),
    currencyUsd: t("currencyUsd"),
    currencyVes: t("currencyVes"),
    vesUnavailable: t("vesUnavailable"),
    totalNote: t("totalNote"),
    travelersTitle: t("travelersTitle"),
    fullName: t("fullName"),
    documentType: t("documentType"),
    documentNumber: t("documentNumber"),
    documentTypeDni: t("documentTypeDni"),
    documentTypePassport: t("documentTypePassport"),
    phone: t("phone"),
    email: t("email"),
    addTraveler: t("addTraveler"),
    removeTraveler: t("removeTraveler"),
    travelersRequired: t("travelersRequired"),
    reserve: t("reserve"),
    reserving: t("reserving"),
    login: t("login"),
    successTitle: t("successTitle"),
    successCode: t("successCode"),
    successStatus: t("successStatus"),
    successTotal: t("successTotal"),
    successExpires: t("successExpires"),
    successDescription: t("successDescription"),
  };

  const errorMessages: Record<CheckoutErrorKind, string> = {
    generic: t("error"),
    "not-found": t("notFound"),
    "invalid-dates": t("invalidDates"),
    unauthenticated: t("unauthenticated"),
    availability: t("availabilityError"),
    validation: t("validationError"),
  };

  const [product, setProduct] = useState<CatalogProductDetailView | null>(null);
  const [availability, setAvailability] = useState<CatalogAvailabilityView | null>(null);
  const [status, setStatus] = useState<CheckoutStatus>("loading");
  const [errorKind, setErrorKind] = useState<CheckoutErrorKind>("generic");
  const [booking, setBooking] = useState<BookingCreatedView | null>(null);
  const [travelers, setTravelers] = useState<CheckoutTraveler[]>(() => initialTravelers(1));
  const [travelerError, setTravelerError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<SummaryCurrency>("USD");
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  const query = params.toString();
  const currentPath = `${pathname}${query ? `?${query}` : ""}`;
  const loginHref = `/${locale}/login?redirectTo=${encodeURIComponent(currentPath)}`;

  function resetIdempotencyKey(): void {
    idempotencyKey.current = null;
  }

  function getIdempotencyKey(): string {
    idempotencyKey.current ??= crypto.randomUUID();
    return idempotencyKey.current;
  }

  useEffect(() => {
    setTravelers(initialTravelers(stay?.guests ?? 1));
    setTravelerError(null);
    resetIdempotencyKey();
  }, [stay?.guests]);

  useEffect(() => {
    if (!stay) {
      setProduct(null);
      setAvailability(null);
      setErrorKind("invalid-dates");
      setStatus("error");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    setErrorKind("generic");

    const load = async (): Promise<void> => {
      try {
        const [detailResponse, availabilityResponse] = await Promise.all([
          fetch(detailUrl, { signal: controller.signal }),
          fetch(availabilityUrl, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        if (detailResponse.status === 404) {
          setErrorKind("not-found");
          setStatus("error");
          return;
        }
        if (!detailResponse.ok || !availabilityResponse.ok) {
          throw new Error(
            `HTTP ${detailResponse.status}/${availabilityResponse.status}`,
          );
        }

        const parsedProduct = parseProductDetailView(await detailResponse.json());
        const parsedAvailability = parseAvailabilityView(await availabilityResponse.json());
        if (controller.signal.aborted) return;
        if (!parsedProduct || !parsedAvailability) {
          setErrorKind("generic");
          setStatus("error");
          return;
        }
        setProduct(parsedProduct);
        setAvailability(parsedAvailability);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) {
          setErrorKind("generic");
          setStatus("error");
        }
      }
    };

    void load();
    return () => controller.abort();
  }, [detailUrl, availabilityUrl, stay]);

  function changeTraveler(index: number, field: TravelerField, value: string): void {
    setTravelers((current) =>
      current.map((traveler, position) =>
        position === index ? { ...traveler, [field]: value } : traveler,
      ),
    );
    setTravelerError(null);
    resetIdempotencyKey();
  }

  function addTraveler(): void {
    setTravelers((current) => [
      ...current,
      { fullName: "", documentType: "DNI", documentNumber: "" },
    ]);
    setTravelerError(null);
    resetIdempotencyKey();
  }

  function removeTraveler(index: number): void {
    setTravelers((current) => current.filter((_, position) => position !== index));
    setTravelerError(null);
    resetIdempotencyKey();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const request = buildBookingRequest(productId, stay, travelers);
    if (!request) {
      setTravelerError(labels.travelersRequired);
      return;
    }

    setBusy(true);
    setTravelerError(null);
    try {
      const response = await fetch(bookingApiUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getIdempotencyKey(),
        },
        body: JSON.stringify(request),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKind(checkoutErrorKind(response.status, body));
        setStatus("error");
        return;
      }
      const parsedBooking = parseBookingCreated(body);
      if (!parsedBooking) {
        setErrorKind("generic");
        setStatus("error");
        return;
      }
      setBooking(parsedBooking);
      setStatus("success");
    } catch {
      setErrorKind("generic");
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CheckoutView
      locale={locale}
      productId={productId}
      stay={stay}
      product={product}
      availability={availability}
      currency={currency}
      status={status}
      booking={booking}
      travelers={travelers}
      travelerError={travelerError}
      errorMessage={status === "error" ? errorMessages[errorKind] : null}
      showLogin={errorKind === "unauthenticated"}
      loginHref={loginHref}
      busy={busy}
      labels={labels}
      onCurrencyChange={setCurrency}
      onTravelerChange={changeTraveler}
      onAddTraveler={addTraveler}
      onRemoveTraveler={removeTraveler}
      onSubmit={(event) => void onSubmit(event)}
    />
  );
}

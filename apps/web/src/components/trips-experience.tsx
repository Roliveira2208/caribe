"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { getSession, type Locale } from "@caribe/shared";
import { localizedPath } from "@/lib/localized-path";
import {
  formatTripDate,
  parseTripsPage,
  tripsApiUrl,
  type TripStatus,
  type TripsPageView,
} from "@/lib/trips-view";
import { Button } from "@/components/ui/button";

type TripsState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "ready"; page: TripsPageView };

function statusLabel(t: (key: string) => string, status: TripStatus): string {
  switch (status) {
    case "PENDING_PAYMENT":
      return t("statusPendingPayment");
    case "CONFIRMED":
      return t("statusConfirmed");
    case "CANCELLED":
      return t("statusCancelled");
    case "EXPIRED":
      return t("statusExpired");
  }
}

/** Listado "Mis viajes": sesión real y reservas de la API, sin enlaces falsos. */
export function TripsExperience({ locale }: { locale: Locale }) {
  const t = useTranslations("account");
  const router = useRouter();
  const [state, setState] = useState<TripsState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  const tripsPath = localizedPath(locale, "/account/trips");
  const loginHref = `${localizedPath(locale, "/login")}?redirectTo=${encodeURIComponent(tripsPath)}`;

  useEffect(() => {
    let active = true;

    async function load() {
      setState({ kind: "loading" });
      try {
        const session = await getSession();
        if (!session) {
          router.replace(loginHref);
          return;
        }
        const response = await fetch(tripsApiUrl(), {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          router.replace(loginHref);
          return;
        }
        if (!response.ok) {
          if (active) setState({ kind: "error" });
          return;
        }
        const body: unknown = await response.json().catch(() => null);
        const page = parseTripsPage(body);
        if (!page) {
          if (active) setState({ kind: "error" });
          return;
        }
        if (!active) return;
        setState(page.items.length === 0 ? { kind: "empty" } : { kind: "ready", page });
      } catch {
        if (active) setState({ kind: "error" });
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [loginHref, reloadKey, router]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-h2 text-ink">{t("tripsTitle")}</h1>

      {state.kind === "loading" ? (
        <p role="status" aria-live="polite" className="text-body-lg text-ink">
          {t("tripsLoading")}
        </p>
      ) : null}

      {state.kind === "error" ? (
        <div role="alert" className="space-y-3">
          <p className="text-body-lg text-ink">{t("tripsError")}</p>
          <Button variant="outline" onClick={() => setReloadKey((value) => value + 1)}>
            {t("tripsRetry")}
          </Button>
        </div>
      ) : null}

      {state.kind === "empty" ? (
        <p className="text-body-lg text-ink">{t("tripsEmpty")}</p>
      ) : null}

      {state.kind === "ready" ? (
        <ul className="grid gap-4">
          {state.page.items.map((trip) => (
            <li key={trip.id} className="rounded-panel border border-ink/15 bg-bone/70 p-5">
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-ink">{t("tripsCode")}</dt>
                  <dd className="font-mono text-body-lg text-ink">{trip.code}</dd>
                </div>
                <div>
                  <dt className="text-sm text-ink">{t("tripsStatus")}</dt>
                  <dd className="text-body-lg text-ink">{statusLabel(t, trip.status)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-ink">{t("tripsExpiry")}</dt>
                  <dd className="text-body-lg text-ink">
                    <time dateTime={trip.expiresAt}>{formatTripDate(trip.expiresAt, locale)}</time>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-ink">{t("tripsTotalLabel")}</dt>
                  <dd className="text-body-lg text-ink">
                    {t("tripsTotalUsd", { amount: trip.totalUsd })}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-sm text-ink">{t("tripsDocumentsNote")}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

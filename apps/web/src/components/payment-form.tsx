"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { PaymentBody, PaymentMethodValue } from "@caribe/shared";
import { formatUsd } from "@/lib/catalog-view";
import type { BookingCreatedView } from "@/lib/checkout-view";
import {
  buildPaymentBody,
  EMPTY_PAYMENT_FIELDS,
  formatHoldRemaining,
  PAYMENT_METHOD_OPTIONS,
  remainingHoldMs,
  type PaymentFormFields,
} from "@/lib/payment-view";

export interface PaymentFormLabels {
  paymentTitle: string;
  paymentSubtitle: string;
  holdLabel: string;
  holdPending: string;
  holdExpired: string;
  holdNote: string;
  methodTitle: string;
  methodMobile: string;
  methodZelle: string;
  methodBinance: string;
  methodCard: string;
  amountTitle: string;
  amountNote: string;
  bank: string;
  phone: string;
  reference: string;
  senderName: string;
  senderEmail: string;
  confirmationNumber: string;
  orderId: string;
  last4: string;
  brand: string;
  reportPayment: string;
  reporting: string;
  paymentRequired: string;
}

interface PaymentFormProps {
  locale: "es" | "en";
  booking: BookingCreatedView;
  labels: PaymentFormLabels;
  busy: boolean;
  errorMessage: string | null;
  onPay: (body: PaymentBody) => void;
}

const FIELD_CLASSES =
  "mt-1 h-11 w-full rounded border border-ink/20 bg-bone px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber";
const LABEL_CLASSES = "text-sm font-medium text-ink";

function methodLabel(method: PaymentMethodValue, labels: PaymentFormLabels): string {
  switch (method) {
    case "PAGO_MOVIL":
      return labels.methodMobile;
    case "ZELLE":
      return labels.methodZelle;
    case "BINANCE_PAY":
      return labels.methodBinance;
    case "CARD":
      return labels.methodCard;
  }
}

/** Paso 2 del checkout: retención visible y métodos de pago simulados. */
export function PaymentForm({
  locale,
  booking,
  labels,
  busy,
  errorMessage,
  onPay,
}: PaymentFormProps) {
  const [method, setMethod] = useState<PaymentMethodValue>("PAGO_MOVIL");
  const [fields, setFields] = useState<PaymentFormFields>(EMPTY_PAYMENT_FIELDS);
  const [localError, setLocalError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const remaining = now === null ? null : remainingHoldMs(booking.expiresAt, now);
  const expired = remaining !== null && remaining === 0;

  function change(field: keyof PaymentFormFields, value: string): void {
    setFields((current) => ({ ...current, [field]: value }));
    setLocalError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (expired) return;
    const body = buildPaymentBody(method, fields);
    if (!body) {
      setLocalError(labels.paymentRequired);
      return;
    }
    setLocalError(null);
    onPay(body);
  }

  return (
    <section data-checkout-status="payment" className="mx-auto w-full max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-h1 text-ink">{labels.paymentTitle}</h1>
        <p className="text-body-lg text-ink/70">{labels.paymentSubtitle}</p>
      </div>

      <div className="rounded-lg border border-ink/10 bg-bone p-6 shadow-brand">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="font-medium text-ink">{labels.holdLabel}</p>
          <span
            role="timer"
            aria-label={labels.holdLabel}
            data-hold-expired={expired}
            className="font-display text-h3 text-ink"
          >
            {remaining === null
              ? labels.holdPending
              : formatHoldRemaining(remaining)}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink/70">{labels.holdNote}</p>
        {expired ? (
          <p role="alert" className="mt-3 rounded-md bg-coral/5 p-3 text-sm font-medium text-coral-ink">
            {labels.holdExpired}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg bg-amber/15 p-5">
        <div>
          <p className="text-sm text-ink/70">{labels.amountTitle}</p>
          <p className="text-xs text-ink/70">{labels.amountNote}</p>
        </div>
        <p className="font-display text-h3 text-ink">{formatUsd(booking.totalUsd, locale)}</p>
      </div>

      <form className="space-y-6 rounded-lg border border-ink/10 bg-bone p-6 shadow-brand" onSubmit={submit}>
        <fieldset className="space-y-3">
          <legend className="font-display text-h4 text-ink">{labels.methodTitle}</legend>
          <div className="flex flex-wrap gap-4">
            {PAYMENT_METHOD_OPTIONS.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="paymentMethod"
                  value={option}
                  checked={method === option}
                  onChange={() => {
                    setMethod(option);
                    setLocalError(null);
                  }}
                  className="h-4 w-4 accent-amber focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
                />
                {methodLabel(option, labels)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          {method === "PAGO_MOVIL" ? (
            <>
              <div>
                <label className={LABEL_CLASSES} htmlFor="payment-bank">
                  {labels.bank}
                </label>
                <input
                  id="payment-bank"
                  className={FIELD_CLASSES}
                  value={fields.bank}
                  onChange={(event) => change("bank", event.target.value)}
                />
              </div>
              <div>
                <label className={LABEL_CLASSES} htmlFor="payment-phone">
                  {labels.phone}
                </label>
                <input
                  id="payment-phone"
                  type="tel"
                  className={FIELD_CLASSES}
                  value={fields.phone}
                  onChange={(event) => change("phone", event.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL_CLASSES} htmlFor="payment-reference">
                  {labels.reference}
                </label>
                <input
                  id="payment-reference"
                  className={FIELD_CLASSES}
                  value={fields.reference}
                  onChange={(event) => change("reference", event.target.value)}
                />
              </div>
            </>
          ) : null}

          {method === "ZELLE" ? (
            <>
              <div>
                <label className={LABEL_CLASSES} htmlFor="payment-sender-name">
                  {labels.senderName}
                </label>
                <input
                  id="payment-sender-name"
                  className={FIELD_CLASSES}
                  value={fields.senderName}
                  onChange={(event) => change("senderName", event.target.value)}
                />
              </div>
              <div>
                <label className={LABEL_CLASSES} htmlFor="payment-sender-email">
                  {labels.senderEmail}
                </label>
                <input
                  id="payment-sender-email"
                  type="email"
                  className={FIELD_CLASSES}
                  value={fields.senderEmail}
                  onChange={(event) => change("senderEmail", event.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL_CLASSES} htmlFor="payment-confirmation">
                  {labels.confirmationNumber}
                </label>
                <input
                  id="payment-confirmation"
                  className={FIELD_CLASSES}
                  value={fields.confirmationNumber}
                  onChange={(event) => change("confirmationNumber", event.target.value)}
                />
              </div>
            </>
          ) : null}

          {method === "BINANCE_PAY" ? (
            <div className="sm:col-span-2">
              <label className={LABEL_CLASSES} htmlFor="payment-order">
                {labels.orderId}
              </label>
              <input
                id="payment-order"
                className={FIELD_CLASSES}
                value={fields.orderId}
                onChange={(event) => change("orderId", event.target.value)}
              />
            </div>
          ) : null}

          {method === "CARD" ? (
            <>
              <div>
                <label className={LABEL_CLASSES} htmlFor="payment-last4">
                  {labels.last4}
                </label>
                <input
                  id="payment-last4"
                  inputMode="numeric"
                  maxLength={4}
                  className={FIELD_CLASSES}
                  value={fields.last4}
                  onChange={(event) => change("last4", event.target.value)}
                />
              </div>
              <div>
                <label className={LABEL_CLASSES} htmlFor="payment-brand">
                  {labels.brand}
                </label>
                <input
                  id="payment-brand"
                  className={FIELD_CLASSES}
                  value={fields.brand}
                  onChange={(event) => change("brand", event.target.value)}
                />
              </div>
            </>
          ) : null}
        </div>

        {localError || errorMessage ? (
          <p role="alert" className="rounded-md border border-coral/30 bg-coral/5 p-3 text-sm font-medium text-coral-ink">
            {localError ?? errorMessage}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || expired}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-amber px-6 font-semibold text-ink hover:bg-amber/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:cursor-not-allowed disabled:opacity-70"
        >
          {busy ? labels.reporting : labels.reportPayment}
        </button>
      </form>
    </section>
  );
}

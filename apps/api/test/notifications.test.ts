import { describe, expect, it } from "vitest";
import { resolveSmtpConfig } from "../src/config.js";
import {
  bookingConfirmationContent,
  confirmationTemplates,
  notificationLocale,
  type BookingConfirmationData,
} from "../src/notifications/notification-templates.js";
import {
  NOTIFICATION_TIMEOUT_MS,
  smtpTransportOptions,
} from "../src/notifications/smtp-notification.provider.js";

/**
 * Unitarios de las plantillas y del transporte (T-F1-12, spec notifications
 * "Idioma del aviso", "Destinatario y privacidad" y "Proveedor y transporte").
 * No abren conexiones SMTP: solo comprueban el contenido y las opciones.
 */
describe("notificaciones", () => {
  const data: BookingConfirmationData = {
    code: "CAR-ABC-123",
    productTitle: "Hotel Sol",
    checkIn: "2026-12-10",
    checkOut: "2026-12-12",
    totalUsd: "200.00",
    totalVes: "7200.00",
    voucherUrl: "https://caribe.example/reservas/CAR-ABC-123",
  };

  it("el aviso de confirmación incluye código, producto, fechas, totales y voucher", () => {
    const content = bookingConfirmationContent("es", data);
    for (const value of [
      data.code,
      data.productTitle,
      data.checkIn,
      data.checkOut,
      data.totalUsd,
      data.totalVes,
      data.voucherUrl,
    ]) {
      expect(content.subject + content.body).toContain(value);
    }
  });

  it("usa inglés cuando el usuario tiene locale = en", () => {
    const content = bookingConfirmationContent("en", data);
    expect(content.subject).toContain("confirmed");
    expect(content.body).toContain("Your booking");
    expect(content.body).not.toContain("Tu reserva");
  });

  it("cae a español sin locale, con locale desconocido o sin plantilla inglesa", () => {
    expect(notificationLocale(null)).toBe("es");
    expect(notificationLocale(undefined)).toBe("es");
    expect(notificationLocale("fr")).toBe("es");

    const spanishOnly = { es: confirmationTemplates.es };
    expect(bookingConfirmationContent("en", data, spanishOnly).subject).toContain("confirmada");
    expect(bookingConfirmationContent(null, data).subject).toContain("confirmada");
  });

  it("el cuerpo no incluye datos de viajeros, tarjeta ni tokens", () => {
    const content = bookingConfirmationContent("es", data);
    const rendered = `${content.subject}\n${content.body}`;
    expect(rendered).not.toContain("V-12345678");
    expect(rendered).not.toContain("4111");
    expect(rendered).not.toContain("cvv");
    expect(rendered).not.toContain("token");
  });

  it("resuelve la configuración SMTP con valores por defecto y sin secretos fijos", () => {
    expect(resolveSmtpConfig({})).toEqual({
      host: "",
      port: 1025,
      user: "",
      password: "",
      from: "Caribe <no-reply@example.com>",
    });
    expect(
      resolveSmtpConfig({
        SMTP_HOST: "mailpit",
        SMTP_PORT: "2525",
        SMTP_USER: "operador",
        SMTP_PASSWORD: "secreto",
        SMTP_FROM: "Caribe <avisos@example.com>",
      }),
    ).toEqual({
      host: "mailpit",
      port: 2525,
      user: "operador",
      password: "secreto",
      from: "Caribe <avisos@example.com>",
    });
  });

  it("configura el transporte con expects de 5 segundos y autenticación opcional", () => {
    expect(NOTIFICATION_TIMEOUT_MS).toBe(5000);
    expect(
      smtpTransportOptions({ host: "mailpit", port: 1025, user: "", password: "", from: "x" }),
    ).toEqual({
      host: "mailpit",
      port: 1025,
      secure: false,
      auth: undefined,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    });
    expect(
      smtpTransportOptions({
        host: "smtp.example.com",
        port: 465,
        user: "u",
        password: "p",
        from: "x",
      }),
    ).toMatchObject({ secure: true, auth: { user: "u", pass: "p" } });
  });
});

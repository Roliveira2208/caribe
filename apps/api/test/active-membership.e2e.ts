import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { prisma } from "../src/prisma.js";
import { authOrigin, createAgency, setActiveOrg, userWithTotp } from "./auth-helpers.js";

/**
 * Inventario de la agencia activa (extensión de F1-S2).
 *
 * Una membresía revocada no limpia `activeOrganizationId` de la sesión. Toda
 * ruta que resuelva la agencia desde ese campo debe revalidar la membresía y
 * responder 403 `ACTIVE_ORGANIZATION_REQUIRED`, sin depender de RLS ni del
 * guard de cada familia. Este test fija el inventario: si se añade una ruta
 * que consuma la agencia activa sin pasar por la validación común, falla.
 */
describe("agencia activa (membresía revocada)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  let cookie: string;
  let userId: string;
  let organizationId: string;

  const id = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  interface RouteCase {
    name: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    body?: unknown;
  }

  const routes: RouteCase[] = [
    { name: "ajustes: leer", method: "GET", path: "/admin/tenant-settings" },
    {
      name: "ajustes: actualizar",
      method: "PUT",
      path: "/admin/tenant-settings",
      body: { holdMinutes: 15 },
    },
    { name: "pagos del panel: listar", method: "GET", path: "/admin/payments" },
    { name: "pagos del panel: detalle", method: "GET", path: `/admin/payments/${id}` },
    { name: "pagos del panel: aprobar", method: "PATCH", path: `/admin/payments/${id}/approve` },
    {
      name: "pagos del panel: rechazar",
      method: "PATCH",
      path: `/admin/payments/${id}/reject`,
      body: { reason: "Prueba" },
    },
    { name: "pagos propios: listar", method: "GET", path: `/bookings/${id}/payments` },
    {
      name: "pagos propios: reportar",
      method: "POST",
      path: `/bookings/${id}/payments`,
      body: { method: "CREDIT_CARD" },
    },
    { name: "tasas: consultar", method: "GET", path: "/admin/exchange-rates/current" },
    {
      name: "tasas: override de agencia",
      method: "PUT",
      path: "/admin/exchange-rates/override",
      body: { rate: "900.0000", reason: "Prueba" },
    },
    {
      name: "tasas: override global",
      method: "PUT",
      path: "/admin/exchange-rates/global-override",
      body: { rate: "900.0000", reason: "Prueba" },
    },
    { name: "catálogo del panel: listar", method: "GET", path: "/admin/products" },
    {
      name: "catálogo del panel: crear",
      method: "POST",
      path: "/admin/products",
      body: {},
    },
    { name: "catálogo del panel: detalle", method: "GET", path: `/admin/products/${id}` },
    { name: "catálogo del panel: editar", method: "PUT", path: `/admin/products/${id}`, body: {} },
    { name: "catálogo del panel: borrar", method: "DELETE", path: `/admin/products/${id}` },
    {
      name: "catálogo del panel: publicar",
      method: "POST",
      path: `/admin/products/${id}/publish`,
    },
    {
      name: "catálogo del panel: archivar",
      method: "POST",
      path: `/admin/products/${id}/archive`,
    },
    {
      name: "catálogo del panel: leer disponibilidad",
      method: "GET",
      path: `/admin/products/${id}/availability`,
    },
    {
      name: "catálogo del panel: disponibilidad",
      method: "POST",
      path: `/admin/products/${id}/availability`,
      body: { nights: [] },
    },
    { name: "reservas: crear", method: "POST", path: "/bookings", body: {} },
    { name: "reservas: listar", method: "GET", path: "/bookings" },
    { name: "reservas: detalle", method: "GET", path: `/bookings/${id}` },
    { name: "reservas: cancelar", method: "POST", path: `/bookings/${id}/cancel` },
    { name: "auditoría: listar", method: "GET", path: "/admin/audit-logs" },
    { name: "eventos de autenticación: listar", method: "GET", path: "/admin/auth-events" },
    { name: "documentos: descargar", method: "GET", path: `/documents/${id}/download` },
  ];

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");

    const owner = await userWithTotp(baseUrl, `active-membership-${suffix}@example.com`);
    userId = owner.userId;
    cookie = owner.cookie;
    organizationId = (
      await createAgency(userId, `Agencia membresía ${suffix}`, `membresia-${suffix}`)
    ).id;
    await setActiveOrg(baseUrl, cookie, organizationId);

    // La revocación real es borrar el member; Better Auth no limpia la agencia
    // activa de las sesiones ya abiertas y ahí está el defecto que se cubre.
    await prisma.member.deleteMany({ where: { userId, organizationId } });
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
    await prisma.$disconnect();
  });

  it("la sesión conserva la agencia revocada", async () => {
    const session = await prisma.session.findFirst({
      where: { userId },
      select: { activeOrganizationId: true },
    });
    expect(session?.activeOrganizationId).toBe(organizationId);
  });

  it("toda ruta que usa la agencia activa responde 403 con la membresía revocada", async () => {
    for (const route of routes) {
      const response = await fetch(`${baseUrl}/api/v1${route.path}`, {
        method: route.method,
        headers: {
          cookie,
          origin: authOrigin,
          ...(route.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
      });

      expect(response.status, `${route.name} (${route.method} ${route.path})`).toBe(403);
      await expect(
        response.json(),
        `${route.name} (${route.method} ${route.path})`,
      ).resolves.toMatchObject({ code: "ACTIVE_ORGANIZATION_REQUIRED" });
    }
  });
});

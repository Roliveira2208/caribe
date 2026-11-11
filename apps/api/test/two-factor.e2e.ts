import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService } from "@nestjs/core";
import { createApp, type ApiApplication } from "../src/bootstrap.js";
import { apiConfig } from "../src/config.js";
import { auth } from "../src/auth.js";
import { prisma } from "../src/prisma.js";
import {
  BETTER_AUTH_NON_ADMIN_ORGANIZATION_PATHS,
  betterAuthAdminRouteOf,
  AUTH_METADATA_KEYS,
  isAdminRoute,
  joinRoutePath,
  mergeRoutePermissions,
  type RouteSecurity,
} from "../src/admin/admin-route.js";
import {
  TEST_PASSWORD,
  addMember,
  authOrigin,
  createAgency,
  createUser,
  sessionCookieOf,
  setActiveOrg,
  signIn,
  totpCode,
  totpSecretFromUri,
} from "./auth-helpers.js";

/**
 * E2E del segundo factor (T-F0-8, delta de auth-access).
 *
 * El inventario de rutas administrativas recorre las dos familias que sirven
 * la API: los controllers de Nest (DiscoveryService + metadata de Nest) y el
 * middleware de Better Auth (la instancia real, auth.api). Cada familia se
 * clasifica con la misma funcion pura del guard o de los hooks y se llama por
 * HTTP a las administrativas con un admin sin TOTP: si alguna dejara de
 * exigir segundo factor, la prueba falla (escenario "Ruta administrativa sin
 * exigencia de segundo factor"). La particion de /organization/* es completa
 * (tabla administrativa o allowlist), asi que una ruta nueva de la lib no
 * pasa sin clasificarse. La pantalla de activacion llega con el shell en
 * T-F0-10 (decision del dueno).
 */
describe("auth-access: segundo factor (T-F0-8)", () => {
  let app: ApiApplication;
  let baseUrl: string;
  const suffix = randomUUID().slice(0, 8);
  let cachedOwnerCookie: string | undefined;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace(/\/$/, "");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("inventario Nest: toda ruta administrativa exige segundo factor", async () => {
    const routes = listRegisteredRoutes(app);
    const adminRoutes = routes.filter((route) => route.administrative);
    // El inventario no puede pasar en vacio: debe haber de las dos clases.
    expect(adminRoutes.length).toBeGreaterThan(0);
    expect(routes.some((route) => !route.administrative)).toBe(true);

    const cookie = await ownerCookieWithoutTotp();
    const failures: string[] = [];
    for (const route of adminRoutes) {
      const res = await callRoute(route, cookie);
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (res.status !== 403 || body?.code !== "TWO_FACTOR_REQUIRED") {
        failures.push(`${route.method} /${route.path} respondio ${res.status}`);
      }
    }
    expect(failures, `rutas administrativas sin exigir TOTP: ${failures.join("; ")}`).toEqual([]);
  });

  it("inventario Better Auth: toda ruta administrativa del middleware exige segundo factor", async () => {
    const routes = listBetterAuthRoutes();
    const adminRoutes = routes.filter((route) => route.administrative);
    expect(adminRoutes.length).toBeGreaterThan(0);
    expect(routes.some((route) => !route.administrative)).toBe(true);

    // Particion completa de las familias con reglas administrativas: todo
    // /admin/* es administrativo; /organization/* o es administrativo o esta
    // en la allowlist; two-factor/* nunca lo es (la activacion queda
    // accesible). Una ruta nueva de la lib rompe hasta que alguien la
    // clasifique en BETTER_AUTH_ADMIN_ROUTES o en la allowlist.
    const unclassifiedAdmin = routes.filter(
      (route) => route.path.startsWith("/admin") && !route.administrative,
    );
    expect(unclassifiedAdmin, `rutas /admin sin clasificar: ${unclassifiedAdmin.map((r) => r.path).join("; ")}`).toEqual([]);
    const unclassifiedOrganization = routes.filter(
      (route) =>
        route.path.startsWith("/organization") &&
        !route.administrative &&
        !BETTER_AUTH_NON_ADMIN_ORGANIZATION_PATHS.includes(route.path),
    );
    expect(
      unclassifiedOrganization,
      `rutas /organization sin clasificar: ${unclassifiedOrganization.map((r) => r.path).join("; ")}`,
    ).toEqual([]);
    const adminTwoFactor = routes.filter(
      (route) => route.path.startsWith("/two-factor") && route.administrative,
    );
    expect(adminTwoFactor, `rutas two-factor administrativas: ${adminTwoFactor.map((r) => r.path).join("; ")}`).toEqual([]);

    // La tabla declara los metodos que responde cada ruta administrativa.
    for (const route of adminRoutes) {
      const declared = betterAuthAdminRouteOf(route.path)?.methods;
      expect(declared, `${route.path} sin metodos declarados en la tabla`).toContain(route.method);
    }

    // El hook before exige TOTP antes de validar el cuerpo o los permisos:
    // con un admin sin TOTP y un cuerpo vacio, todas responden 403 con el
    // codigo de aplicacion (no 400 ni 403 opaco).
    const cookie = await ownerCookieWithoutTotp();
    const failures: string[] = [];
    for (const route of adminRoutes) {
      const res = await callBetterAuthRoute(route, cookie);
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (res.status !== 403 || body?.code !== "TWO_FACTOR_REQUIRED") {
        failures.push(`${route.method} ${route.path} respondio ${res.status}`);
      }
    }
    expect(
      failures,
      `rutas administrativas de Better Auth sin exigir TOTP: ${failures.join("; ")}`,
    ).toEqual([]);

    // Negativo: una ruta de Better Auth no administrativa sigue accesible.
    const list = await callBetterAuthRoute({ method: "GET", path: "/organization/list" }, cookie);
    expect(list.status).toBe(200);
  });

  it("admin sin TOTP recibe 403 TWO_FACTOR_REQUIRED en un endpoint administrativo", async () => {
    const cookie = await ownerCookieWithoutTotp();
    const res = await callAdminOverride(cookie);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "TWO_FACTOR_REQUIRED" });
  });

  it("admin sin TOTP en un endpoint no administrativo responde 2xx", async () => {
    const cookie = await ownerCookieWithoutTotp();
    // product:update lo comparte el proveedor: ruta no administrativa.
    const res = await fetch(`${baseUrl}/api/v1/products/de-este-owner`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie, origin: authOrigin },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it("roles no administrativos reciben el 403 normal, sin TWO_FACTOR_REQUIRED", async () => {
    const ownerEmail = `owner-agen-${suffix}@example.com`;
    const agentEmail = `agent-2fa-${suffix}@example.com`;
    const org = await createAgency(
      await createUser(ownerEmail),
      `Agencia AG2 ${suffix}`,
      `agencia-ag2-${suffix}`,
    );
    await addMember(org.id, await createUser(agentEmail), "agent");
    const cookie = await signIn(baseUrl, agentEmail);
    await setActiveOrg(baseUrl, cookie, org.id);

    const res = await callAdminOverride(cookie);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).not.toBe("TWO_FACTOR_REQUIRED");
  });

  it("rol no administrativo en una ruta administrativa de Better Auth recibe el 403 normal", async () => {
    const ownerEmail = `owner-ba-${suffix}@example.com`;
    const agentEmail = `agent-ba-${suffix}@example.com`;
    const org = await createAgency(
      await createUser(ownerEmail),
      `Agencia BA ${suffix}`,
      `agencia-ba-${suffix}`,
    );
    await addMember(org.id, await createUser(agentEmail), "agent");
    const cookie = await signIn(baseUrl, agentEmail);
    await setActiveOrg(baseUrl, cookie, org.id);

    // El hook solo exige TOTP a roles administrativos: el agente recibe el
    // 403 de permisos de la propia lib, sin el codigo de aplicacion.
    const res = await fetch(`${baseUrl}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: authOrigin },
      body: JSON.stringify({
        email: `invitado-ba-${suffix}@example.com`,
        role: "provider",
        organizationId: org.id,
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    expect(body.code).not.toBe("TWO_FACTOR_REQUIRED");
  });

  it("super_admin sin TOTP recibe TWO_FACTOR_REQUIRED aunque falte el permiso de agencia", async () => {
    const email = `super-2fa-${suffix}@example.com`;
    const userId = await createUser(email);
    // El seed hace igual: cambio de rol por actualizacion directa (no hay
    // endpoint de servidor para cambiar roles).
    await prisma.user.update({ where: { id: userId }, data: { role: "super_admin" } });
    const cookie = await signIn(baseUrl, email);

    // El check de segundo factor corre antes que el de permisos (por eso el
    // super_admin sin exchange-rate:update recibe TWO_FACTOR_REQUIRED y no
    // un 403 opaco: la UI podria llevarlo a activar TOTP, T-F0-10).
    const res = await callAdminOverride(cookie);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "TWO_FACTOR_REQUIRED" });
  });

  it("super_admin sin TOTP recibe TWO_FACTOR_REQUIRED en las rutas admin de Better Auth", async () => {
    const email = `super-ba-${suffix}@example.com`;
    const userId = await createUser(email);
    await prisma.user.update({ where: { id: userId }, data: { role: "super_admin" } });
    const cookie = await signIn(baseUrl, email);

    // Sin organizacion activa y sin TOTP: el rol de plataforma basta para
    // exigir el segundo factor antes de los permisos del plugin admin.
    const res = await fetch(`${baseUrl}/api/auth/admin/create-user`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: authOrigin },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "TWO_FACTOR_REQUIRED" });
  });

  it("sin sesion el endpoint administrativo responde 401", async () => {
    const res = await callAdminOverride("");
    expect(res.status).toBe(401);
  });

  it("la activacion queda accesible y tras verificar el TOTP el endpoint responde 2xx", async () => {
    const email = `owner-full-${suffix}@example.com`;
    const owner = await createUser(email);
    const org = await createAgency(owner, `Agencia FULL ${suffix}`, `agencia-full-${suffix}`);
    let cookie = await signIn(baseUrl, email);
    await setActiveOrg(baseUrl, cookie, org.id);

    // La activacion es accesible para un admin sin TOTP (spec: "la
    // activacion del TOTP permanece accesible").
    const enable = await fetch(`${baseUrl}/api/auth/two-factor/enable`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: authOrigin },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    expect(enable.status).toBe(200);
    const { totpURI } = (await enable.json()) as { totpURI: string };

    // Entre enable y verify sigue sin TOTP activo (sin skipVerificationOnEnable).
    const before = await callAdminOverride(cookie);
    expect(before.status).toBe(403);

    // verify-totp marca twoFactorEnabled y rota la sesion: cookie nueva.
    const verify = await fetch(`${baseUrl}/api/auth/two-factor/verify-totp`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: authOrigin },
      body: JSON.stringify({ code: totpCode(totpSecretFromUri(totpURI)) }),
    });
    expect(verify.status).toBe(200);
    cookie = sessionCookieOf(verify);
    expect(cookie).not.toBe("");

    const after = await callAdminOverride(cookie);
    expect(after.status).toBe(200);
    await expect(after.json()).resolves.toMatchObject({ overridden: true });
  });

  /** Owner de agencia con organizacion activa y sin TOTP (cacheado entre tests). */
  async function ownerCookieWithoutTotp(): Promise<string> {
    if (cachedOwnerCookie) return cachedOwnerCookie;
    const email = `owner-2fa-${suffix}@example.com`;
    const owner = await createUser(email);
    const org = await createAgency(owner, `Agencia 2FA ${suffix}`, `agencia-2fa-${suffix}`);
    const cookie = await signIn(baseUrl, email);
    await setActiveOrg(baseUrl, cookie, org.id);
    cachedOwnerCookie = cookie;
    return cookie;
  }

  async function callAdminOverride(cookie: string): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/admin/exchange-rates/override`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie, origin: authOrigin },
      body: JSON.stringify({}),
    });
  }

  async function callRoute(route: RegisteredRoute, cookie: string): Promise<Response> {
    // Los parametros :id se sustituyen por un valor cualquiera: el guard
    // rechaza antes de que el handler llegue a validar nada.
    const url = `${baseUrl}${apiConfig.basePath}/${route.path.replace(/:(\w+)/g, "x")}`;
    const headers: Record<string, string> = { cookie, origin: authOrigin };
    const init: RequestInit = { method: route.method, headers };
    if (route.method === "POST" || route.method === "PUT" || route.method === "PATCH") {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify({});
    }
    return fetch(url, init);
  }

  /** Llamada por HTTP a una ruta del middleware de Better Auth (/api/auth/*). */
  async function callBetterAuthRoute(
    route: Pick<RegisteredRoute, "method" | "path">,
    cookie: string,
  ): Promise<Response> {
    const url = `${baseUrl}/api/auth${route.path}`;
    const headers: Record<string, string> = { cookie, origin: authOrigin };
    const init: RequestInit = { method: route.method, headers };
    if (route.method !== "GET" && route.method !== "HEAD") {
      headers["content-type"] = "application/json";
      // El hook before exige TOTP antes de validar el cuerpo: basta vacio.
      init.body = JSON.stringify({});
    }
    return fetch(url, init);
  }
});

interface RegisteredRoute {
  method: string;
  path: string;
  administrative: boolean;
}

/**
 * Inventario de rutas registradas: controllers descubiertos por
 * DiscoveryService + metadata de Nest (PATH/METHOD). La clasificacion usa la
 * misma funcion del guard, asi que el e2e comprueba el efecto real por HTTP.
 */
function listRegisteredRoutes(app: ApiApplication): RegisteredRoute[] {
  const discovery = app.get(DiscoveryService);
  const routes: RegisteredRoute[] = [];
  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype;
    if (!controller) continue;
    const controllerPath = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
    const prototype = controller.prototype as Record<string, unknown>;
    for (const propertyName of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[propertyName];
      if (typeof handler !== "function") continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      const security: RouteSecurity = {
        path: joinRoutePath(controllerPath, Reflect.getMetadata(PATH_METADATA, handler)),
        permissions: mergeRoutePermissions(
          routeMetadata(controller, handler, AUTH_METADATA_KEYS.userHasPermission),
          routeMetadata(controller, handler, AUTH_METADATA_KEYS.memberHasPermission),
        ),
        systemRoles: routeMetadata(controller, handler, AUTH_METADATA_KEYS.systemRoles),
        orgRoles: routeMetadata(controller, handler, AUTH_METADATA_KEYS.orgRoles),
      };
      routes.push({
        method: httpVerbOf(method),
        path: security.path,
        administrative: isAdminRoute(security),
      });
    }
  }
  return routes;
}

/**
 * Inventario de las rutas HTTP de la instancia real de Better Auth: las que
 * expone auth.api con path. La clasificacion usa la misma tabla de los hooks
 * (betterAuthAdminRouteOf), asi que el e2e comprueba el efecto real por HTTP.
 */
function listBetterAuthRoutes(): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  for (const endpoint of Object.values(auth.api)) {
    const e = endpoint as { path?: string; options?: { method?: string | string[] } };
    if (!e?.path) continue; // solo API de servidor (addMember): sin ruta HTTP
    const method = Array.isArray(e.options?.method)
      ? (e.options.method[0] ?? "GET")
      : (e.options?.method ?? "GET");
    routes.push({
      method,
      path: e.path,
      administrative: betterAuthAdminRouteOf(e.path) !== undefined,
    });
  }
  return routes;
}

/** Metadata de una ruta con la semantica getAllAndOverride (handler, clase). */
function routeMetadata<T>(controller: object, handler: object, key: string): T | undefined {
  const onHandler = Reflect.getMetadata(key, handler) as T | undefined;
  return onHandler ?? (Reflect.getMetadata(key, controller) as T | undefined);
}

function httpVerbOf(method: RequestMethod): string {
  switch (method) {
    case RequestMethod.POST:
      return "POST";
    case RequestMethod.PUT:
      return "PUT";
    case RequestMethod.PATCH:
      return "PATCH";
    case RequestMethod.DELETE:
      return "DELETE";
    case RequestMethod.HEAD:
      return "HEAD";
    case RequestMethod.OPTIONS:
      return "OPTIONS";
    default:
      return "GET";
  }
}

/* eslint-disable no-undef */
import http from "k6/http";
import { check, sleep } from "k6";

/**
 * T-F1-15: carga mínima de búsqueda y reserva sobre el entorno LOCAL.
 *
 * Uso (k6 no está instalado en el repo; es un binario externo):
 *   CARIBE_API_URL=http://localhost:3102 \
 *   CARIBE_E2E_COOKIE='better-auth.session_token=...' \
 *   CARIBE_PRODUCT_ID=<uuid publicado con cupo> \
 *   k6 run --vus 5 --duration 30s scripts/k6/f1-hotels-e2e.js
 *
 * La cookie se obtiene del login de un usuario de demostración; nunca se
 * guarda en el repositorio. Cada VU usa su propia Idempotency-Key.
 */
const apiUrl = __ENV.CARIBE_API_URL ?? "http://localhost:3002";
const productId = __ENV.CARIBE_PRODUCT_ID;
const cookie = __ENV.CARIBE_E2E_COOKIE;

if (!productId || !cookie) {
  throw new Error("Se requieren CARIBE_PRODUCT_ID y CARIBE_E2E_COOKIE");
}

export const options = {
  vus: 5,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
};

const nextDay = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export default function () {
  const search = http.get(`${apiUrl}/api/v1/products?limit=20&type=hotel`);
  check(search, {
    "búsqueda 200": (response) => response.status === 200,
    "búsqueda devuelve productos": (response) => response.json("items")?.length > 0,
  });

  const availability = http.get(`${apiUrl}/api/v1/products/${productId}/availability`);
  const nights = availability.json("nights") ?? [];
  const open = nights.find((night) => Number(night.remaining) > 0);
  check(availability, {
    "disponibilidad 200": (response) => response.status === 200,
    "existe noche con cupo": () => Boolean(open),
  });
  if (!open) return;

  const checkOutDate = new Date(`${open.night}T00:00:00.000Z`);
  checkOutDate.setUTCDate(checkOutDate.getUTCDate() + 1);
  const body = {
    productId,
    checkIn: open.night,
    checkOut: checkOutDate.toISOString().slice(0, 10),
    quantity: 1,
    travelers: [
      {
        fullName: "Ana Pérez",
        documentType: "V",
        documentNumber: `K6${__VU}${__ITER}`.slice(0, 20),
        phone: "+584141234567",
        email: `k6-${__VU}-${__ITER}@example.com`,
      },
    ],
  };
  const params = {
    headers: {
      "content-type": "application/json",
      origin: apiUrl,
      cookie,
      "Idempotency-Key": `k6-${__VU}-${__ITER}-${nextDay(0)}`,
    },
  };
  const booking = http.post(`${apiUrl}/api/v1/bookings`, JSON.stringify(body), params);
  check(booking, {
    "reserva 201 o sin cupo 409": (response) => response.status === 201 || response.status === 409,
    "sin montos ni tasas enviados por el cliente": () => !/"(amountUsd|amountVes|rate)"/.test(JSON.stringify(body)),
  });
  sleep(1);
}

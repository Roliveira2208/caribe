import { ADMIN_PORT, LOCALES } from "@ota/shared";

export const adminConfig = {
  port: ADMIN_PORT,
  apiRoute: "/api",
  locales: LOCALES,
} as const;

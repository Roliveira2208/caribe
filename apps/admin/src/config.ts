import { ADMIN_PORT, LOCALES } from "@caribe/shared";

export const adminConfig = {
  port: ADMIN_PORT,
  apiRoute: "/api",
  locales: LOCALES,
} as const;

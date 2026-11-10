import { LOCALES, WEB_PORT } from "@caribe/shared";

export const webConfig = {
  port: WEB_PORT,
  apiRoute: "/api",
  locales: LOCALES,
} as const;

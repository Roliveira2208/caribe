import { LOCALES, WEB_PORT } from "@ota/shared";

export const webConfig = {
  port: WEB_PORT,
  apiRoute: "/api",
  locales: LOCALES,
} as const;

import { createApp } from "./bootstrap.js";
import { apiConfig } from "./config.js";

async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(apiConfig.port);
}

void bootstrap();

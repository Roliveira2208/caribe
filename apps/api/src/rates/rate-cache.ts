import type { OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

/**
 * Caché de la tasa del proveedor (T-F1-5, design §6): 1 hora por fecha.
 *
 * Redis es opcional: si `REDIS_URL` no está definido (tests, arranque sin
 * Redis) o el servidor no responde, se usa una caché en memoria del proceso.
 * La caché nunca es la fuente de verdad: al expirar se vuelve a resolver.
 */
export class RateCache implements OnModuleDestroy {
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();
  private readonly redis: Redis | null;

  constructor(
    url: string | undefined,
    private readonly now: () => number = Date.now,
  ) {
    if (!url) {
      this.redis = null;
      return;
    }
    const client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
    });
    // Sin listener, un fallo de conexión emite un error no capturado y tumba
    // el proceso. La caché degrada a memoria: el fallo no es fatal.
    client.on("error", () => undefined);
    void client.connect().catch(() => undefined);
    this.redis = client;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.memory.get(key);
    if (entry && entry.expiresAt > this.now()) return entry.value;
    if (entry) this.memory.delete(key);

    const redis = this.ready();
    if (!redis) return null;
    try {
      return await redis.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.memory.set(key, { value, expiresAt: this.now() + ttlMs });
    const redis = this.ready();
    if (!redis) return;
    try {
      await redis.set(key, value, "PX", ttlMs);
    } catch {
      // La copia en memoria ya quedó escrita.
    }
  }

  async close(): Promise<void> {
    if (!this.redis) return;
    this.redis.disconnect();
  }

  /** Nest cierra el cliente Redis al apagar la aplicación. */
  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  /** Cliente listo; si está conectando o caído se usa solo la memoria. */
  private ready(): Redis | null {
    return this.redis?.status === "ready" ? this.redis : null;
  }
}

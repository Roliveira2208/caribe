/**
 * Circuit breaker del proveedor de tasas (T-F1-5, design §6).
 *
 * Se abre tras `threshold` fallos consecutivos y deja de llamar al proveedor
 * durante `cooldownMs`; pasado ese tiempo permite un intento (half-open): si
 * falla, vuelve a abrirse; si acierta, se cierra. El reloj se inyecta para
 * poder probar la ventana sin esperar.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** true si se puede llamar al proveedor (cerrado o half-open vencido). */
  canRequest(): boolean {
    if (this.openedAt === null) return true;
    return this.now() - this.openedAt >= this.cooldownMs;
  }

  /** Un acierto cierra el breaker y reinicia el contador. */
  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  /** Un fallo cuenta; al llegar al umbral se abre la ventana de espera. */
  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openedAt = this.now();
    }
  }
}

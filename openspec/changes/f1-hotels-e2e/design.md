# Diseño: f1-hotels-e2e

- **Datos:** migraciones de `destinations`, `products`, `availability`, `cancellation_policies`, `bookings`,
  `booking_items`, `exchange_rates`, `payments`, `documents` según SDD §5; todo con `tenant_id` y RLS.
- **Reserva:** transacción con `SELECT ... FOR UPDATE` sobre `availability`; `Idempotency-Key` guardada con su
  respuesta por 24 h. Trabajo BullMQ repetible cada minuto para expirar reservas.
- **Tasa:** `ExchangeRateProvider` con `DolarApiProvider` y `ManualOverrideProvider`; caché Redis de 1 h.
- **Pagos:** `PaymentProvider` con `SimulatedPaymentProvider`; máquina de estados explícita (tabla de transiciones
  permitidas en un solo archivo, probada).
- **Documentos:** PDF con una librería de generación a elegir y justificar aquí; numeración correlativa con
  contador por tenant y tipo bloqueado en transacción.
- **Frontend web:** buscador, resultados, detalle, checkout (USD o VES), pago con cuenta regresiva, confirmación.

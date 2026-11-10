import { Module } from "@nestjs/common";
import { TenantService } from "./tenant.service.js";

/**
 * Aislamiento entre tenants (T-F0-7, spec auth-access "Aislamiento entre
 * tenants"): expone TenantService para que los modulos de negocio (audit en
 * T-F0-9, catalogo y reservas en F1/F2) ejecuten sus consultas dentro de una
 * transaccion con el GUC de tenant y las politicas RLS de PostgreSQL
 * filtren por ese valor. No mantiene estado propio: la resolucion vive en
 * la sesion de cada peticion.
 */
@Module({
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}

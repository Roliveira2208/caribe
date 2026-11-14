// Entrada del seed de demostracion: `pnpm db:seed` construye apps/api con
// turbo y ejecuta este archivo con node (dist/seed-main.js). La logica vive
// en seed.ts para que los tests la importen sin procesos ni consola.
import {
  DEMO_PASSWORD,
  demoDestination,
  demoHotel,
  demoOrganization,
  demoPaymentMode,
  demoUsers,
  seedDemo,
} from "./seed.js";

seedDemo()
  .then((summary) => {
    console.log(`Agencia de demostracion: ${demoOrganization.name} (${demoOrganization.slug})`);
    for (const user of demoUsers) {
      const role = user.memberRole ?? user.systemRole ?? "Cliente (sin membresia)";
      console.log(`  ${user.email} - ${role}`);
    }
    console.log(`Contrasena de todos los usuarios de demostracion: ${DEMO_PASSWORD}`);
    console.log(
      `Inventario: ${demoHotel.title.es} (${demoHotel.roomType}) en ` +
        `${demoDestination.name.es}, ${demoHotel.nights} noches desde hoy, ` +
        `modo de pago ${demoPaymentMode}.`,
    );
    const creado = [
      ...(summary.organizationCreated ? ["la agencia"] : []),
      ...summary.createdUserEmails,
      ...summary.createdMembershipEmails,
      ...(summary.createdProvider ? ["el proveedor"] : []),
      ...(summary.createdDestination ? ["el destino"] : []),
      ...(summary.createdPolicy ? ["la politica de cancelacion"] : []),
      ...(summary.createdProduct ? ["el tipo de habitacion"] : []),
      ...(summary.createdAvailabilityNights > 0
        ? [`${summary.createdAvailabilityNights} noches de disponibilidad`]
        : []),
      ...(summary.createdExchangeRate ? ["la tasa global del dia"] : []),
      ...(summary.createdTenantSettings ? ["los ajustes de la agencia"] : []),
    ];
    console.log(
      creado.length > 0
        ? `Creado en esta corrida: ${creado.join(", ")}`
        : "No se creo nada nuevo: los datos de demostracion ya existian.",
    );
  })
  .catch((error: unknown) => {
    console.error("El seed de demostracion fallo:", error);
    process.exitCode = 1;
  });

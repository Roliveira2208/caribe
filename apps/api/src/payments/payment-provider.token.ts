/**
 * Token de inyección del puerto de pagos (D9). Vive en su propio archivo para
 * que ni el adaptador ni la reconciliación importen `payments.service.ts`: ese
 * módulo depende del planificador, que a su vez depende de la reconciliación.
 */
export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

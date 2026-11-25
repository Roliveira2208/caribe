/**
 * CSP del panel (T-F2-3, spec security). Se usa nonce por petición en lugar de
 * hashes porque Next solo puede marcar sus scripts con el nonce cuando la
 * página se renderiza bajo demanda; los hashes estáticos no cubren los scripts
 * generados en cada respuesta. Ant Design inyecta estilos cssinjs en SSR, por
 * eso `style-src` admite `'unsafe-inline'`; `script-src` nunca lo admite.
 */
export function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return `${directives.join("; ")};`;
}

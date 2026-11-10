import config from "@caribe/eslint-config";

// La raíz solo lintea sus propios archivos; cada paquete lint su código con su config.
export default [
  {
    ignores: [
      "apps/**",
      "packages/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.next/**",
    ],
  },
  ...config,
];

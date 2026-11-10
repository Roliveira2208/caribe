import config from "@ota/eslint-config";

export default [
  {
    ignores: ["dist/**", "coverage/**", ".next/**"],
  },
  ...config,
];

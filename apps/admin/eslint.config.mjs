import config from "@caribe/eslint-config";

export default [
  {
    ignores: ["dist/**", "coverage/**", ".next/**"],
  },
  ...config,
];

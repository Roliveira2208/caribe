import config from "@caribe/eslint-config";

export default [
  {
    ignores: ["dist/**", "coverage/**", "src/generated/**"],
  },
  ...config,
];

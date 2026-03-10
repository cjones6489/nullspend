import nextConfig from "eslint-config-next";
import tseslint from "typescript-eslint";

const eslintConfig = [
  { ignores: [
    "packages/sdk/dist/**",
    "packages/mcp-server/dist/**",
    "packages/mcp-proxy/dist/**",
    "packages/cost-engine/dist/**",
    "packages/shared/dist/**",
    "packages/db/dist/**",
    "apps/**",
  ] },
  ...nextConfig,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;

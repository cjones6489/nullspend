import nextConfig from "eslint-config-next";
import tseslint from "typescript-eslint";

const eslintConfig = [
  { ignores: [
    "packages/sdk/dist/**",
    "packages/mcp-server/dist/**",
    "packages/mcp-proxy/dist/**",
    "packages/cost-engine/dist/**",
    "packages/db/dist/**",
    "apps/*/dist/**",
    "apps/*/.wrangler/**",
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
  {
    files: ["apps/proxy/**/*.ts"],
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;

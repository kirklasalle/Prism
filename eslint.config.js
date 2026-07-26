import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**", "*.js", "*.d.ts", "*.js.map"]
    },
    js.configs.recommended,
    {
        files: ["src/**/*.ts", "tests/**/*.ts"],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module"
            }
        },
        plugins: {
            "@typescript-eslint": tseslint.plugin
        },
        rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    "argsIgnorePattern": "^_"
                }
            ],
            "no-console": "off",
            "prefer-const": "warn",
            "no-var": "warn",
            "no-undef": "off",
            "require-yield": "off",
            "no-empty": "warn",
            "no-useless-escape": "warn",
            "no-case-declarations": "warn",
            "no-duplicate-case": "warn",
            "no-constant-condition": "warn",
            "no-extra-boolean-cast": "warn",
            "eqeqeq": [
                "warn",
                "always"
            ],
            "curly": [
                "warn",
                "multi-line"
            ],
            "no-throw-literal": "warn"
        }
    }
);

# Kari Website

## Running the app locally

One command brings up the whole stack (MinIO, seeded fixture data, API on
:3000, UI dev server):

```
./scripts/dev.sh
```

By default the stack is hermetic — a throwaway MinIO container stands in for
S3, seeded with deterministic fixture content, and no AWS account is needed.
Ctrl-C tears everything down.

To develop against the real test bucket (`test.karidavidson.com`) instead:

```
aws sso login   # once per session
./scripts/dev.sh --aws
```

The pieces can still be run by hand if needed: `docker compose up -d --wait
minio`, `node e2e/seed.mjs` (in `ui/`), `cargo run` (in `api/`, whose `.env`
targets the local MinIO), and `npm run dev` (in `ui/`).

## to sync prod s3 to test

```
chmod +x scripts/sync_s3_prod_to_test.sh
./scripts/sync_s3_prod_to_test.sh
```

## Note About Other Works

Other Works are called "blog" in the back end.

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: ["./tsconfig.json", "./tsconfig.node.json"],
    tsconfigRootDir: __dirname,
  },
};
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list

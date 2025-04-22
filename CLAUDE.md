# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- UI: `npm run dev` - Start development server
- UI: `npm run build` - Build production UI
- UI: `npm run build:test` - Build UI for test environment
- UI: `npm run lint` - Lint TypeScript code
- API: `cargo watch -x 'run dev'` - Run API in watch mode
- API: `cargo build` - Build the Rust API

## Code Style Guidelines
- TypeScript: Use strict typing with interfaces (see Models.ts)
- React components: Use functional components with typed props
- CSS: Each component has its own CSS file
- Formatting: 2 space indentation, 80 character line width
- Component file naming: lowercase with extension matching content (.tsx, .css)
- Directory naming: camelCase for components
- Error handling: Proper type checking and error handling

## AWS Integration
- Login: `aws sso login` before running API locally
- S3 sync: `./scripts/sync_s3_prod_to_test.sh` to sync production S3 to test
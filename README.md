# Remix v3 + Bun Demo

> [!IMPORTANT]
> DO NOT USE ON PRODUCTION, this is just a demo

This is a demo application showcasing the integration of Remix v3 with Bun as the runtime environment.

The application uses the new Remix v3 UI and routing features to render a few pages. It integrates with Remix Auth for authentications.

On the home page (`/`) it shows a hydrated counter using Remix UI components instead of React.

To build the client-side code, it uses Bun's built-in bundler, and importmaps to load the dependencies.

## Getting Started

To install dependencies:

```bash
bun install
```

To run in development:

```bash
bun dev
```

To run in production:

```bash
bun start
```

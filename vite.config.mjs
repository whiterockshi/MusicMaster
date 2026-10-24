import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  if (mode !== "local-https") return {};
  let key;
  let cert;
  try {
    key = readFileSync(
      fileURLToPath(new URL("./.certs/dev-key.pem", import.meta.url)),
    );
    cert = readFileSync(
      fileURLToPath(new URL("./.certs/dev-cert.pem", import.meta.url)),
    );
  } catch {
    throw new Error(
      "HTTPS証明書がありません。.certs/dev-key.pem と .certs/dev-cert.pem を用意してください。手順：docs/IPHONE_HTTPS.md。PCのボタン回答・音声回答は npm run dev のLocalアドレスでも確認できます。",
    );
  }
  return {
    server: {
      https: { key, cert },
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      // Never serve local private keys through Vite's source-file endpoint.
      fs: {
        deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.certs/**"],
      },
    },
  };
});

import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_bfnmijwmujfncdqfciyc",
  dirs: ["./src/trigger"],
  runtime: "node",
  maxDuration: 300,
  // pdf.js loads its worker file at runtime; it is installed as a package instead of bundled.
  build: { external: ["pdfjs-dist"] },
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 4, factor: 2, minTimeoutInMs: 1000, maxTimeoutInMs: 30000, randomize: true },
  },
});

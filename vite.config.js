import { defineConfig } from "vite";

export default defineConfig({
  // New id on every build → every device signs in again once after each deploy (see src/main.js).
  define: { "import.meta.env.VITE_BUILD_ID": JSON.stringify(String(Date.now())) },
});

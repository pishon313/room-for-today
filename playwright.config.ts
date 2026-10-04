import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command:
      "VITE_FIREBASE_API_KEY=demo-key VITE_FIREBASE_PROJECT_ID=demo-planner VITE_FIREBASE_AUTH_DOMAIN=demo-planner.firebaseapp.com VITE_FIREBASE_APP_ID=demo-app VITE_USE_EMULATORS=true npm run dev -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
  },
});

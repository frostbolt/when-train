import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Injected at build time from the APP_VERSION build arg (the git short hash
  // on the deploy host); falls back to "dev" for local builds.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || "dev"),
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "whenTrain?",
        short_name: "whenTrain?",
        description: "Real-time NYC subway arrivals near you",
        theme_color: "#111111",
        background_color: "#111111",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: { maxAgeSeconds: 60 },
              networkTimeoutSeconds: 8,
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});

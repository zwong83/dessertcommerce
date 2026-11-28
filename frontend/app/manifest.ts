import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "Gather Dessert", short_name: "Gather Dessert",
    description: "Order desserts and plan your celebrations with Gather Dessert.",
    lang: "en-MY", start_url: "/", scope: "/", display: "standalone",
    background_color: "#fff6d6", theme_color: "#fff6d6",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}

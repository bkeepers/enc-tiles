// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: "ENC Tiles",
      customCss: ["./src/styles/global.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/bkeepers/enc-tiles",
        },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            // Each item here is one entry in the navigation menu.
            { label: "Example Guide", slug: "guides/example" },
          ],
        },
        {
          label: "Charts",
          items: [
            // Each item here is one entry in the navigation menu.
            { label: "NOAA", slug: "charts/noaa" },
          ],
        },
        {
          label: "Reference",
          autogenerate: { directory: "reference" },
        },
      ],
    }),
  ],

  vite: {
    plugins: [
      tailwindcss(),
      viteStaticCopy({
        targets: [
          { src: "../s52/sprites", dest: "public/sprites" },
          { src: "../s52/symbols", dest: "public/symbols" },
        ],
      }),
    ],
  },
});

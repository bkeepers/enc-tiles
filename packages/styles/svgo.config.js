// SVGs from the symbol library use class names to indicate colors and styles.
// This SVGO plugin replaces those class names with actual color and style attributes
// using the specified mode (DAY, DUST, NIGHT).
//
// Usage:
//   MODE=DUSK npx svgo -i input.svg -o output.svg --config=svgo.config.js

import theme from "./dist/themes/index.js";
const MODE = (process.env.MODE ?? "DAY").toUpperCase();
const DEBUG = "DEBUG" in process.env;
const colors = theme[MODE];

export default {
  js2svg: {
    indent: 2, // number
    pretty: true, // boolean
  },
  plugins: [
    {
      name: "s52-colors",
      type: "visitor",
      fn: () => ({
        element: {
          enter: (node, parent) => {
            const classList = (node.attributes.class ?? "").split(" ");

            classList.forEach((cls) => {
              if (DEBUG && cls === "pivotPoint") {
                Object.assign(node.attributes, {
                  stroke: "red",
                  "stroke-width": 0.64,
                });
              } else if (
                cls === "layout" &&
                !classList.includes("pivotPoint")
              ) {
                parent.children = parent.children.filter((n) => n !== node);
              } else if (cls == "sl") {
                Object.assign(node.attributes, {
                  "stroke-linecap": "round",
                  "stroke-linejoin": "round",
                });
              } else if (cls == "f0") {
                Object.assign(node.attributes, { fill: "none" });
              } else if (cls.startsWith("s")) {
                Object.assign(node.attributes, {
                  stroke: colors[cls.slice(1)],
                });
              } else if (cls.startsWith("f")) {
                Object.assign(node.attributes, {
                  fill: colors[cls.slice(1)],
                });
              }
            });
          },
        },
      }),
    },
  ],
};

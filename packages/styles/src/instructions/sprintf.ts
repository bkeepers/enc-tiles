export type SprintfToken =
  | { type: "text"; value: string }
  | {
    type: "specifier";
    raw: string;
    width: number | null;
    precision: number | null;
    length: "l" | null;
    specifier: "s" | "f";
  };

/** Parse a sprintf-style format string into tokens. */
export default function sprintf(fmt) {
  const tokens: SprintfToken[] = [];
  const regex = /%(\d+)?(?:\.(\d+))?l?([sf])/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(fmt)) !== null) {
    // Push preceding text
    if (match.index > lastIndex) {
      tokens.push({
        type: "text",
        value: fmt.slice(lastIndex, match.index)
      });
    }

    const [raw, width, precision, specifier] = match;

    tokens.push({
      type: "specifier",
      raw,
      width: width ? parseInt(width, 10) : null,
      precision: precision ? parseInt(precision, 10) : null,
      length: raw.includes("l") ? "l" : null,
      specifier
    });

    lastIndex = regex.lastIndex;
  }

  // Push trailing text
  if (lastIndex < fmt.length) {
    tokens.push({
      type: "text",
      value: fmt.slice(lastIndex)
    });
  }

  return tokens;
}

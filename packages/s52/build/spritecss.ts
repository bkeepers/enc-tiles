import fs from 'fs';

export default {
  name: 'build-spritecss',
  async buildEnd() {
    const sprite = JSON.parse(fs.readFileSync('./sprites/day.json', 'utf8'));
    const sprite2x = JSON.parse(fs.readFileSync('./sprites/day@2x.json', 'utf8'));

    const width = Math.max(...Object.values(sprite2x).map(({ width, x }) => width + x));
    const height = Math.max(...Object.values(sprite2x).map(({ height, y }) => height + y));

    const css = `
      .symbol,
      .symbol.day {
        background-repeat: no-repeat;
        background-position: top left;
        background-image: url("./day.png");
        display: inline-block;
      }
      .symbol.dusk { background-image: url("./dusk.png"); }
      .symbol.night { background-image: url("./night.png"); }
      ${Object.entries(sprite).map(([name, { x, y, width, height }]) => (
      `.symbol.${name} { background-position: -${x}px -${y}px; width: ${width}px; height: ${height}px; }`
    )).join('\n')
      }
      @media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
        .symbol,
        .symbol.day { background-image: url("./day@2x.png"); background-size: ${width / 2}px ${height / 2}px; }
        .symbol.dusk { background-image: url("./dusk@2x.png"); }
        .symbol.night { background-image: url("./night@2x.png"); }

        ${Object.entries(sprite2x).map(([name, { x, y, width, height }]) => (
        `.symbol.${name} { background-position: -${x / 2}px -${y / 2}px; width: ${width / 2}px; height: ${height / 2}px; }`
      )).join('\n')}
      }
    `;

    fs.writeFileSync('./sprites/style.css', css);
    console.log('✓ sprite.css generated!');
  }
};

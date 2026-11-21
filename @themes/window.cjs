const fs = require('node:fs');
const path = require('node:path');

function windowTheme(theme) {
  const file = path.join(__dirname, theme + '.css');
  const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  function color(property) {
    const match = source.match(new RegExp(`[;{]\\s*--${property}\\s*:\\s*(#[0-9a-f]{6})\\s*(?=[;}])`, 'i'));
    if (!match) throw new Error(`Invalid --${property} in ${file}`);
    return match[1];
  }

  return { theme, color: color('bg2'), symbolColor: color('fg'), background: color('bg') };
}

module.exports = { windowTheme };

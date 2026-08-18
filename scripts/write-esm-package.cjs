const fs = require('node:fs');

fs.mkdirSync('dist/esm', { recursive: true });
fs.writeFileSync('dist/esm/package.json', '{"type":"module"}\n');

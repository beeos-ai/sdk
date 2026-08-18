const fs = require('node:fs');

fs.rmSync('dist', { force: true, recursive: true });

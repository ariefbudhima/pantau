const path = require('path');
const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'pantau-api',
      cwd: path.join(root, 'api'),
      script: 'dist/index.js',
      env: { NODE_ENV: 'production', PORT: 3001 },
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(root, 'logs/api-error.log'),
      out_file: path.join(root, 'logs/api-out.log'),
    },
    {
      name: 'pantau-checker',
      cwd: path.join(root, 'api'),
      script: 'dist/checker.js',
      env: { NODE_ENV: 'production', CHECK_INTERVAL_MS: 60000 },
      instances: 1,
      autorestart: true,
      max_memory_restart: '128M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: path.join(root, 'logs/checker-error.log'),
      out_file: path.join(root, 'logs/checker-out.log'),
    },
  ],
};

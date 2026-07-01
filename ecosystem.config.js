module.exports = {
  apps: [
    {
      name: 'pantau-api',
      cwd: '/home/ubuntu/hermes-data/pantau/api',
      script: 'dist/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/home/ubuntu/hermes-data/pantau/logs/api-error.log',
      out_file: '/home/ubuntu/hermes-data/pantau/logs/api-out.log',
    },
  ],
};

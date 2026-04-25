// PM2 ecosystem config — used by:
//   pm2 start ecosystem.config.js          (first start)
//   pm2 reload ecosystem.config.js         (zero-downtime reload after a git pull)
//
// Docs: https://pm2.keymetrics.io/docs/usage/application-declaration/

module.exports = {
  apps: [
    {
      name: 'cosmetics-api',

      // Entry point
      script: 'src/server.js',

      // Working directory — PM2 resolves all paths relative to this
      cwd: '/home/deploy/app/backend',

      // Load the production .env file before starting
      // (dotenv is also called inside server.js, but this ensures PM2's
      //  environment table shows the right values in `pm2 env 0`)
      env_file: '.env',

      // Run one process per CPU core for better throughput.
      // For a $6 droplet (1 vCPU) this means 1 process — increase when you
      // upgrade the server.
      instances: 'max',
      exec_mode: 'cluster',   // cluster mode shares the same port across instances

      // Restart the process if it crashes, with an exponential back-off
      autorestart: true,
      max_restarts: 10,
      restart_delay: 4000,    // ms between restarts

      // Restart if RSS memory exceeds 500 MB (catches slow memory leaks)
      max_memory_restart: '500M',

      // Write stdout/stderr to these files so you can review them later.
      // Use `pm2 logs cosmetics-api` for a live tail.
      out_file: '/home/deploy/app/logs/pm2-out.log',
      error_file: '/home/deploy/app/logs/pm2-error.log',
      merge_logs: true,

      // Log with timestamps so you know exactly when each line was written
      time: true,

      // Watch is OFF in production — restarts triggered manually via `pm2 reload`
      watch: false,
    },
  ],
};

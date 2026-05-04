// PM2 ecosystem config
//
// First start:    pm2 start ecosystem.config.js
// Zero-downtime:  pm2 reload ecosystem.config.js
// Stop all:       pm2 stop ecosystem.config.js
// Docs: https://pm2.keymetrics.io/docs/usage/application-declaration/

module.exports = {
  apps: [

    // ── HTTP API (cluster — one process per CPU) ───────────────────────────
    // Handles all Express routes. Does NOT start pg-boss or queue workers.
    // Scale horizontally by increasing 'instances' or keeping 'max'.
    {
      name:       'bodycream-api',
      script:     'src/server.js',
      cwd:        '/home/deploy/app/backend',
      env_file:   '.env',

      instances:  'max',       // one process per vCPU; 1 on a $6 droplet
      exec_mode:  'cluster',   // shared port via Node cluster

      autorestart:          true,
      max_restarts:         10,
      restart_delay:        4000,
      max_memory_restart:   '500M',

      // Allow up to 10 s for in-flight HTTP requests to drain on SIGTERM.
      // Our shutdown handler exits after 10 s max; set kill_timeout slightly
      // higher so PM2 doesn't SIGKILL before the handler finishes.
      kill_timeout: 12_000,

      out_file:   '/home/deploy/app/logs/api-out.log',
      error_file: '/home/deploy/app/logs/api-error.log',
      merge_logs: true,
      time:       true,
      watch:      false,
    },

    // ── Background workers (single fork process) ───────────────────────────
    // Runs pg-boss, payment/shipment/notification/reconciliation workers.
    // Must be a single instance — having multiple worker processes duplicates
    // the pg-boss connection pool and re-registers schedules unnecessarily.
    // pg-boss coordinates job dispatch at the DB level, so one instance is enough.
    {
      name:       'bodycream-workers',
      script:     'src/worker.js',
      cwd:        '/home/deploy/app/backend',
      env_file:   '.env',

      instances:  1,
      exec_mode:  'fork',      // not cluster — workers must not fork

      autorestart:          true,
      max_restarts:         10,
      restart_delay:        4000,
      max_memory_restart:   '500M',

      // boss.stop() waits up to 30 s for in-progress jobs to finish.
      // Give PM2 a 35 s window before it escalates to SIGKILL.
      kill_timeout: 35_000,

      out_file:   '/home/deploy/app/logs/workers-out.log',
      error_file: '/home/deploy/app/logs/workers-error.log',
      merge_logs: true,
      time:       true,
      watch:      false,
    },

  ],
};

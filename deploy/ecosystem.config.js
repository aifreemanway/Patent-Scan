// pm2 process config for Patent-Scan (Next.js `next start`).
// Run `npm run build` BEFORE `pm2 reload`. Env: Next auto-loads `.env.production`
// from the app dir — keep it OUT of git, create it on the server (see DEPLOY.md).
//
//   pm2 start deploy/ecosystem.config.js   # first run
//   pm2 reload deploy/ecosystem.config.js  # zero-downtime redeploy
//   pm2 save && pm2 startup                # survive reboots
module.exports = {
  apps: [
    {
      name: "patent-scan",
      cwd: "/var/www/patent-scan",
      // Run the Next binary directly so pm2 manages the node process (clean signals).
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env: { NODE_ENV: "production", PORT: "3000" },
      // Beta scale + I/O-bound long requests → one instance handles concurrency on
      // the async event loop (the wait is external APIs, not CPU). Bump to cluster
      // only if CPU-bound later.
      instances: 1,
      autorestart: true,
      max_memory_restart: "1500M", // headroom on the 4GB box; restart on a creeping leak
      kill_timeout: 135000,        // let an in-flight Deep Analysis (≤120s) finish on reload
    },
  ],
};

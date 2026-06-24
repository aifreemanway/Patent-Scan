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
      // This VPS has broken outbound IPv6 that BLACK-HOLES (silently drops, no
      // RST). Node 20's fetch/undici defaults to Happy-Eyeballs dual-stack
      // auto-selection, so it attempts the AAAA address of dual-stack hosts
      // (e.g. challenges.cloudflare.com for Turnstile siteverify) and stalls on
      // the dead IPv6 family → ETIMEDOUT (~500ms) → login captcha "network"
      // failures. `--dns-result-order=ipv4first` alone does NOT fix it (it
      // reorders DNS but undici still ATTEMPTS IPv6); `--no-network-family-
      // autoselection` disables Happy-Eyeballs so Node connects single-family to
      // the first (IPv4) address, exactly like `curl -4` — verified on the box.
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        NODE_OPTIONS:
          "--dns-result-order=ipv4first --no-network-family-autoselection",
      },
      // Beta scale + I/O-bound long requests → one instance handles concurrency on
      // the async event loop (the wait is external APIs, not CPU). Bump to cluster
      // only if CPU-bound later.
      instances: 1,
      autorestart: true,
      max_memory_restart: "1500M", // headroom on the 4GB box; restart on a creeping leak
      kill_timeout: 135000,        // let an in-flight Deep Analysis (≤120s) finish on reload
    },
    {
      // Literature review pipeline worker. Polls search_requests for pending
      // type=literature_review rows and runs them stage-by-stage (Sonnet via
      // Timeweb + PatSearch + Crossref + Tavily + Wikipedia harvesting + final
      // markdown to Supabase Storage). Separate process so it can run for
      // 10-15min per row without colliding with HTTP request lifecycles.
      name: "patent-scan-worker",
      cwd: "/var/www/patent-scan",
      script: "node_modules/.bin/tsx",
      args: "src/worker/literature-review/index.ts",
      // Same broken-IPv6 mitigation as the web app (see note above).
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS:
          "--dns-result-order=ipv4first --no-network-family-autoselection",
      },
      // fork mode (not cluster) — pm2 cluster_mode is for HTTP servers and
      // silently swallows stdout for non-server scripts (worker shows online
      // but logs stay empty). Fork mode pipes console.* normally.
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1000M",
      // Let an in-flight pipeline finish on reload (up to ~15min). Without
      // this pm2 SIGKILL's mid-Sonnet-call → the row stays in_progress and
      // we resume on next start.
      kill_timeout: 900000,
    },
  ],
};

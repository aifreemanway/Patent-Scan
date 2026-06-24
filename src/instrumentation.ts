// Next.js instrumentation hook — runs once per server instance at startup
// (including each pm2 cluster worker) before any request is served.
//
// Purpose: disable Node's Happy-Eyeballs dual-stack connection auto-selection.
// The prod VPS has broken outbound IPv6 that BLACK-HOLES (silently drops, no
// RST). Node 20's fetch/undici defaults to dual-stack auto-selection, attempts
// the AAAA address of dual-stack hosts (e.g. challenges.cloudflare.com for
// Turnstile siteverify) and stalls on the dead IPv6 family → ETIMEDOUT (~500ms)
// → the login captcha outage (2026-06-24).
//
// Setting --no-network-family-autoselection / --dns-result-order in NODE_OPTIONS
// does NOT work here: under pm2 cluster mode those flags are not applied to the
// cluster workers (verified: the running worker still timed out while a fresh
// `node` with the flag, and this programmatic call, both succeed). Doing it in
// process at startup is mode-independent and guaranteed to take effect.
// Net effect: connect single-family to the first (IPv4) address, like `curl -4`.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const net = await import("node:net");
  const dns = await import("node:dns");
  net.setDefaultAutoSelectFamily(false);
  dns.setDefaultResultOrder("ipv4first");
}

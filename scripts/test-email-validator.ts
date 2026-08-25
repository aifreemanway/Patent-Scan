// Behavioural check for the signup email gate (npm run test:email-validator).
//
// Covers the 2026-08-25 throwaway-inbox case and, just as importantly, the
// DoD attached to it: no domain a real user actually signed up with may
// start failing. Does live DNS, so it needs network.

import { promises as dns } from "dns";

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "  ok  " : " FAIL "} ${name}` +
      (ok ? "" : `\n         expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  );
}

async function reasonFor(email: string): Promise<string> {
  const { validateEmail } = await import("../src/lib/email-validator");
  const r = await validateEmail(email);
  return r.ok ? "ok" : r.reason;
}

async function main() {
  console.log("\n— abuse case (VanishInbox, confirmed 2026-08-25) —");
  for (const d of [
    "fommie.com",
    "fommie.online",
    "fommie.store",
    "myerly.com",
    "whoopza.org",
    "whoopza.store",
  ]) {
    check(`safequail626@${d} blocked`, await reasonFor(`safequail626@${d}`), "disposable_email");
  }

  // The 19 prod profiles are 14 real signups + 5 QA fixtures seeded straight
  // into the DB on 2026-06-03 (qa-free/starter/team/enterprise + team, all
  // @patent-scan.ru). Our own domain has an A record but NO MX, so those
  // fixtures never passed through this gate and never could — they are
  // excluded here on purpose: pre-existing behaviour, untouched by this work.
  console.log("\n— DoD: domains of the real existing prod users still pass —");
  for (const d of [
    "gmail.com",
    "mail.ru",
    "yandex.ru",
    "ya.ru",
    "inbox.ru",
  ]) {
    check(`user@${d} accepted`, await reasonFor(`user@${d}`), "ok");
  }

  console.log("\n— npm blocklist still enforced —");
  check("mailinator.com blocked", await reasonFor("a@mailinator.com"), "disposable_email");

  console.log("\n— well-known services the npm package misses —");
  for (const d of ["tempmail.com", "mail.tm", "minuteinbox.com", "emailondeck.com"]) {
    check(`${d} blocked`, await reasonFor(`a@${d}`), "disposable_email");
  }

  // Alias relays must keep working: one real person, many addresses.
  // Blocking them would cost paying customers — see email-validator.ts.
  console.log("\n— alias relays stay allowed (real people, not throwaways) —");
  for (const d of ["simplelogin.io", "anonaddy.com", "duck.com", "icloud.com"]) {
    check(`${d} accepted`, await reasonFor(`a@${d}`), "ok");
  }

  console.log("\n— env override: add a domain without a deploy —");
  process.env.DISPOSABLE_DOMAINS_EXTRA = "brandnew-temp.example, @another-temp.example";
  check(
    "DISPOSABLE_DOMAINS_EXTRA blocks (and tolerates a leading @ / spaces)",
    await reasonFor("x@another-temp.example"),
    "disposable_email"
  );
  delete process.env.DISPOSABLE_DOMAINS_EXTRA;

  console.log("\n— env allowlist wins over every blocklist (false-positive lever) —");
  process.env.DISPOSABLE_DOMAINS_ALLOW = "fommie.com,mailinator.com";
  check("allowlisted seeded domain passes", await reasonFor("safequail626@fommie.com"), "ok");
  check("allowlisted npm-listed domain passes", await reasonFor("a@mailinator.com"), "ok");
  delete process.env.DISPOSABLE_DOMAINS_ALLOW;

  console.log("\n— kill-switch —");
  process.env.DISPOSABLE_BLOCK_ENABLED = "0";
  check("DISPOSABLE_BLOCK_ENABLED=0 stands the check down", await reasonFor("a@mailinator.com"), "ok");
  delete process.env.DISPOSABLE_BLOCK_ENABLED;
  check("…and blocking is back ON by default", await reasonFor("a@mailinator.com"), "disposable_email");

  // ap-qa, PR #125. A trailing dot makes an absolute FQDN that resolves to the
  // SAME mailbox, and a zero-width char is invisible in any UI — both walked
  // straight past the gate. The gmail case is the worse half and predates the
  // disposable work: it minted a second auth user off one real inbox, handing
  // out a fresh Deep-trial.
  console.log("\n— domain sanitisation (trailing dot / invisible chars) —");
  const ZW = String.fromCharCode(0x200b);
  const { normalizeEmail: norm } = await import("../src/lib/email-validator");
  check("trailing dot cannot bypass", await reasonFor("a@fommie.online."), "disposable_email");
  check("several trailing dots cannot bypass", await reasonFor("a@fommie.online.."), "disposable_email");
  check("zero-width suffix cannot bypass", await reasonFor("a@fommie.online" + ZW), "disposable_email");
  check("dedup: trailing dot collapses", norm("user@gmail.com."), "user@gmail.com");
  check("dedup: zero-width collapses", norm("user@mail.ru" + ZW), "user@mail.ru");

  // Answers 'should we just allowlist the big providers?' (Vsevolod, 25.08).
  // Not as a door — 69.7% of the 1000-company outreach base is on 644 distinct
  // corporate domains — but as a floor under our own blocklist.
  console.log("\n— major providers can never be blocked by a bad list entry —");
  process.env.DISPOSABLE_DOMAINS_EXTRA = "gmail.com,mail.ru,yandex.ru";
  for (const d of ["gmail.com", "mail.ru", "yandex.ru"]) {
    check(`${d} survives a bad blocklist entry`, await reasonFor(`a@${d}`), "ok");
  }
  delete process.env.DISPOSABLE_DOMAINS_EXTRA;

  console.log("\n— normalization —");
  const { normalizeEmail } = await import("../src/lib/email-validator");
  check("gmail dots+tag collapse", normalizeEmail("Vse.volod+x@googlemail.com"), "vsevolod@gmail.com");
  check("tag dropped on non-gmail, dots kept", normalizeEmail("a.b+tag@mail.ru"), "a.b@mail.ru");

  console.log("\n— MX —");
  check("format garbage", await reasonFor("not-an-email"), "invalid_format");
  check(
    "nonexistent domain → definitive block",
    await reasonFor("a@this-domain-does-not-exist-ap-9f3k2.example"),
    "no_mx_record"
  );

  // Transient resolver failure must NOT refuse a legitimate signup. Patch the
  // shared dns.promises object the validator holds a reference to.
  const realResolveMx = dns.resolveMx;
  for (const [label, code] of [
    ["timeout", "ETIMEOUT"],
    ["SERVFAIL", "ESERVFAIL"],
    ["refused", "ECONNREFUSED"],
  ] as const) {
    (dns as { resolveMx: unknown }).resolveMx = async () => {
      const e = new Error(`simulated ${label}`) as NodeJS.ErrnoException;
      e.code = code;
      throw e;
    };
    check(`transient ${label} fails OPEN`, await reasonFor("real.customer@mail.ru"), "ok");
  }
  (dns as { resolveMx: unknown }).resolveMx = async () => {
    const e = new Error("simulated NXDOMAIN") as NodeJS.ErrnoException;
    e.code = "ENOTFOUND";
    throw e;
  };
  check("definitive ENOTFOUND still blocks", await reasonFor("a@mail.ru"), "no_mx_record");
  (dns as { resolveMx: unknown }).resolveMx = async () => {
    const e = new Error("simulated malformed name") as NodeJS.ErrnoException;
    e.code = "EBADNAME";
    throw e;
  };
  check("EBADNAME is definitive, not transient", await reasonFor("a@mail.ru"), "no_mx_record");
  (dns as { resolveMx: unknown }).resolveMx = realResolveMx;

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();

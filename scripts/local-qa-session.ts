/**
 * Генерирует QA-сессию для локального dev-тестирования.
 * Использует Supabase admin API, ключи берёт из .env.local.
 * Сохраняет cookie-значение в SESSION_FILE для t1-recall-test.ts.
 *
 * Запуск из web/: npx tsx scripts/local-qa-session.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";

const SESSION_FILE =
  "C:\\Users\\kobzar\\AppData\\Local\\Temp\\qa_session_token.txt";
const QA_EMAIL = "qa-team@patent-scan.ru";

// Парсим .env.local (CWD = web/)
const envContent = readFileSync(".env.local", "utf-8");
function getEnv(name: string): string {
  const match = envContent.match(new RegExp(`^${name}=(.+)$`, "m"));
  if (!match) throw new Error(`Missing ${name} in .env.local`);
  return match[1].trim();
}

const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

// Admin-клиент для генерации magic link (без отправки письма)
async function main() {
  // Admin-клиент для генерации magic link (без отправки письма)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Generating magic link for ${QA_EMAIL} ...`);
  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: QA_EMAIL,
    });

  if (linkError || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${linkError?.message ?? "no token"}`);
  }

  const hashedToken = linkData.properties.hashed_token;
  console.log("Token generated, exchanging for session...");

  // Обычный клиент — верифицирует OTP и возвращает session
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: otpData, error: otpError } = await client.auth.verifyOtp({
    type: "email",
    token_hash: hashedToken,
  });

  if (otpError || !otpData?.session) {
    throw new Error(`verifyOtp failed: ${otpError?.message ?? "no session"}`);
  }

  const session = otpData.session;

  // Формат @supabase/ssr v0.10.x (cookieEncoding: "base64url"):
  //   cookie value = "base64-" + base64url(JSON.stringify(session))
  // See: @supabase/ssr/dist/main/cookies.js, BASE64_PREFIX logic
  const sessionJson = JSON.stringify(session);
  const encoded = Buffer.from(sessionJson, "utf-8").toString("base64url");
  const cookieValue = `base64-${encoded}`;

  writeFileSync(SESSION_FILE, cookieValue, "utf-8");

  console.log("\n✓ QA session saved →", SESSION_FILE);
  console.log("  Email    :", session.user.email);
  console.log("  User ID  :", session.user.id);
  console.log(
    "  Expires  :",
    new Date((session.expires_at ?? 0) * 1000).toISOString()
  );
  console.log("  Cookie len:", cookieValue.length, "chars");
  console.log("\nNext: npx tsx scripts/t1-recall-test.ts");
}

main().catch((e) => {
  console.error("FATAL:", e.message ?? e);
  process.exit(1);
});

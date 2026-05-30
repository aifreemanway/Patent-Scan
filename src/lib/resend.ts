// Minimal Resend client — direct POST to https://api.resend.com/emails. We
// don't pull in the `resend` npm package because (a) the API is one endpoint
// and (b) the worker process needs to import this too and the package's React
// dependency would drag DOM types into a non-DOM environment.
//
// Auth: RESEND_API_KEY in env. Sender hard-coded to noreply@patent-scan.com
// because that's the only verified sender on the patent-scan.com domain.
//
// Failure-mode: each helper swallows transport errors and logs to console —
// transactional sends are best-effort. The worker should not crash a 15-minute
// pipeline because Resend hiccupped on one of three emails.

const RESEND_URL = "https://api.resend.com/emails";
const SENDER = "ПатентСкан <noreply@patent-scan.com>";
const REPLY_TO = "support@patent-scan.com";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendTransactionalEmail(
  input: SendEmailInput
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[resend] RESEND_API_KEY missing");
    return { ok: false, error: "missing_api_key" };
  }

  try {
    const resp = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: SENDER,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: REPLY_TO,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error("[resend] non-2xx", {
        status: resp.status,
        to: input.to,
        body: body.slice(0, 400),
      });
      return { ok: false, error: `resend_${resp.status}` };
    }

    const data = (await resp.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id };
  } catch (e) {
    console.error("[resend] transport error", {
      to: input.to,
      message: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, error: "transport_error" };
  }
}

/**
 * Cloudflare Worker example — merge with your existing email logic.
 * Set secret: wrangler secret put TURNSTILE_SECRET_KEY
 */

const ALLOWED_ORIGINS = [
  "https://www.iterativestudio.com",
  "https://iterativestudio.com",
  "http://localhost:8788",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status = 200, origin = ALLOWED_ORIGINS[0]) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

async function verifyTurnstile(token, secret, remoteip) {
  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (remoteip) body.set("remoteip", remoteip);

  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return result.json();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return json({ success: false, error: "Method not allowed" }, 405, origin);
    }

    const form = await request.formData();
    const token = form.get("cf-turnstile-response");
    const remoteip = request.headers.get("CF-Connecting-IP") || "";

    if (!token) {
      return json({ success: false, blocked: true, error: "Bot check failed" }, 400, origin);
    }

    const verification = await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, remoteip);
    if (!verification.success) {
      return json({ success: false, blocked: true, error: "Bot check failed" }, 403, origin);
    }

    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const company = String(form.get("company") || "").trim();
    const message = String(form.get("message") || "").trim();

    if (!name || !email || !message) {
      return json({ success: false, error: "Missing required fields" }, 400, origin);
    }

    // TODO: send email with your existing provider (Resend, Mailchannels, etc.)
    // await sendPortfolioRequestEmail({ name, email, company, message }, env);

    return json({ success: true }, 200, origin);
  },
};
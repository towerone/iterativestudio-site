/**
 * Contact form worker — deploy to contact-form-worker.taproot-lychee7i.workers.dev
 *
 * Required secrets / vars (Cloudflare dashboard → Worker → Settings → Variables):
 *   TURNSTILE_SECRET_KEY  — Turnstile secret key
 *   CONTACT_TO_EMAIL      — where portfolio requests are delivered
 *   RESEND_API_KEY        — if using Resend (optional if you swap sendEmail)
 *   FROM_EMAIL            — verified sender, e.g. contact@iterativestudio.com
 */

const ALLOWED_ORIGINS = new Set([
  "https://www.iterativestudio.com",
  "https://iterativestudio.com",
  "http://127.0.0.1:8788",
  "http://localhost:8788",
]);

function corsHeaders(origin, extra = {}) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://www.iterativestudio.com";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    ...extra,
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

async function verifyTurnstile(token, secret, remoteip) {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.set("remoteip", remoteip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return res.json();
}

async function sendEmail(env, { name, email, company, message }) {
  // If you already send mail another way in your Worker, replace this function
  // and keep the Turnstile + CORS logic below.
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL || !env.CONTACT_TO_EMAIL) {
    console.log("Portfolio request", { name, email, company, message });
    return;
  }

  const companyLine = company ? `Company: ${company}\n` : "";
  const text = [
    "Portfolio access request",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    companyLine,
    "Message:",
    message,
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: env.CONTACT_TO_EMAIL,
      reply_to: email,
      subject: `Portfolio access request — ${name}`,
      text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Email send failed: ${detail}`);
  }
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

    try {
      const form = await request.formData();
      const token = String(form.get("cf-turnstile-response") || "");
      const remoteip = request.headers.get("CF-Connecting-IP") || "";

      if (!token) {
        return json({ success: false, blocked: true, error: "Bot check failed" }, 400, origin);
      }

      const check = await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, remoteip);
      if (!check.success) {
        return json({ success: false, blocked: true, error: "Bot check failed" }, 403, origin);
      }

      const name = String(form.get("name") || "").trim();
      const email = String(form.get("email") || "").trim();
      const company = String(form.get("company") || "").trim();
      const message = String(form.get("message") || "").trim();

      if (!name || !email || !message) {
        return json({ success: false, error: "Missing required fields" }, 400, origin);
      }

      await sendEmail(env, { name, email, company, message });
      return json({ success: true }, 200, origin);
    } catch (err) {
      console.error(err);
      return json({ success: false, error: "Server error" }, 500, origin);
    }
  },
};
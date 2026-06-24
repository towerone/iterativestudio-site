/**
 * Paste this into your Cloudflare Worker (contact-form-worker).
 *
 * Dashboard → Worker → Settings → Variables / Secrets:
 *   TURNSTILE_SECRET_KEY  (secret)
 *   RESEND_API_KEY        (secret)
 *   CONTACT_TO_EMAIL      (text)  — your inbox
 *   FROM_EMAIL            (text)  — verified Resend sender
 */

const ALLOWED_ORIGINS = new Set([
  "https://www.iterativestudio.com",
  "https://iterativestudio.com",
]);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://www.iterativestudio.com";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
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

async function sendResendEmail(env, { name, email, company, message }) {
  const companyLine = company && company !== "N/A" ? `<p><strong>Company:</strong> ${company}</p>` : "";
  const html = `
    <h2>Portfolio access request</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    ${companyLine}
    <p><strong>Message:</strong></p>
    <p>${message.replace(/\n/g, "<br>")}</p>
  `;

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
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend error: ${detail}`);
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
      const formData = await request.formData();
      const token = formData.get("cf-turnstile-response");

      if (!token) {
        return json({ success: false, blocked: true, error: "Bot check failed" }, 400, origin);
      }

      const turnstileResponse = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: env.TURNSTILE_SECRET_KEY,
            response: token,
          }),
        }
      );

      const outcome = await turnstileResponse.json();

      if (!outcome.success) {
        return json({ success: false, blocked: true, error: "Bot check failed" }, 400, origin);
      }

      const name = String(formData.get("name") || "Unknown").trim();
      const email = String(formData.get("email") || "").trim();
      const company = String(formData.get("company") || "N/A").trim();
      const message = String(formData.get("message") || "No message provided").trim();

      if (!email || email === "Unknown") {
        return json({ success: false, error: "Missing email" }, 400, origin);
      }

      await sendResendEmail(env, { name, email, company, message });

      return json({ success: true }, 200, origin);
    } catch (err) {
      console.error(err);
      return json({ success: false, error: "Server error" }, 500, origin);
    }
  },
};
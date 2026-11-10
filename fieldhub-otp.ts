// =====================================================================
// fieldhub-otp  —  password reset by a one-time code (free)
// Deploy as a NEW Edge Function named exactly:  fieldhub-otp
//   Supabase dashboard -> Edge Functions -> Deploy a new function -> paste this file.
//   It is called by people who are signed OUT, so it uses the public (anon) key like the sign-in page does.
//
// Secrets it uses (Edge Functions -> Secrets). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY already exist.
//   SMTP_USER, SMTP_PASS, SMTP_FROM_NAME  -> e-mail codes (same names fieldhub-push uses; Gmail + "App password")
//   WhatsApp codes: see sendWhatsApp() below. It is switched OFF until its sending code is pasted in.
//
// Safety: 6-digit code, valid 10 minutes, 5 wrong tries then dead, 3 codes per hour per person,
// 60 s between codes, codes stored only as a salted hash, table has no public access.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---- switch WhatsApp codes on by pasting the sender below and setting this to true ----
const WHATSAPP_READY = false;
async function sendWhatsApp(_toE164: string, _text: string): Promise<{ ok: boolean; error?: string }> {
  // TODO: paste the provider call that fieldhub-actions uses for action "send_whatsapp" here,
  //       then return { ok: true } on success or { ok: false, error: "..." } on failure.
  return { ok: false, error: "WhatsApp sending is not connected yet." };
}

const EMAIL_READY = () => !!Deno.env.get("SMTP_USER") && !!Deno.env.get("SMTP_PASS");
async function sendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = Deno.env.get("SMTP_USER")!, pass = Deno.env.get("SMTP_PASS")!;
    const name = Deno.env.get("SMTP_FROM_NAME") || "FieldHub";
    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: user, password: pass } } });
    await client.send({ from: `${name} <${user}>`, to, subject, content: text });
    await client.close();
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e) }; }
}

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha256(s: string) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
function safeEq(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

// phone typed as 03xx..., +923xx..., 923xx...  ->  the three ways it may be stored
function phoneForms(raw: string) {
  const d = String(raw || "").replace(/\D/g, "");
  const last10 = d.slice(-10);
  if (last10.length !== 10 || last10[0] !== "3") return null;
  return { e164: "+92" + last10, forms: ["+92" + last10, "0" + last10, "92" + last10] };
}
async function findUser(raw: string) {
  const p = phoneForms(raw); if (!p) return null;
  const { data } = await admin.from("profiles").select("id, full_name, status, recovery_email, email, phone").in("phone", p.forms).limit(1);
  const u = data && data[0];
  if (!u || String(u.status) === "disabled" || String(u.status) === "pending") return null;
  return { ...u, e164: p.e164, mail: (u.recovery_email || u.email || "") as string };
}
const maskEmail = (e: string) => { const [a, d] = e.split("@"); return (a[0] || "") + "•••@" + d; };
const maskPhone = (p: string) => p.slice(0, 4) + " ••• ••• " + p.slice(-2);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "status") return json({ ok: true, whatsapp: WHATSAPP_READY, email: EMAIL_READY() });

    if (action === "request_code") {
      const channel = body.channel === "email" ? "email" : "whatsapp";
      if (channel === "whatsapp" && !WHATSAPP_READY) return json({ ok: false, error: "WhatsApp codes are not switched on yet. Please choose e-mail, or send a request to your supervisor." });
      if (channel === "email" && !EMAIL_READY()) return json({ ok: false, error: "E-mail codes are not switched on yet. Please choose WhatsApp, or send a request to your supervisor." });
      const u = await findUser(body.phone);
      if (!u) { await new Promise((r) => setTimeout(r, 600)); return json({ ok: true, hint: "your registered contact" }); }   // same answer whether or not the number exists
      if (channel === "email" && !u.mail) return json({ ok: false, error: "No recovery e-mail is saved on this account. Please choose WhatsApp, or send a request to your supervisor." });

      const since = new Date(Date.now() - 3600 * 1000).toISOString();
      const { data: recent } = await admin.from("password_reset_codes").select("created_at").eq("user_id", u.id).gte("created_at", since).order("created_at", { ascending: false });
      if (recent && recent.length >= 3) return json({ ok: false, error: "Too many codes were requested. Please wait one hour, or send a request to your supervisor." });
      if (recent && recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < 60000) return json({ ok: false, error: "A code was just sent. Please wait one minute before asking for another." });

      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
      const salt = hex(crypto.getRandomValues(new Uint8Array(12)));
      const { data: row, error: insErr } = await admin.from("password_reset_codes").insert({ user_id: u.id, channel, salt, code_hash: await sha256(salt + ":" + code), expires_at: new Date(Date.now() + 10 * 60000).toISOString() }).select("id").single();
      if (insErr) return json({ ok: false, error: "Could not create a code. Please try again." });

      const text = `FieldHub: your password reset code is ${code}. It works for 10 minutes. Never share it with anyone.`;
      const sent = channel === "email" ? await sendEmail(u.mail, "Your FieldHub password reset code", text) : await sendWhatsApp(u.e164, text);
      if (!sent.ok) { await admin.from("password_reset_codes").delete().eq("id", row!.id); return json({ ok: false, error: "The code could not be sent. " + (sent.error || "") }); }
      return json({ ok: true, hint: channel === "email" ? maskEmail(u.mail) : maskPhone(u.e164) });
    }

    if (action === "verify_code") {
      const code = String(body.code || "").replace(/\D/g, "");
      const pw = String(body.new_password || "");
      if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return json({ ok: false, error: "The new password needs at least 8 characters, with letters and numbers." });
      const u = await findUser(body.phone);
      const bad = { ok: false, error: "The code is wrong or has expired. Please check it or ask for a new code." };
      if (!u || code.length !== 6) return json(bad);
      const { data: rows } = await admin.from("password_reset_codes").select("*").eq("user_id", u.id).is("used_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1);
      const r = rows && rows[0];
      if (!r || r.attempts >= 5) return json(bad);
      const ok = safeEq(await sha256(r.salt + ":" + code), r.code_hash);
      if (!ok) { await admin.from("password_reset_codes").update({ attempts: r.attempts + 1 }).eq("id", r.id); return json(bad); }
      const { error } = await admin.auth.admin.updateUserById(u.id, { password: pw });
      if (error) return json({ ok: false, error: "Could not change the password: " + error.message });
      await admin.from("password_reset_codes").update({ used_at: new Date().toISOString() }).eq("id", r.id);
      await admin.from("profiles").update({ must_change_password: false }).eq("id", u.id);
      await admin.from("password_reset_requests").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("phone", u.e164).eq("status", "pending");   // close an old pending request, if any
      return json({ ok: true });
    }
    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e) { return json({ ok: false, error: "Something went wrong. Please try again." }, 500); }
});

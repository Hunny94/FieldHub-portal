// =========================================================
// EDIT THIS FILE ONLY — nothing else needs to change here.
// Paste in the two values from your Supabase project:
// Settings (gear icon) → API → "Project URL" and "anon public" key
// =========================================================
const SUPABASE_URL = "https://erdsdvitfvpwlhwiflco.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyZHNkdml0ZnZwd2xod2lmbGNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMjA2NDgsImV4cCI6MjA5OTY5NjY0OH0.5Jft6II64atshjB7tSf11bimwAxOopl1sgqTxYYqRZQ";

// Only needed once you deploy the Edge Function (bulk rider upload +
// WhatsApp alerts). Looks like: https://xxxxx.supabase.co/functions/v1/fieldhub-actions
// Leave as-is until then — those features will just quietly do nothing.
const FUNCTIONS_URL = "PASTE_YOUR_EDGE_FUNCTION_URL_HERE";

import {
  authenticatedUser,
  createSignedState,
  ensureSiteOrigin,
  GOOGLE_REDIRECT_URI,
  jsonResponse,
} from "../_shared/google_calendar.ts";

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: {
    "Access-Control-Allow-Origin": "https://victorferrazsep-cmd.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  } });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);
  const originError = ensureSiteOrigin(request);
  if (originError) return originError;

  try {
    const user = await authenticatedUser(request);
    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    if (!clientId) throw new Error("ID do cliente OAuth não configurado no servidor.");

    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: "https://www.googleapis.com/auth/calendar.events",
      state: await createSignedState(user.id),
    }).toString();

    return jsonResponse({ authorizationUrl: authorizationUrl.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao iniciar a autorização Google.";
    return jsonResponse({ error: message }, 401);
  }
});

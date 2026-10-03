import {
  adminClient,
  authenticatedUser,
  corsHeaders,
  decryptRefreshToken,
  encryptRefreshToken,
  ensureSiteOrigin,
  jsonResponse,
} from "../_shared/google_calendar.ts";

function parseCalendarRequest(path: unknown, method: unknown) {
  if (typeof path !== "string" || typeof method !== "string") {
    throw new Error("Solicitação do calendário inválida.");
  }
  const normalizedMethod = method.toUpperCase();
  const [resource, query = ""] = path.split("?", 2);
  if (resource === "events" && normalizedMethod === "GET") {
    const input = new URLSearchParams(query);
    const allowed = ["timeMin", "timeMax", "singleEvents", "orderBy", "maxResults", "pageToken"];
    const params = new URLSearchParams();
    for (const key of allowed) {
      const value = input.get(key);
      if (value !== null) params.set(key, value);
    }
    return { method: normalizedMethod, resource: `events?${params}` };
  }
  if (normalizedMethod === "POST" && resource === "events") {
    return { method: normalizedMethod, resource };
  }
  const eventMatch = /^events\/([A-Za-z0-9_@.-]+)$/.exec(resource);
  if (eventMatch && ["PATCH", "DELETE"].includes(normalizedMethod)) {
    return { method: normalizedMethod, resource };
  }
  throw new Error("Operação do Google Agenda não permitida.");
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);
  const originError = ensureSiteOrigin(request);
  if (originError) return originError;

  try {
    const user = await authenticatedUser(request);
    const payload = await request.json();
    const admin = adminClient();
    const { data: credentials, error: credentialsError } = await admin
      .from("google_calendar_credentials")
      .select("encrypted_refresh_token,encryption_iv")
      .eq("user_id", user.id)
      .maybeSingle();

    if (credentialsError) throw credentialsError;
    if (payload.path === "status") return jsonResponse({ connected: Boolean(credentials) });
    if (!credentials) return jsonResponse({ error: "Conecte sua conta do Google Agenda." }, 409);
    const { method, resource } = parseCalendarRequest(payload.path, payload.method);

    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
    const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
    if (!clientId || !clientSecret || !calendarId) {
      throw new Error("Configuração do Google Agenda incompleta no servidor.");
    }

    const refreshToken = await decryptRefreshToken(
      credentials.encrypted_refresh_token,
      credentials.encryption_iv,
    );
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Falha ao renovar token do Google:", tokenData.error);
      return jsonResponse({ error: "A autorização Google expirou. Conecte o calendário novamente." }, 401);
    }

    if (tokenData.refresh_token) {
      const encrypted = await encryptRefreshToken(tokenData.refresh_token);
      const { error: updateError } = await admin
        .from("google_calendar_credentials")
        .update({ ...encrypted, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
      if (updateError) throw updateError;
    }

    const googleUrl = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/${resource}`,
    );
    const googleResponse = await fetch(googleUrl, {
      method,
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        ...(payload.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload.body ? { body: JSON.stringify(payload.body) } : {}),
    });
    const responseData = await googleResponse.json().catch(() => ({}));
    if (!googleResponse.ok) {
      console.error("Erro na API Google Calendar:", googleResponse.status, responseData.error?.message);
      return jsonResponse({
        error: responseData.error?.message || `Erro do Google Agenda (${googleResponse.status}).`,
      }, googleResponse.status);
    }
    return jsonResponse(responseData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao acessar o Google Agenda.";
    return jsonResponse({ error: message }, 400);
  }
});

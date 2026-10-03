import {
  adminClient,
  encryptRefreshToken,
  GOOGLE_REDIRECT_URI,
  SITE_RETURN_URL,
  verifySignedState,
} from "../_shared/google_calendar.ts";

function redirectResult(result: string): Response {
  const url = new URL(SITE_RETURN_URL);
  url.searchParams.set("googleCalendar", result);
  return Response.redirect(url, 303);
}

Deno.serve(async request => {
  if (request.method !== "GET") return new Response("Método não permitido.", { status: 405 });

  try {
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    if (error) return redirectResult("denied");

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new Error("Resposta OAuth incompleta.");
    const { userId } = await verifySignedState(state);

    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("Credenciais OAuth do Google não configuradas no servidor.");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error("Falha na troca do código OAuth:", tokenData.error);
      throw new Error("O Google não aceitou a autorização. Confira o URI de redirecionamento OAuth.");
    }
    if (!tokenData.refresh_token) {
      throw new Error("O Google não retornou autorização persistente. Revogue o acesso do app na conta Google e tente conectar novamente.");
    }

    const encrypted = await encryptRefreshToken(tokenData.refresh_token);
    const { error: saveError } = await adminClient()
      .from("google_calendar_credentials")
      .upsert({ user_id: userId, ...encrypted, updated_at: new Date().toISOString() });
    if (saveError) throw saveError;
    return redirectResult("connected");
  } catch (error) {
    console.error("Erro no callback OAuth do Google Agenda:", error);
    return redirectResult("error");
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";

export const SITE_ORIGIN = "https://victorferrazsep-cmd.github.io";
export const SITE_RETURN_URL = `${SITE_ORIGIN}/studio1/`;
export const GOOGLE_REDIRECT_URI =
  `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-calendar-auth-callback`;

export const corsHeaders = {
  "Access-Control-Allow-Origin": SITE_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

export function ensureSiteOrigin(request: Request): Response | null {
  const origin = request.headers.get("Origin");
  return origin === SITE_ORIGIN ? null : jsonResponse({ error: "Origem não autorizada." }, 403);
}

export async function authenticatedUser(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("Faça login para continuar.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const anonKey = publishableKeys
    ? JSON.parse(publishableKeys).default
    : Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) throw new Error("Configuração do Supabase incompleta.");

  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Sessão inválida. Entre novamente.");
  return data.user;
}

export function adminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const serviceRoleKey = secretKeys
    ? JSON.parse(secretKeys).default
    : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Configuração administrativa do Supabase incompleta.");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function stateKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET");
  if (!secret || secret.length < 32) throw new Error("Segredo OAuth de estado não configurado.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export async function createSignedState(userId: string): Promise<string> {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    userId,
    issuedAt: Date.now(),
    nonce: crypto.randomUUID(),
  })));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await stateKey(),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySignedState(state: string): Promise<{ userId: string }> {
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra) throw new Error("Estado OAuth inválido.");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await stateKey(),
    decodeBase64Url(signature),
    new TextEncoder().encode(payload),
  );
  if (!valid) throw new Error("Estado OAuth inválido.");

  const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
  if (
    typeof parsed.userId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(parsed.userId) ||
    !Number.isFinite(parsed.issuedAt) ||
    Date.now() - parsed.issuedAt > 10 * 60 * 1000 ||
    parsed.issuedAt > Date.now() + 60_000 ||
    typeof parsed.nonce !== "string"
  ) {
    throw new Error("A solicitação de autorização expirou. Tente novamente.");
  }
  return { userId: parsed.userId };
}

async function encryptionKey(): Promise<CryptoKey> {
  const encoded = Deno.env.get("GOOGLE_REFRESH_TOKEN_ENCRYPTION_KEY");
  if (!encoded) throw new Error("Chave de criptografia do token não configurada.");
  const raw = decodeBase64Url(encoded);
  if (raw.length !== 32) throw new Error("A chave de criptografia deve conter 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptRefreshToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(token),
  );
  return {
    encrypted_refresh_token: encodeBase64Url(new Uint8Array(ciphertext)),
    encryption_iv: encodeBase64Url(iv),
  };
}

export async function decryptRefreshToken(ciphertext: string, iv: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64Url(iv) },
    await encryptionKey(),
    decodeBase64Url(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

import { createClient, SupabaseClient, User } from "@supabase/supabase-js";

function env(name: string) {
  return process.env[name] || "";
}

// Client scoped to the requesting user's JWT, so RLS applies as that user.
export function getUserClient(token: string): SupabaseClient | null {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

// Service-role client for webhook writes. Never expose to the browser.
export function getServiceClient(): SupabaseClient | null {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export async function getRequestUser(
  request: Request
): Promise<{ user: User; token: string; client: SupabaseClient } | null> {
  const token = getBearerToken(request);
  if (!token) return null;
  const client = getUserClient(token);
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, token, client };
}

export interface SubscriptionRow {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
}

const GRACE_MS = 24 * 60 * 60 * 1000; // tolerate slightly-late renewal webhooks

export function isActiveSubscription(sub: SubscriptionRow | null): boolean {
  if (!sub) return false;
  if (sub.status !== "active" && sub.status !== "trialing") return false;
  if (!sub.current_period_end) return true;
  return new Date(sub.current_period_end).getTime() + GRACE_MS > Date.now();
}

export async function getSubscription(
  client: SupabaseClient,
  userId: string
): Promise<SubscriptionRow | null> {
  const { data } = await client
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as SubscriptionRow) || null;
}

// Resolves whether the request comes from a paying user.
export async function isProRequest(request: Request): Promise<boolean> {
  const auth = await getRequestUser(request);
  if (!auth) return false;
  const sub = await getSubscription(auth.client, auth.user.id);
  return isActiveSubscription(sub);
}

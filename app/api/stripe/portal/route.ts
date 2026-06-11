import { NextRequest } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getRequestUser, getSubscription } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return Response.json({ error: "Stripe is not configured" }, { status: 500 });
  }

  const auth = await getRequestUser(request);
  if (!auth) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  const sub = await getSubscription(auth.client, auth.user.id);
  if (!sub?.stripe_customer_id) {
    return Response.json({ error: "No subscription found" }, { status: 404 });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: request.nextUrl.origin,
  });

  return Response.json({ url: session.url });
}

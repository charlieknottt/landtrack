import { NextRequest } from "next/server";
import { getStripe, PLAN } from "@/lib/stripe";
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

  const existing = await getSubscription(auth.client, auth.user.id);
  const origin = request.nextUrl.origin;
  const priceId = process.env.STRIPE_PRICE_ID;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: auth.user.id,
    ...(existing?.stripe_customer_id
      ? { customer: existing.stripe_customer_id }
      : { customer_email: auth.user.email ?? undefined }),
    line_items: [
      priceId
        ? { price: priceId, quantity: 1 }
        : {
            price_data: {
              currency: PLAN.currency,
              unit_amount: PLAN.unitAmount,
              recurring: { interval: PLAN.interval },
              product_data: { name: PLAN.name },
            },
            quantity: 1,
          },
    ],
    subscription_data: { metadata: { user_id: auth.user.id } },
    metadata: { user_id: auth.user.id },
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancelled`,
  });

  return Response.json({ url: session.url });
}

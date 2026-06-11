import Stripe from "stripe";

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

// Single $9/mo plan. If STRIPE_PRICE_ID is set, that price is used;
// otherwise the price is defined inline at checkout.
export const PLAN = {
  name: "LandTrack Pro",
  unitAmount: 900,
  currency: "usd",
  interval: "month" as const,
};

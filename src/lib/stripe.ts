import Stripe from "stripe";

type StripeClient = InstanceType<typeof Stripe>;

let _stripe: StripeClient | null = null;

export function getStripe(): StripeClient {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is required");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-04-22.dahlia",
    });
  }
  return _stripe;
}

// Convenience proxy — callers use `stripe.x` unchanged; client is created on first access
export const stripe = new Proxy({} as StripeClient, {
  get(_target, prop) {
    return (getStripe() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

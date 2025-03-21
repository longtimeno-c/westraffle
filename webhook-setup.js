/**
 * Webhook Setup Guidance
 * 
 * This file doesn't need to be run - it provides instructions for setting up Stripe webhooks
 * for both local development and production.
 * 
 * Local Development:
 * 1. Install the Stripe CLI from https://stripe.com/docs/stripe-cli
 * 2. Run the login command: stripe login
 * 3. Forward webhooks to your local server:
 *    stripe listen --forward-to http://localhost:3001/webhook
 * 
 * 4. The CLI will display a webhook signing secret, add it to your .env file:
 *    STRIPE_WEBHOOK_SECRET=whsec_xxxxxxx
 * 
 * Production:
 * 1. Go to the Stripe Dashboard > Developers > Webhooks
 * 2. Add an endpoint with your production URL: https://your-domain.com/webhook
 * 3. Select the events you want to receive (at minimum: checkout.session.completed)
 * 4. After creating, reveal and copy the signing secret
 * 5. Add this secret to your production environment variables
 * 
 * Events to enable:
 * - checkout.session.completed
 * - payment_intent.succeeded
 * - payment_intent.payment_failed
 */

console.log('This is a guidance file for webhook setup. No action required.');
console.log('Follow the instructions in the file comments to set up your webhooks.'); 
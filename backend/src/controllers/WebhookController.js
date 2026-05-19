const connectDb = require('../config/database');

module.exports = {
    async handle(req, res) {
        const sig = req.headers['stripe-signature'];
        const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!process.env.STRIPE_SECRET_KEY || !endpointSecret) {
            return res.status(500).send('Webhook Stripe sem configuracao.');
        }

        let event;

        try {
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        } catch (err) {
            console.error('[Webhook Error]', err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        try {
            const db = await connectDb();

            if (event.type === 'checkout.session.completed') {
                const session = event.data.object;
                const userId = session.client_reference_id;

                if (userId) {
                    await db.run('UPDATE users SET plan = ? WHERE id = ?', ['pro', userId]);
                }
            }

            if (['customer.subscription.deleted', 'customer.subscription.paused'].includes(event.type)) {
                const subscription = event.data.object;
                const userId = subscription.metadata?.user_id || subscription.client_reference_id;

                if (userId) {
                    await db.run('UPDATE users SET plan = ? WHERE id = ?', ['free', userId]);
                }
            }
        } catch (dbError) {
            console.error('[Webhook DB Error]', dbError);
            return res.status(500).json({ error: 'Erro ao processar webhook.' });
        }

        return res.json({ received: true });
    }
};

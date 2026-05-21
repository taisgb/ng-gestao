module.exports = {
    async create(req, res) {
        try {
            if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRO_PRICE_ID || !process.env.FRONTEND_URL) {
                return res.status(500).json({ error: 'Configuração do Stripe incompleta.' });
            }

            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            const userId = req.userId;

            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: process.env.STRIPE_PRO_PRICE_ID,
                        quantity: 1,
                    },
                ],
                mode: 'subscription',
                success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
                cancel_url: `${process.env.FRONTEND_URL}/upgrade?canceled=true`,
                client_reference_id: userId,
                metadata: { user_id: String(userId) },
                subscription_data: {
                    metadata: { user_id: String(userId) },
                },
            });

            return res.json({ url: session.url });
        } catch (error) {
            console.error('[CheckoutController.create]', error);
            return res.status(500).json({ error: 'Erro ao conectar com o gateway de pagamento.' });
        }
    }
};

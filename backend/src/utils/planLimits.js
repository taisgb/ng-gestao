const connectDb = require('../config/database');

async function checkLimit(userId) {
    const db = await connectDb();
    
    // Busca o plano do usuário
    const user = await db.get('SELECT plan FROM users WHERE id = ?', [userId]);
    
    if (user.plan === 'free') {
        const count = await db.get('SELECT COUNT(*) as total FROM clients WHERE user_id = ? AND archived = 0', [userId]);
        
        if (count.total >= 3) {
            return { allowed: false, message: 'Limite de 3 clientes atingido no plano Free. Faça o upgrade!' };
        }
    }
    
    return { allowed: true };
}

module.exports = checkLimit;
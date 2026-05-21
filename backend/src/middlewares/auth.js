const jwt = require('jsonwebtoken');

module.exports = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const secret = process.env.JWT_SECRET || process.env.APP_SECRET;

    if (!secret) {
        return res.status(500).json({ error: 'Configuração de autenticação ausente.' });
    }

    // 1. Verifica se o header de autorização existe
    if (!authHeader) {
        return res.status(401).json({ error: 'Token não fornecido.' });
    }

    // 2. O header vem no formato "Bearer TOKEN", então dividimos para pegar só o código
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Formato de token inválido.' });
    }

    try {
        // 3. Verifica se o token é válido
        const decoded = jwt.verify(token, secret);

        // 4. Se for válido, guarda o ID do usuário na requisição para uso nos controllers
        req.userId = decoded.id;

        return next(); // Segue para a rota pretendida
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido.' });
    }
};

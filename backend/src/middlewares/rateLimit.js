const buckets = new Map();

function getClientKey(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    const ip = Array.isArray(forwardedFor) ? forwardedFor[0] : (forwardedFor || req.ip || req.socket.remoteAddress || 'unknown');
    return String(ip).split(',')[0].trim();
}

function cleanup(now) {
    for (const [key, value] of buckets.entries()) {
        if (value.resetAt <= now) buckets.delete(key);
    }
}

module.exports = function rateLimit({ windowMs = 60 * 1000, max = 60, message = 'Muitas tentativas. Tente novamente em instantes.' } = {}) {
    return (req, res, next) => {
        const now = Date.now();
        cleanup(now);

        const key = `${req.method}:${req.path}:${getClientKey(req)}`;
        const current = buckets.get(key);

        if (!current || current.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        current.count += 1;
        const retryAfter = Math.ceil((current.resetAt - now) / 1000);

        res.setHeader('Retry-After', retryAfter);

        if (current.count > max) {
            return res.status(429).json({ error: message });
        }

        return next();
    };
};

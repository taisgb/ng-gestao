function isNonEmptyString(value, max = 255) {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isEmail(email) {
    const normalized = normalizeEmail(email);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 255;
}

function isDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toMoney(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function isNonNegativeMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0;
}

module.exports = {
    isDate,
    isEmail,
    isNonEmptyString,
    isNonNegativeMoney,
    normalizeEmail,
    toMoney
};

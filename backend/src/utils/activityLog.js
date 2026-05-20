async function logActivity(db, userId, action, entityType, entityId = null, metadata = {}) {
    if (!db || !action || !entityType) return;

    try {
        await db.run(
            `
            INSERT INTO activity_logs (user_id, action, entity_type, entity_id, metadata)
            VALUES (?, ?, ?, ?, ?)
            `,
            [
                userId || null,
                action,
                entityType,
                entityId || null,
                JSON.stringify(metadata || {})
            ]
        );
    } catch (error) {
        console.error('[activityLog]', error);
    }
}

module.exports = { logActivity };

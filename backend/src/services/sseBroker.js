// ============================================================
// SSE Broker — Shared Registry for Server-Sent Events clients
// ============================================================
const logger = require('../utils/logger');

// Map<connectionId, { res, userId, role, connectedAt, lastSeenAt }>
const connections = new Map();
let heartbeatTimer = null;

function startHeartbeat() {
    if (heartbeatTimer) return;

    heartbeatTimer = setInterval(() => {
        const now = Date.now();

        for (const [connectionId, client] of connections.entries()) {
            try {
                client.res.write(': heartbeat\n\n');
                client.lastSeenAt = now;
            } catch (_err) {
                cleanupConnection(connectionId);
            }
        }
    }, 10000);
}

function stopHeartbeatIfIdle() {
    if (connections.size === 0 && heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

function registerConnection({ userId, role, res }) {
    const connectionId = `${userId}:${Date.now()}:${Math.round(Math.random() * 1e6)}`;

    connections.set(connectionId, {
        res,
        userId: userId?.toString() || null,
        role,
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
    });

    startHeartbeat();
    return connectionId;
}

function cleanupConnection(connectionId) {
    const client = connections.get(connectionId);
    if (!client) return;

    try {
        client.res.end();
    } catch (_err) {
        // No-op
    }

    connections.delete(connectionId);
    stopHeartbeatIfIdle();
}

function canReceive(client, event) {
    const payload = event?.payload || {};

    // Targeted user check
    if (Array.isArray(payload.usersVisibleTo) && payload.usersVisibleTo.length > 0) {
        return payload.usersVisibleTo.map(String).includes(String(client.userId));
    }

    // Role check (default allow if not provided)
    if (Array.isArray(payload.rolesVisibleTo) && payload.rolesVisibleTo.length > 0) {
        return payload.rolesVisibleTo.includes(client.role);
    }

    return true;
}

function broadcastEvent(event) {
    let delivered = 0;

    for (const [connectionId, client] of connections.entries()) {
        if (!canReceive(client, event)) continue;

        try {
            client.res.write(`data: ${JSON.stringify(event)}\n\n`);
            delivered += 1;
            client.lastSeenAt = Date.now();
        } catch (_err) {
            cleanupConnection(connectionId);
        }
    }

    return delivered;
}

function getConnectionStats() {
    const byUser = {};

    for (const client of connections.values()) {
        if (!client.userId) continue;
        byUser[client.userId] = (byUser[client.userId] || 0) + 1;
    }

    return {
        total_connections: connections.size,
        unique_users: Object.keys(byUser).length,
        by_user: byUser,
    };
}

function closeAllConnections() {
    for (const connectionId of connections.keys()) {
        cleanupConnection(connectionId);
    }
}

module.exports = {
    registerConnection,
    cleanupConnection,
    broadcastEvent,
    getConnectionStats,
    closeAllConnections,
};

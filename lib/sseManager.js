// SSE client management
const sseClients = new Set();

// SSE broadcast function.
// If buildForRole(data, role) is given, each client gets its own payload
// (e.g. so hidden data isn't shipped to non-admin clients); otherwise every
// client gets the same `data`.
function broadcastSSE(eventType, data, buildForRole) {
  sseClients.forEach(client => {
    const payload = typeof buildForRole === 'function' ? buildForRole(data, client.role) : data;
    const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
    try {
      client.res.write(message);
    } catch (err) {
      // Client disconnected, remove from client set to prevent repeated errors
      sseClients.delete(client);
      console.error('Error writing to SSE client:', err);
    }
  });
}

function addClient(res, role) {
  sseClients.add({ res, role });
}

function removeClient(res) {
  for (const client of sseClients) {
    if (client.res === res) {
      sseClients.delete(client);
      break;
    }
  }
}

module.exports = { broadcastSSE, addClient, removeClient };

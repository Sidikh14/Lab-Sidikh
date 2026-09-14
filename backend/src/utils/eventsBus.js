// eventsBus.js — pub/sub en mémoire pour diffuser des événements en temps
// réel aux clients connectés via Server-Sent Events (SSE).
//
// ⚠️ Fonctionne pour UNE SEULE instance Node (ce qui est le cas actuel sur
// Render, plan standard sans scaling horizontal). Si l'app tourne un jour
// sur plusieurs instances en parallèle, un client connecté à l'instance A
// ne recevra pas les événements émis depuis l'instance B — il faudra alors
// remplacer ce module par un pub/sub partagé (ex : Redis).

const clientsByMerchant = new Map(); // merchantId -> Set(res)

function subscribe(merchantId, res) {
  if (!clientsByMerchant.has(merchantId)) clientsByMerchant.set(merchantId, new Set());
  clientsByMerchant.get(merchantId).add(res);
}

function unsubscribe(merchantId, res) {
  clientsByMerchant.get(merchantId)?.delete(res);
}

// eventName : ex. 'order:created', 'activity:created'
// data : sérialisable en JSON, envoyé tel quel au client
function broadcast(merchantId, eventName, data) {
  const clients = clientsByMerchant.get(merchantId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((res) => {
    try {
      res.write(payload);
    } catch (err) {
      // Connexion déjà fermée côté client — sera nettoyée par le 'close'
      // du endpoint SSE, rien à faire ici.
    }
  });
}

module.exports = { subscribe, unsubscribe, broadcast };

// eventsBus.js — pub/sub en mémoire pour diffuser des événements en temps
// réel aux clients connectés via Server-Sent Events (SSE).
//
// ⚠️ Fonctionne pour UNE SEULE instance Node (ce qui est le cas actuel sur
// Render, plan standard sans scaling horizontal). Si l'app tourne un jour
// sur plusieurs instances en parallèle, un client connecté à l'instance A
// ne recevra pas les événements émis depuis l'instance B — il faudra alors
// remplacer ce module par un pub/sub partagé (ex : Redis).

const clientsByMerchant = new Map(); // merchantId -> Set(res)

// utilisateur : { id, role } de la personne connectée, mémorisé pour pouvoir cibler les diffusions.
function subscribe(merchantId, res, utilisateur = null) {
  res.utilisateurSSE = utilisateur;
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

// Diffusion ciblée : seuls les clients connectés dont le rôle (roles) ou l'identifiant (userIds) correspond
// reçoivent l'événement. Sert aux alertes : un caissier ne doit jamais recevoir, même sans l'afficher,
// une alerte réservée au manager (ex. écart de clôture de caisse). L'identité est transmise à subscribe() par la
// route SSE (lue dans le jeton) ; un client dont l'identité est inconnue ne reçoit rien (par sécurité).
function broadcastCible(merchantId, eventName, data, { roles = [], userIds = null } = {}) {
  const clients = clientsByMerchant.get(merchantId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const ids = userIds ? userIds.map(String) : null;
  clients.forEach((res) => {
    const utilisateur = res.utilisateurSSE;
    if (!utilisateur) return;
    const rolesDuClient = utilisateur.roles || [utilisateur.role];
    const autorise = ids ? ids.includes(String(utilisateur.id)) : rolesDuClient.some((r) => roles.includes(r));
    if (!autorise) return;
    try {
      res.write(payload);
    } catch (err) {
      // Connexion déjà fermée côté client : nettoyée par le 'close' du endpoint SSE.
    }
  });
}

module.exports = { subscribe, unsubscribe, broadcast, broadcastCible };

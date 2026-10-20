// Service worker mínimo: existe só para o Chrome/Edge oferecerem "Instalar
// app". Não guarda nada em cache de propósito — toda requisição vai direto
// pra rede, então publicar no Lovable continua chegando na hora pra todo
// mundo, sem versão velha presa no computador.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // sem respondWith: o navegador segue o caminho normal da rede
});

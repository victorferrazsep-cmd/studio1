const APP_ROOT = new URL("./", self.location).href;
const APP_URL = new URL("index.html", APP_ROOT).href;
const APP_ICON = new URL("Assets/app-icon-192.png", APP_ROOT).href;

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    console.error("Push payload is not valid JSON.", error);
  }

  event.waitUntil((async () => {
    await self.registration.showNotification(payload.title || "Studio Sa Lopes", {
      body: payload.body || "Você tem uma nova notificação do Studio.",
      icon: APP_ICON,
      badge: APP_ICON,
      tag: payload.tag || "studio-notification",
      data: { url: payload.url || APP_URL },
    });

    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach(client => client.postMessage({ type: "studio-push-received" }));
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url || APP_URL, APP_ROOT);
  const targetUrl = requestedUrl.origin === new URL(APP_ROOT).origin &&
      requestedUrl.pathname.startsWith(new URL(APP_ROOT).pathname)
    ? requestedUrl
    : new URL(APP_URL);

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin === targetUrl.origin && clientUrl.pathname.startsWith(new URL(APP_ROOT).pathname)) {
        await client.navigate(targetUrl.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl.href);
  })());
});

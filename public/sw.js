const CACHE_NAME = 'notes-pwa-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/about.html',
    '/manifest.json',
    '/style.css',
    '/client.js',
    '/android-chrome-192x192.png',
    '/android-chrome-512x512.png',
    '/favicon.ico',
    '/favicon-16x16.png',
    '/favicon-32x32.png',
    '/apple-touch-icon.png'
];

// Установка: кэширование статических ресурсов (App Shell)
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Активация: очистка старых кэшей
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        )).then(() => self.clients.claim())
    );
});

// Стратегия кэширования:
// - HTML: Network First, затем Cache
// - Статика: Cache First
// - API/Socket не кэшируются (пропускаем)
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Не перехватываем запросы к сокетам и push-сервисам
    if (url.pathname.startsWith('/socket.io') ||
        url.pathname.startsWith('/subscribe') ||
        url.pathname.startsWith('/unsubscribe') ||
        url.pathname.startsWith('/vapidPublicKey') ||
        url.pathname.startsWith('/snooze')) {
        return;
    }

    // Для HTML страниц используем Network First
    if (event.request.mode === 'navigate' ||
        (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Кэшируем свежую версию
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Для остальных статических ресурсов - Cache First
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => cachedResponse || fetch(event.request))
    );
});

// Push-уведомления
self.addEventListener('push', event => {
    console.log('📨 [SW] Push event received', event);
    let data = { title: 'Новое уведомление', body: 'Что-то произошло' };

    if (event.data) {
        try {
            data = event.data.json();
            console.log('[SW] Push data (JSON):', data);
        } catch (e) {
            data.body = event.data.text();
            console.log('[SW] Push data (text):', data.body);
        }
    } else {
        console.log('[SW] No data in push event');
    }

    const options = {
        body: data.body,
        icon: data.icon || '/android-chrome-192x192.png',
        badge: data.badge || '/favicon-32x32.png',
        vibrate: [200, 100, 200],
        data: data.data || {},
        actions: data.actions || []
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
            .then(() => console.log('[SW] ✅ Notification shown successfully'))
            .catch(err => console.error('[SW] ❌ Failed to show notification:', err))
    );
});

// Обработка клика по уведомлению или действиям
self.addEventListener('notificationclick', event => {
    event.notification.close();

    const action = event.action;
    const data = event.notification.data;

    if (action === 'snooze') {
        // Отправляем запрос на сервер для переноса напоминания
        const taskId = data.taskId;
        fetch('/snooze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, snoozeMinutes: 5 })
        }).catch(err => console.error('Snooze request failed', err));

        // Показываем уведомление о переносе
        self.registration.showNotification('Напоминание отложено', {
            body: 'Мы напомним через 5 минут',
            icon: '/android-chrome-192x192.png',
            vibrate: [100, 50, 100]
        });
    } else {
        // Открываем главную страницу
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then(windowClients => {
                for (let client of windowClients) {
                    if (client.url.includes('/') && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow('/');
                }
            })
        );
    }
});
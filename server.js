const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Для HTTPS в продакшене нужно использовать https.createServer с сертификатами
// В разработке можно оставить HTTP (Service Worker будет работать на localhost)

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище подписок push (в реальном проекте используйте БД)
let subscriptions = {};
// Хранилище активных таймеров напоминаний
const activeReminders = new Map();

// Генерация VAPID ключей (выполните один раз и сохраните)
// Для генерации: const vapidKeys = webpush.generateVAPIDKeys(); console.log(vapidKeys);
// Вставьте свои ключи ниже
//
// const vapidKeys = webpush.generateVAPIDKeys();
// console.log(vapidKeys);

const vapidKeys = {
    publicKey: 'BKtLedRituvWjc8sO0I5MSkW9JyZ-eSyJhSMFGp3UQxXKC4aZYhPdYQ4mI4BxJwNFD-3yfzoS7XbGfQTeet39MA',
    privateKey: '5IirAf-SjLc7mIB_XiEPTYU2IA-H7YOxX5_KMyf8URM'
};

webpush.setVapidDetails(
    'mailto:example@yourdomain.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// Отправка VAPID публичного ключа клиенту
app.get('/vapidPublicKey', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});
app.post('/subscribe', (req, res) => {
    const subscription = req.body;
    const id = subscription.endpoint;
    subscriptions[id] = subscription;
    console.log(`✅ New subscription added. Total active: ${Object.keys(subscriptions).length}`);
    res.status(201).json({});
});

app.post('/unsubscribe', (req, res) => {
    const subscription = req.body;
    const id = subscription.endpoint;
    delete subscriptions[id];
    console.log(`❌ Subscription removed. Total active: ${Object.keys(subscriptions).length}`);
    res.status(200).json({});
});

// Эндпоинт для переноса напоминания (действие "Отложить")
app.post('/snooze', (req, res) => {
    const { taskId, snoozeMinutes } = req.body;
    // Здесь должна быть логика обновления reminder в хранилище задач
    // Но для упрощения просто планируем новое уведомление
    const newReminderTime = Date.now() + snoozeMinutes * 60 * 1000;
    console.log(`Task ${taskId} snoozed to ${new Date(newReminderTime)}`);
    // Предположим, что мы храним задачи в памяти сервера (для реального приложения нужна синхронизация)
    // В этом примере мы не реализуем полноценное обновление localStorage на сервере
    // Вместо этого просто планируем уведомление
    scheduleReminder(taskId, 'Задача отложена', newReminderTime);
    res.json({ success: true });
});

// Функция планирования уведомления
function scheduleReminder(taskId, taskText, reminderTime) {
    const now = Date.now();
    const delay = reminderTime - now;
    console.log(`⏲️ Scheduling reminder for task "${taskId}" in ${Math.round(delay / 1000)} seconds (at ${new Date(reminderTime).toLocaleString()})`);

    if (delay <= 0) {
        console.log(`⚠️ Reminder time already passed, not scheduling`);
        return;
    }

    if (activeReminders.has(taskId)) {
        clearTimeout(activeReminders.get(taskId));
    }

    const timeout = setTimeout(() => {
        console.log(`🔔 Timeout triggered for task ${taskId}. Active subscriptions: ${Object.keys(subscriptions).length}`);
        if (Object.keys(subscriptions).length === 0) {
            console.log(`❌ No active subscriptions, cannot send push notification.`);
            return;
        }

        const payload = JSON.stringify({
            title: 'Напоминание',
            body: taskText,
            icon: '/android-chrome-192x192.png',
            badge: '/favicon-32x32.png',
            data: { taskId, url: '/' },
            actions: [
                { action: 'snooze', title: 'Отложить на 5 мин' },
                { action: 'close', title: 'Закрыть' }
            ]
        });

        Object.entries(subscriptions).forEach(([endpoint, sub]) => {
            webpush.sendNotification(sub, payload)
                .then(response => {
                    console.log(`✅ Push sent to ${endpoint.slice(0, 50)}... Status: ${response.statusCode}`);
                })
                .catch(err => {
                    console.error(`❌ Push failed for ${endpoint.slice(0, 50)}...`, err.statusCode, err.body);
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        delete subscriptions[endpoint];
                        console.log(`🗑️ Removed invalid subscription. Remaining: ${Object.keys(subscriptions).length}`);
                    }
                });
        });

        activeReminders.delete(taskId);
    }, delay);

    activeReminders.set(taskId, timeout);
}

// Socket.IO обработка
io.on('connection', (socket) => {
    console.log('Client connected');

    socket.on('newTask', (task) => {
        console.log('New task received:', task);
        io.emit('taskAdded', task);
        if (task.reminder && task.reminder > Date.now()) {
            console.log(`📅 Task has reminder at ${new Date(task.reminder).toLocaleString()}`);
            scheduleReminder(task.id, task.text, task.reminder);
        } else if (task.reminder) {
            console.log(`⏰ Task reminder is in the past (${new Date(task.reminder).toLocaleString()}), ignoring`);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
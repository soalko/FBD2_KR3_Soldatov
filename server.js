const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();

// Определяем, использовать ли HTTPS
const useHttps = process.env.USE_HTTPS === 'true';
let server;

if (useHttps) {
    try {
        const options = {
            key: fs.readFileSync(path.join(__dirname, 'localhost.key')),
            cert: fs.readFileSync(path.join(__dirname, 'localhost.crt'))
        };
        server = https.createServer(options, app);
        console.log('HTTPS server will be used');
    } catch (err) {
        console.error('Failed to read SSL certificates. Falling back to HTTP.', err.message);
        server = http.createServer(app);
    }
} else {
    server = http.createServer(app);
    console.log('HTTP server will be used (USE_HTTPS=true for HTTPS)');
}

const io = socketIo(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище подписок и таймеров
let subscriptions = {};
const activeReminders = new Map();

// ===== VAPID ключи (замените на свои) =====
const vapidKeys = {
    publicKey: 'BELx42JK6dBeBu23MInlntxRlDelsBRgz1Jpgl-ycu_Jk8FahrFvFmtnDgcgLjsA5-BDH-JxAWMPgc-36Ul5tlo',
    privateKey: 'Xej9qYqIbJhN1FpG2OjZEP90OJT4WRhCtC7x8ybIt_k'
};

webpush.setVapidDetails(
    'mailto:example@yourdomain.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// Отдача публичного ключа
app.get('/vapidPublicKey', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});

// Эндпоинт для получения количества подписок (для отладки)
app.get('/subscription-count', (req, res) => {
    res.json({ count: Object.keys(subscriptions).length });
});

// Подписка
app.post('/subscribe', (req, res) => {
    const subscription = req.body;
    const id = subscription.endpoint;
    subscriptions[id] = subscription;
    fs.writeFileSync('subscriptions.json', JSON.stringify(subscriptions, null, 2));
    console.log(`✅ New subscription added. Total active: ${Object.keys(subscriptions).length}`);
    res.status(201).json({});
});

// Отписка
app.post('/unsubscribe', (req, res) => {
    const subscription = req.body;
    const id = subscription.endpoint;
    delete subscriptions[id];
    fs.writeFileSync('subscriptions.json', JSON.stringify(subscriptions, null, 2));
    console.log(`❌ Subscription removed. Total active: ${Object.keys(subscriptions).length}`);
    res.status(200).json({});
});

// Перенос напоминания
app.post('/snooze', (req, res) => {
    const { taskId, snoozeMinutes } = req.body;
    const newReminderTime = Date.now() + snoozeMinutes * 60 * 1000;
    console.log(`⏰ Task ${taskId} snoozed to ${new Date(newReminderTime)}`);
    scheduleReminder(taskId, 'Задача отложена', newReminderTime);
    res.json({ success: true });
});

// Планирование напоминания
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
    const protocol = useHttps ? 'https' : 'http';
    console.log(`Server running on ${protocol}://localhost:${PORT}`);
});
// Инициализация приложения после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    // Регистрация Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => {
                console.log('SW registered:', reg.scope);
                // Инициализация push-подписки после регистрации SW
                initPushNotifications(reg);
            })
            .catch(err => console.error('SW registration failed:', err));
    }

    // Socket.IO подключение
    const socket = io();

    // Хранилище задач в памяти (синхронизировано с localStorage)
    let tasks = loadTasksFromStorage();

    // DOM элементы
    const taskForm = document.getElementById('task-form');
    const taskText = document.getElementById('task-text');
    const enableReminder = document.getElementById('enable-reminder');
    const reminderTime = document.getElementById('reminder-time');
    const tasksContainer = document.getElementById('tasks-container');

    // Активация/деактивация поля выбора времени
    enableReminder.addEventListener('change', () => {
        reminderTime.disabled = !enableReminder.checked;
        if (enableReminder.checked) {
            // Устанавливаем минимальное время — текущее + 1 минута (в локальном часовом поясе)
            const now = new Date();
            now.setMinutes(now.getMinutes() + 1);
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            reminderTime.value = `${year}-${month}-${day}T${hours}:${minutes}`;
        }
    });

    // Отправка новой задачи
    taskForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = taskText.value.trim();
        if (!text) return;

        const task = {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            text: text,
            reminder: enableReminder.checked ? new Date(reminderTime.value).getTime() : null,
            createdAt: Date.now()
        };

        // Добавляем в локальное хранилище и обновляем UI
        addTask(task);
        // Отправляем через Socket.IO
        socket.emit('newTask', task);

        // Сбрасываем форму
        taskText.value = '';
        enableReminder.checked = false;
        reminderTime.disabled = true;
    });

    // Обработка получения новой задачи от сервера (от других клиентов)
    socket.on('taskAdded', (task) => {
        // Проверяем, нет ли уже такой задачи (по id)
        if (!tasks.some(t => t.id === task.id)) {
            addTask(task);
            showToast(`Новая заметка: ${task.text}`);
        }
    });

    // Функция добавления задачи в UI и localStorage
    function addTask(task) {
        tasks.push(task);
        saveTasksToStorage();
        renderTasks();
    }

    // Рендер списка задач
    function renderTasks() {
        tasksContainer.innerHTML = '';
        tasks.sort((a, b) => b.createdAt - a.createdAt).forEach(task => {
            const li = document.createElement('li');
            li.innerHTML = `
        <span class="task-text">${escapeHtml(task.text)}</span>
        ${task.reminder ? `<span class="task-reminder">⏰ ${new Date(task.reminder).toLocaleString()}</span>` : ''}
      `;
            tasksContainer.appendChild(li);
        });
    }

    // Загрузка задач из localStorage
    function loadTasksFromStorage() {
        const stored = localStorage.getItem('tasks');
        return stored ? JSON.parse(stored) : [];
    }

    // Сохранение в localStorage
    function saveTasksToStorage() {
        localStorage.setItem('tasks', JSON.stringify(tasks));
    }

    // Простое экранирование HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Всплывающее уведомление (имитация toast)
    function showToast(message) {
        const toast = document.createElement('div');
        toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #333;
      color: white;
      padding: 12px 24px;
      border-radius: 30px;
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      z-index: 1000;
      animation: fadeInOut 3s forwards;
    `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // ========== Push Notifications ==========
    let swRegistration = null;
    const subscribeBtn = document.getElementById('subscribe-push');
    const unsubscribeBtn = document.getElementById('unsubscribe-push');
    const statusP = document.getElementById('push-status');

    async function initPushNotifications(reg) {
        swRegistration = reg;
        // Проверяем, подписан ли уже пользователь
        const subscription = await reg.pushManager.getSubscription();
        updateUIForPushState(!!subscription);

        subscribeBtn.addEventListener('click', subscribeToPush);
        unsubscribeBtn.addEventListener('click', unsubscribeFromPush);
    }

    function updateUIForPushState(isSubscribed) {
        if (isSubscribed) {
            subscribeBtn.style.display = 'none';
            unsubscribeBtn.style.display = 'inline-block';
            statusP.textContent = 'Уведомления включены';
        } else {
            subscribeBtn.style.display = 'inline-block';
            unsubscribeBtn.style.display = 'none';
            statusP.textContent = 'Уведомления отключены';
        }
    }

    async function subscribeToPush() {
        try {
            // Запрашиваем разрешение
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                throw new Error('Permission not granted');
            }

            // Получаем публичный ключ с сервера
            const response = await fetch('/vapidPublicKey');
            const { publicKey } = await response.json();

            const subscription = await swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });

            // Отправляем подписку на сервер
            await fetch('/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(subscription)
            });

            updateUIForPushState(true);
        } catch (error) {
            console.error('Failed to subscribe:', error);
            statusP.textContent = 'Не удалось включить уведомления';
        }
    }

    async function unsubscribeFromPush() {
        try {
            const subscription = await swRegistration.pushManager.getSubscription();
            if (subscription) {
                await subscription.unsubscribe();
                await fetch('/unsubscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(subscription)
                });
            }
            updateUIForPushState(false);
        } catch (error) {
            console.error('Failed to unsubscribe:', error);
        }
    }

    // Вспомогательная функция для конвертации ключа
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    // Добавляем стиль для анимации toast
    const style = document.createElement('style');
    style.textContent = `
    @keyframes fadeInOut {
      0% { opacity: 0; transform: translate(-50%, 20px); }
      10% { opacity: 1; transform: translate(-50%, 0); }
      90% { opacity: 1; transform: translate(-50%, 0); }
      100% { opacity: 0; transform: translate(-50%, -20px); }
    }
  `;
    document.head.appendChild(style);

    // Первоначальный рендер
    renderTasks();
});
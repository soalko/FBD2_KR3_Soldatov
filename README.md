# Контрольная работа 3 - Приложение для создания заметок

> Выполнил: Солдатов Александр, ЭФБО-04-24

## Может работать как онлайн, так и в оффлайн режиме, доступна возможность загрузки приложения.

Установка и запуск:
```
npm init -y                                                          
npm install express socket.io web-push body-parser
```

Для открытия http://
```
npm start
```

Для генерации VAPID ключей:
```
node -e "const webpush = require('web-push'); console.log(webpush.generateVAPIDKeys());"
```

Для создания сертификата https:
```
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \                          
  -keyout localhost.key \
  -out localhost.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

Для открытия https://
```
npm run start:https
```
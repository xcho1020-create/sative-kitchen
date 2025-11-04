# Sative Kitchen - Delivery Management App

простое веб-приложение для управления поставками/заготовками

## установка

### 1. заливаем на github

1. открой https://github.com/xcho1020-create/sative-kitchen
2. нажми **Add file** → **Create new file**
3. имя файла: `index.html`
4. скопируй содержимое из index.html
5. нажми **commit new file**

повтори для остальных:
- config.js
- app.js
- styles.css

### 2. деплоим на vercel

1. зайди на https://vercel.com
2. нажми **Add New Project**
3. выбери **Import Git Repository**
4. найди `xcho1020-create/sative-kitchen`
5. нажми **Import**
6. нажми **Deploy**

через 1-2 минуты приложение будет живо на vercel

## пароли

- **мама**: 1234
- **менеджер**: 5678
- **админ**: 9999

меняй в файле config.js в переменной AUTH

## api

приложение подключается к google apps script api:
```
https://script.google.com/macros/s/AKfycbw8qyk5QShIHCi2dm3sHZcAQizNH2QGEAvkKI6lYO2ZNb0f3NZUaLTlQxjfyVzGRHMbqg/exec
```

этот url уже вставлен в config.js

## функционал v1

- **мама**: создание поставок, редактирование
- **менеджер**: просмотр поставок (read-only)
- **админ**: управление ценами продуктов, логи действий

## что дальше (v2)

- калькулятор рецептур
- экспорт в pdf
- интеграция с telegram
- мобильное приложение (PWA)
- больше аналитики

---

вопросы? пиши

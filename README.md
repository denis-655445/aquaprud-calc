# Aquaprud — калькулятор кошторису ставка (Telegram Mini App)

Етап A2: застосунок працює на **тестовому каталозі** (`data/catalog.sample.js`), без бекенду.
Хостинг — GitHub Pages, тому MacBook для роботи застосунку вмикати не потрібно.

## Структура

```
core/            ядро: розрахунок (calc.js) і текст кошторису (format.js)
miniapp/         сам застосунок: index.html, css/, js/
data/            тестовий каталог
tests/           тести ядра: tests.html (браузер), run-node.js (Node.js)
```

## Перевірка на MacBook без інтернету й сервера

Відкрийте подвійним кліком `miniapp/index.html` — застосунок запрацює в браузері.
Тести ядра: `tests/tests.html` — має бути «Усі … тестів пройдено».

## Публікація

1. GitHub → **New repository** → назва `aquaprud-calc`, **Public** → Create.
2. **uploading an existing file** → перетягніть вміст папки (core, miniapp, data, tests, README.md) → **Commit changes**.
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, папка `/ (root)` → Save.
4. Через 1–2 хв застосунок доступний за адресою
   `https://<ваш-логін>.github.io/aquaprud-calc/miniapp/`

## Підключення до бота

BotFather → `/mybots` → `@aquaprud_bot` → **Bot Settings → Menu Button** → надіслати адресу з п. 4 → назва кнопки `Калькулятор`.

## Оновлення

1. У репозиторії: **Add file → Upload files** → перетягніть вміст нової версії (ті самі папки) → **Commit changes**. Змінені файли замінюються автоматично.
2. GitHub Pages оновлюється за 1–2 хв; браузер і Telegram можуть показувати стару версію ще до ~10 хв.
3. Якщо в Telegram довго лишається стара версія — у BotFather змініть адресу Menu Button, додавши в кінці `?v=2` (далі `?v=3` тощо).

Розробнику: після зміни файлів збільшуйте `?v=N` у `miniapp/index.html` і `CONFIG.APP_VERSION`.

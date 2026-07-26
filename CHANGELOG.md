# Changelog

## v0.1.1 — 2026-07-26

### Discord RPC снова показывает работу, а не «Idle»

- **Активность определяется по вводу в ОС, а не по фокусу окна Luxor
  (главная причина «RPC не работает»).** Драйвер считал работой только те
  моменты, когда сфокусировано само окно Luxor. Luxor — кокпит: печатают в
  сторонней IDE, терминале или окне ИИ-агента, а само приложение часто висит в
  трее, поэтому почти каждый сэмпл классифицировался как `idle`, а idle-контекст
  заменяет всю карусель одним кадром «Idle · Taking a break». Теперь авторитет —
  счётчик простоя ОС (`GetLastInputInfo` / `CGEventSourceSecondsSinceLastEvent`),
  а фокус окна остался запасным вариантом для платформ без такого счётчика
  (Linux). Побочный эффект: определение ИИ-агента по заголовку активного окна
  (`aiAgentFromTitle` ищет Cursor/Claude/Copilot/…) раньше было недостижимо —
  оно требовало фокуса на Luxor, но искало заголовки *других* приложений; кадр
  «Pair programming with …» теперь действительно появляется. Той же ошибкой вся
  локальная статистика писалась как idle-время.
- **Blacklist приватности больше не отключается маскингом.** Паттерны
  (`*nda*`, `*work*`) проверялись уже *после* маскинга, то есть по строкам
  «🔒 private» / «🔒 Private Project». У пользователей с включёнными сразу двумя
  переключателями blacklist не защищал ничего, и присутствие транслировалось с
  NDA-ветки. Проверка перенесена на исходные имена (маскинг применяется после).
- **Без открытого проекта Discord больше не пишет «Working on —».** Кадр
  проекта строится только когда проект действительно есть; иначе показывается
  общий always-on кадр «Working in Luxor».
- **Тесты:** 9 тестов на классификацию активности (`isUserActive` /
  `classifyActivity`), 17 тестов слоя решений движка (`DiscordEngine`:
  выключатель, blacklist, маскинг, idle-кадр, ротация карусели, приоритетная
  очередь, гейтинг heartbeat) и 2 теста на кадр без проекта. Слой решений
  вынесен в `resolve_presence` / `heartbeat_context`, чтобы тесты не трогали
  реальный Discord-сокет.

### UI/UX файлов и сворачивание в трей

- **Файловый менеджер — новая шапка:** панель разбита на понятные ярусы —
  «личность» проекта (иконка папки в акцентном квадрате, имя, путь и счётчик
  элементов) с основной кнопкой «Открыть в <IDE>» справа; широкая строка поиска;
  отдельный ряд с чипами-фильтрами (Все/Код/Изображения/Конфиги/Доки) слева и
  сгруппированными кнопками действий (новый файл/папка · скрытые/свернуть/
  обновить) справа. Размер файла показывается справа в строке при наведении.
- **Локализация Files:** строки «N элем.», «N выбрано», «Копировать для агента»,
  «+ содержимое», «Пути», «Очистить», чипы фильтров и плейсхолдер поиска теперь
  переводятся на русский (раньше часть оставалась на английском).
- **Сворачивание в трей по крестику:** кнопка закрытия окна (X) сворачивает
  Luxor в трей вместо выхода (поведение по умолчанию; переключается в
  Настройки → Интерфейс → «Работать в фоне»). Подсказка у крестика теперь
  показывает «Свернуть в трей», когда режим включён.
- **Первый раз — подсказка:** при первом сворачивании в трей показывается
  одноразовое системное уведомление («Luxor свёрнут в трей»), чтобы пользователь
  понимал, что приложение продолжает работать, а терминалы и агенты активны.

### Аудит-фиксы телеметрии / Discord RPC

Исправления по результатам аудита (`docs/` + отчёт аудита):

- **Ретеншн ↔ чтение (blocker):** тепловая карта на 365 дней, streak и
  Year-in-Review больше не «обнуляются» после 90 дней — агрегаты дочитывают
  `daily_rollups`, в которые сворачиваются сырые интервалы. Fold+delete теперь
  атомарны (одна транзакция) — нет двойного счёта при сбое между шагами.
- **Приватность:** добавлены тумблер «Собирать локальную статистику» и
  **Paranoid Mode** (план 5.1/5.5) — при выключении фоновый сбор и Discord RPC
  полностью останавливаются. Раньше драйвер писал в БД безусловно.
- **Discord:** критический статус (Priority 1) теперь перебивает карусель
  мгновенно (обход rate-limit через `force`); приватная ветка маскируется при
  включённом маскинге; `connect()` валидирует ответ на handshake; `read_frame`
  ограничивает размер кадра (64 КБ); blacklist стал настоящим glob (`*work*`);
  anti-flicker hash учитывает подписи изображений.
- **Телеметрия:** `export_json` теперь выгружает всю сырую историю (интервалы,
  git-события, rollups, проекты, ачивки), а не снапшот дашборда; длительности в
  `agent_breakdown`/`project_log` клампятся к окну.
- **Фронтенд:** активная git-ветка прокидывается в телеметрию и Discord;
  счётчик сессии не сбрасывается на одиночном idle-тике (порог 30 мин).
- **Git-аналитика:** при коммите теперь записываются добавленные/удалённые
  строки (через `gitCommitStats`) и ветка — наполняется Commit Impact Score и
  «Изменено строк» (план 1.2/3.1); checkout ветки пишет событие `branch_switch`.
- **Статический аудит (план 1.3):** реализован реальный сканер проекта
  (`luxor_core::audit`) — обходит дерево с учётом `.gitignore`, ищет
  захардкоженные токены, приватные ключи, `unsafe`, `unwrap/expect`, `eval`,
  `dangerouslySetInnerHTML`, TODO/FIXME. Команда `audit_run` — это конкретный
  продюсер для `telemetryBumpAudit` (счётчики `audits_run`/`issues_fixed` и
  ачивка `purity_keeper`) и для `discordPushEvent` (Critical-статус при
  критических находках). В UI добавлена карточка «Security audit» с кнопкой
  запуска и списком находок по severity.
- **MetricRegistry (план 13.1):** каркас подключён к живым данным через
  команду `metrics_collect` — провайдеры `AuditProvider` и `TelemetryProvider`
  отдают метрики через trait, новые источники добавляются без изменения
  движка.
- **Discord app id:** установлен реальный client id `1519063576348721203`
  (и сохранён public key) — RPC работает из коробки, остаётся только включить
  тумблер в настройках.
- **CI-гард:** тест `commands_registered.rs` проверяет, что каждая
  `#[tauri::command]` присутствует в `generate_handler![]`.
- Перевыпущены все иконки приложения из нового исходника; `icon.ico` теперь
  мультиразмерный (16→256) вместо одиночного 16×16.

## v0.1.0

Первый публичный релиз Luxor. Базовая инфраструктура готова к использованию.

- Версия 0.1.0 — начало публичной истории версий
- Плавные анимации открытия/закрытия левого и правого сайдбаров (CSS transition на width + opacity)
- Фикс: ссылки на файлы в Markdown открываются в редакторе программы, а не в браузере
- Фикс: Explorer-поиск скрывает папки без совпадений; добавлены фильтры по типу файла (код, изображения, конфиги, документы)
- Улучшенный UI полей ввода — убраны серые полосы-артефакты, единый стиль focus-ring
- Улучшен правый сайдбар: секции с заголовками, плавное открытие без рывков
- Окно трея сдвинуто правее от иконки; закрывается при клике вне окна
- Более чёткая иконка приложения

## v0.6.12

Глубже интегрировали Luxor с ИИ-агентами и терминалом: детекция стала надёжнее и шире, теперь видно **где** запущен агент, **что** он делает (активен/ожидает) и сколько ест ресурсов — и из панели можно сразу открыть терминал в папке агента.

- **Шире список распознаваемых агентов** (искал актуальные в интернете): к уже известным (Claude Code, Codex CLI, Gemini CLI, Copilot CLI, Grok CLI, Kimi, Aider, Goose, Crush, Amp, Cursor Agent, Factory Droid, Augment, Codebuff, Qodo, Qoder, Kilo Code, Hermes) добавлены **OpenCode, OpenHands, Cline, Roo Code, Pi, Plandex (`plandex`/`pdx`), Continue, Mentat, gptme, Cody, Shell-GPT (`sgpt`), Rovo Dev**.
- **Надёжнее матчинг запуска**:
  - Распознаём запуск через раннеры пакетов — `npx @openai/codex`, `uvx aider`, `pnpm dlx opencode`, `bunx …` (раньше понимали только прямой бинарь и `node script.js`).
  - Новые **подсказки по пути пакета**: агент, запущенный как `node /…/@anthropic-ai/claude-code/cli.js` или `…/opencode-ai/dist/index.js`, теперь определяется по сегменту пути, даже если файл скрипта называется обезличенно (`cli.js`/`index.js`/`main.py`).
- **«Где запущен»** — для каждого процесса агента показываем его **рабочую папку** (cwd) и имя проекта (последний сегмент пути).
- **«Что делает»** — индикатор **активен/ожидает**: зелёная точка и метка «работает», когда агент реально грузит ЦП (порог `BUSY_CPU_PERCENT = 4%`), иначе «ожидает». Вверху панели — сводка: сколько агентов работает, суммарные ЦП и ОЗУ.
- **Интеграция с терминалом**: в строке каждого агента две новые кнопки —
  - **Открыть терминал в этой папке** (новая вкладка терминала с `cwd` агента, чтобы продолжить работу рядом с ним);
  - **Показать рабочую папку** (открывает cwd в файловом менеджере ОС).
  - Плюс прежняя кнопка остановки агента (kill всего дерева процессов).
- **Виджет «AI-агенты» в правом сайдбаре** теперь показывает итоговую строку: суммарные ЦП и ОЗУ по всем агентам.
- Структуры расширены: `AgentProcess` получил поля `cwd` / `parent_pid` / `busy`; матчинг вынесен в чистые функции `match_agent` / `match_pkg_hint` (полностью покрыты юнит-тестами в `luxor-core`).
- Проверено: `tsc --noEmit` чистый; 145 фронтенд-тестов зелёные; `bun run build` собирается; добавлены rust-тесты на новые агенты, раннеры пакетов и подсказки по пути; панель агентов визуально проверена в тёмной и светлой темах (cwd, статусы, сводка, кнопки терминала).

## v0.6.11

Правый сайдбар получил больше виджетов и умеет встраивать любую панель, а внешний вид UI теперь настраивается — шрифты и масштаб текста.

- **Больше виджетов в правом сайдбаре**: к уже существующим (часы, блокнот, git, задачи, быстрый запуск, избранные команды, инфо о проекте, недавние проекты) добавлены:
  - **Таймер фокуса** — pomodoro-обратный отсчёт прямо в панели: старт/пауза/сброс, пресеты 15/25/50 мин, по завершении показывает тост. Чисто фронтенд, выбранная длительность запоминается.
  - **Система** — живые полоски загрузки ЦП и ОЗУ (опрос каждые 2 с).
  - **AI-агенты** — список запущенных ИИ-агентов (Claude Code, Codex CLI и т.д.) с их числом и нагрузкой ЦП (опрос каждые 5 с), клик открывает панель агентов.
- **Встраивание любой панели в правый сайдбар** («чтобы туда можно было окно любое вставлять»): новый виджет **«Встроенная панель»** монтирует выбранную панель прямо внутрь сайдбара. Доступны Git, Файлы, Браузер, ИИ-центр, Агенты, Задачи, Навыки, Поиск, Сниппеты, HTTP-клиент, Docker, GitHub, Dev-инструменты, Лаунчер, Активность (всё, кроме панелей, которым нужен контекст вкладки дока — терминал/редактор/diff/изображение/БД/PDF). Панель выбирается в Settings → Interface → «Embedded panel»; встроенная панель обёрнута в защитный error-boundary, чтобы не уронить приложение.
- **Кастомизация внешнего вида UI — шрифты и масштаб текста** (Settings → Appearance):
  - **Шрифт интерфейса** — выбор из пресетов (System default, Inter, Segoe UI, Roboto, Helvetica, Georgia, JetBrains Mono) или ввод любого установленного семейства вручную; применяется ко всему UI мгновенно.
  - **Моноширинный шрифт** — для блоков кода и markdown (JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, Consolas, Menlo/Monaco или свой). Шрифт терминала по-прежнему настраивается отдельно во вкладке Terminal.
  - **Масштаб текста UI (%)** — 80–130%, масштабирует только текст интерфейса (root font-size), независимо от общего зума приложения.
  - Реализовано через CSS-переменные `--lx-font-ui` / `--lx-font-mono` и рантайм-применение в `applyAppearance` (пустое значение возвращает шрифт темы по умолчанию).
- Конфиг расширен полями `ui.right_panel_embed` / `ui.ui_font` / `ui.mono_font` / `ui.ui_font_scale` (с `#[serde(default)]`, обратная совместимость сохранена).
- Проверено: `tsc --noEmit` чистый; 145 фронтенд-тестов зелёные; `bun run build` собирается; визуально проверены новые виджеты, встроенная панель (Git и Браузер внутри сайдбара) и кастомный шрифт (Georgia, масштаб 115%) в тёмной теме.

## v0.6.10

Двойной клик по кнопкам сайдбара открывает новую вкладку, и появился настраиваемый правый сайдбар с разнообразными виджетами.

- **Двойной клик по кнопкам навигации сайдбара = новая вкладка (как в браузере)**: раньше клик по кнопке (Git, Файлы, Поиск, Задачи и т.д.) всегда фокусировал уже открытую панель этого типа (они были «синглтонами»). Теперь *двойной* клик по любой такой кнопке всегда открывает **новую** вкладку этой панели рядом с существующей — как открытие новой вкладки в браузере. Одиночный клик работает по-прежнему (фокусирует открытую панель), так что привычное поведение не сломалось. Работает и для верхней панели, и для бокового рейла кнопок.
- **Новый настраиваемый правый сайдбар**: Settings → Interface → «Right panel» — включается тумблером, ширина настраивается (200–520 px), а набор и порядок виджетов выбираются кликами. Доступные виджеты разнообразны: **Часы** (живое время + дата), **Блокнот** (быстрые заметки, сохраняются локально), **Git** (ветка/изменения, клик открывает панель Git), **Задачи** (открытые задачи проекта), **Быстрый запуск** (сетка кнопок: терминал, файлы, Git, поиск, задачи, лаунчер), **Избранные команды** (запуск в новом терминале одним кликом), **Инфо о проекте** и **Недавние проекты**. По умолчанию: часы, git, блокнот, быстрый запуск.
- **Быстрый переключатель в статус-баре**: иконка панели справа в статус-баре мгновенно показывает/скрывает правый сайдбар (подсвечивается акцентом, когда панель включена). Сам сайдбар тоже можно свернуть кнопкой в его шапке.
- Конфиг расширен полями `ui.right_panel_enabled` / `ui.right_panel_widgets` / `ui.right_panel_width` (с дефолтами через `#[serde(default)]`, обратная совместимость сохранена). Правый сайдбар скрывается в zen-режиме вместе с остальным хромом.
- Проверено: `tsc --noEmit` чистый; 145 фронтенд-тестов зелёные; `bun run build` собирается; визуально проверены оба новых поведения (новые вкладки по двойному клику и правый сайдбар) в светлой и тёмной темах.

## v0.6.9

Полировка взаимодействия: кольца фокуса с клавиатуры, плавные ховеры и более чёткая активная вкладка.

- **Кольца фокуса для клавиатуры**: элементы управления (кнопки, ссылки, поля, вкладки) показывают аккуратное акцентное кольцо при навигации с клавиатуры (`:focus-visible`) — мышиные клики оставляют интерфейс чистым. Терминал (xterm) и редактор (Monaco) исключены, чтобы не мешать их собственному фокусу.
- **Плавные ховеры и переходы**: короткие (0.12–0.14 с) переходы фона/цвета/тени на интерактивном хроме, чтобы интерфейс ощущался живым, но оставался мгновенным. Внутренности терминала и редактора не трогаются. Действия на экране приветствия слегка приподнимаются, а иконка увеличивается при наведении.
- **Чёткая активная вкладка**: активная вкладка проекта в верхней панели и активная вкладка дока получили тонкое акцентное подчёркивание, так что сразу видно, где вы находитесь.
- **Уважение к `prefers-reduced-motion`**: при включённой системной настройке «уменьшить движение» UI-переходы и анимации практически отключаются.
- **Локализация**: переведены оставшиеся английские строки в меню пресетов раскладки и во всплывающих подсказках статус-бара.

## v0.6.8

Починен встроенный браузер (наконец-то перестал показывать «отказано в подключении») и ускорены горячие пути фронтенда.

- **Браузер теперь всегда показывает страницу, а не «отказано в подключении»**: корень проблемы — встроенный браузер грузил сайты в `iframe`, а почти весь современный веб (DuckDuckGo, Google, YouTube, GitHub, X, Reddit и др.) запрещает встраивание заголовками `X-Frame-Options` / `Content-Security-Policy: frame-ancestors`. Это правило веб-платформы, а не баг Luxor — iframe не может его обойти, поэтому движок рисовал голую страницу «<сайт> отказал в подключении». Ключевой регресс: **DuckDuckGo — цель поиска по умолчанию — вообще не была в списке «блокирующих framing»**, поэтому *каждый* поиск во встроенном режиме упирался в «отказано в подключении». Теперь такие сайты автоматически открываются в настоящем нативном окне браузера (которое не подчиняется правилам framing и работает как обычный браузер), а вместо мёртвой страницы панель показывает понятное состояние «Открыто в окне браузера» с кнопками «Открыть снова» и «Всё равно встроить».
- **Двойная защита от «пустых» сайтов**: (1) расширенный и исправленный список известных блокирующих сайтов (быстрый путь без мигания), и (2) рантайм-подстраховка по тайм-ауту — если встроенный кадр не загрузился за ~4 с (сайт молча запретил framing), он автоматически переоткрывается в нативном окне. Так даже неизвестные сайты-блокировщики больше не упираются в тупик.
- **Поиск по умолчанию (DuckDuckGo) снова работает**: свободный текст в адресной строке уходит в поиск DuckDuckGo и сразу открывается в рабочем окне браузера вместо ошибки. Ссылки YouTube watch/shorts по-прежнему переписываются на встраиваемый плеер и играют внутри панели.
- **Производительность**: ускорены горячие пути фронтенда без изменения поведения — base64-кодирование терминального ввода (`strToB64`: для вставки 1 КБ ~24 µs → ~13 µs, кодировщик переиспользуется вместо аллокации на каждое нажатие; крупные вставки конвертируются чанками вместо O(n²)-конкатенации строки) и нечёткий поиск палитры команд (`fuzzyFilter` на 500 элементов ~120 µs → ~81 µs: запрос разбирается один раз на ввод, а не на каждый кандидат; текст приводится к нижнему регистру один раз). Микро-бенчмарки — `bun run bench`.
- **Тесты**: новый `BrowserPanel.test.ts` (21 тест: `normalizeUrl`, `toEmbeddable`, `isLikelyBlocked` — с явной проверкой регресса DuckDuckGo — и новая чистая функция маршрутизации `resolveNavigation`) и `ipc.test.ts` (4 теста: округление base64 байт-в-байт, граница чанка, UTF-8, сырые не-UTF-8 байты).
- Проверено: 145 фронтенд-тестов (было 120) — все зелёные; `tsc --noEmit` чистый; бенчмарки подтверждают ускорение. Логика браузера и base64 покрыта новыми тестами.

## v0.6.7

Аудит проекта: полная русская локализация интерфейса, защита от потери несохранённых правок, автосохранение в редакторе.

- **Полная русская локализация (≈100% UI)**: аудит показал, что перевод покрывал лишь ~20% интерфейса — навигацию и настройки, при этом все панели (файлы, Git, задачи, навыки, терминал, браузер, Docker, ИИ-сервисы, dev-инструменты, лаунчер, сниппеты, поиск, HTTP, БД, активность, редактор, изображения, diff), статус-бар, верхняя панель вкладок, контекстные меню, диалоги, тосты и плейсхолдеры оставались английскими. Теперь переведено всё: словарь вырос со 184 до 631 строки, `t()` расширена до gettext-стиля (`t("English")` — английская строка как ключ), так что непереведённые строки безопасно показываются на английском. Переключение языка — как и раньше, Settings → Interface → Language, без перезапуска.
- **Защита несохранённых правок в редакторе**: закрытие вкладки/панели с несохранённым файлом больше не теряет правки молча — любой путь закрытия (крестик вкладки, «Close panel», контекстное меню, закрытие других вкладок) показывает диалог подтверждения «Закрыть без сохранения?». Новый модуль dirty-guard покрыт 5 unit-тестами.
- **Автосохранение в редакторе** (по умолчанию выключено): Settings → Interface → «Автосохранение в редакторе» — изменённый файл сохраняется автоматически через ~1.2 с после последней правки (большие усечённые файлы пропускаются). Настройка хранится в конфиге (`ui.editor_autosave`) и покрыта тестами конфига.
- **Локализованы динамические подписи**: названия сегментов статус-бара (настройка и контекстное меню), вкладки панелей (Git, dev-инструменты, сниппеты), колонки канбана, фильтры журнала активности, пункты «Открыть в…» — переводятся в момент отрисовки, данные в сторах остаются языконезависимыми.
- В остальном аудит чистый: clippy без предупреждений, заглушек/TODO в коде нет, IPC-команды согласованы, утечек подписок на события не найдено.
- **Починен флаки e2e-тест** «recents survive a reload»: после перезагрузки страницы восстанавливается сохранённая раскладка дока, поэтому активной вкладкой может быть канбан, а не Welcome — тест ждал именно Welcome и периодически падал. Теперь после reload проверяется каркас приложения, а не конкретная панель.
- Проверено: 151 Rust + 120 фронтенд-тестов + 47 e2e — все зелёные; production-сборка собирается.

## v0.6.6

Уведомления, трекинг ИИ-агентов, новый трей, починен браузер и меню статус-бара.

- **Уведомления о завершении команд**: Luxor сообщает, когда команда в терминале закончилась (длительность + код выхода). Два механизма: точные метки шелл-интеграции OSC 133 (fish, новые PowerShell/zsh/bash) и fallback по дереву процессов для остальных шеллов. Быстрые команды не шумят — порог настраивается (по умолчанию 10 с).
- **Уведомления «агент закончил отвечать»**: когда Claude Code, Codex, Gemini, Qoder и др. перестаёт стримить вывод и ждёт вас — Luxor уведомляет. Эхо от набора текста отфильтровывается, короткие всплески (спиннеры) игнорируются. Логика покрыта 11 unit-тестами (`commandTracker.test.ts`).
- **Нативные OS-уведомления**: если окно скрыто в трей или не в фокусе, дополнительно показывается системное уведомление Windows (плагин `tauri-plugin-notification`); звонок терминала (BEL) теперь тоже доходит до системы. Новый раздел Settings → Notifications: общий выключатель, OS-уведомления, команды, минимальная длительность, агенты.
- **Трекинг ИИ-агентов**: распознаются qodercli, kilocode, kimi (в дополнение к claude, codex, gemini, aider, goose, opencode, amp, cursor-agent, copilot). Новая панель «ИИ-агенты» (кнопка в навигации, плюс-меню, клик по сегменту статус-бара): каждый процесс с PID, CPU, RAM, временем работы и командной строкой, кнопка остановки с подтверждением. В терминале с работающим агентом показывается бейдж «⚡ Claude Code».
- **Починено контекстное меню статус-бара (ПКМ)**: меню открывалось на ~400 px выше курсора — координата клика «зажималась» дважды (предварительная оценка высоты в сторе + повторная корректировка по фактическому размеру). Теперь позиция вычисляется один раз по реальной высоте меню: меню открывается у курсора, при нехватке места снизу — аккуратно над ним.
- **Починен встроенный браузер**: открытие сайта намертво вешало приложение — `browser_open_window` была синхронной командой и создавала webview-окно из главного потока (дедлок WebView2 на Windows). Команда стала асинхронной; повторное открытие переиспользует существующее окно браузера (навигация вместо пересоздания). Режим по умолчанию — отдельное окно: большинство сайтов (Google, YouTube, GitHub) запрещают встраивание в iframe, из-за чего «встроенный» режим выглядел сломанным.
- **Новое меню трея**: подменю «Проекты» (до 10 последних — клик открывает проект в главном окне), «Открыть Luxor», «Свернуть в трей», «Новое окно» (если включено), переключатель «работать в фоне», «Выход». Тултип трея показывает запущенных агентов («Luxor 0.6.6 — agents: Claude Code ×2»).
- **Второе окно приложения** (по умолчанию выключено): Settings → Interface → «Allow second window» + пункт в трее — полноценное второе окно для второго монитора. PTY-процессы корректно завершаются только после закрытия последнего окна.
- **Файловый менеджер**: поле быстрого фильтра, переключатель скрытых файлов (dotfiles), «свернуть всё», навигация с клавиатуры (↑/↓/→/←, Enter — открыть, F2 — переименовать, Delete — удалить), «Copy relative path» в контекстном меню.
- Проверено: 151 Rust + 115 фронтенд-тестов + 47 e2e — все зелёные; production-сборка собирается.

## v0.6.5

Критические фиксы редактора и терминала + ускорение запуска.

- **Исправлен краш «Cannot read properties of undefined (reading 'toUrl')»** (editor.worker): для JSON/TS/CSS/HTML-файлов Monaco получал базовый editor-воркер вместо языкового и пытался догрузить языковой сервис через несуществующий AMD-загрузчик. Теперь каждый язык получает свой воркер (json/css/html/ts) — краш и unhandled rejection устранены.
- **Починены «пустые» терминалы**: вывод PTY (баннер и приглашение шелла) приходил из Rust раньше, чем фронтенд успевал подписаться на события, и терялся навсегда — терминал выглядел незагрузившимся. Введена глобальная шина PTY-событий: подписка регистрируется один раз при старте приложения (до любого spawn), ранний вывод буферизуется и проигрывается панели при подключении (буфер с лимитами 512 чанков / 2 МБ, TTL 60 с). Покрыто 10 unit-тестами (`ptyBus.test.ts`).
- **Убраны фризы UI**: 44 синхронные Tauri-команды (запись в PTY на каждое нажатие клавиши, опрос статистики и дерева процессов каждые 4–5 с, SQLite-операции проектов, keychain, детект лаунчеров) выполнялись в главном потоке окна и блокировали отрисовку. Все переведены на `#[tauri::command(async)]` — выполняются в пуле потоков; оконные команды осознанно оставлены в главном потоке.
- **Быстрее показ окна**: failsafe-таймер показа окна снижен 2000 → 800 мс (инлайн-сплэш отрисовывается мгновенно, прятать окно 2 секунды незачем).
- **Телеметрия старта**: в `frontend.log` пишется строка `STARTUP firstPaint=… htmlLoaded=… jsReady=…` — в экспорте диагностики теперь видно, на каком этапе тормозит запуск на конкретной машине.
- **Бенчмарки**: новый набор `bun run bench` (mitata) — base64-конвертация IPC-чанков терминала, маршрутизация PtyRouter, fuzzy-поиск палитры, парсинг ввода терминала.
- **Новые perf e2e-тесты** (`e2e/perf.spec.ts`): бюджет интерактивности при холодном старте, контроль что Monaco и его воркеры не попадают в критический путь запуска, скорость появления первого терминала.
- Проверено: 149 Rust + 104 фронтенд-тестов + 48 e2e-тестов — все зелёные; production-сборка собирается, Monaco остаётся в lazy-чанке.

## v0.6.4

Оптимизация, стабилизация и UI/UX.

- **Мгновенный сплэш-экран**: фирменная заставка LUXOR появляется в ту же миллисекунду, что и окно (инлайн в HTML, до загрузки JS), и плавно исчезает после отрисовки интерфейса — больше никакого тёмного пустого окна при старте.
- **Защита от «пустого окна»**: если сохранённый layout восстановился, но не содержит ни одной панели (битый конфиг), приложение откатывается на дефолтную раскладку вместо пустого экрана.
- **Исправлен баг мок-режима (демо в браузере)**: команды списков (сессии, сниппеты, закладки, docker и др.) возвращали `undefined` вместо пустого списка и роняли командную палитру. В десктоп-сборке не проявлялся, но e2e-тесты ловили краш.
- **UX вкладок**: в контекстном меню вкладки добавлены «Закрыть вкладки справа» и «Закрыть все»; меню вкладок локализовано; новые горячие клавиши Ctrl+PageDown / Ctrl+PageUp — переключение вкладок по кругу (настраивается в Settings → Hotkeys).
- **Индикатор загрузки редактора**: при первом открытии файла показывается спиннер «Загрузка редактора…» вместо пустой области, пока Monaco инициализируется.
- **Уведомления без спама**: одинаковые повторяющиеся тосты (например, из цикла ошибок) обновляют один тост вместо бесконечного столбика.
- Фоновый прогрев Monaco теперь работает только в десктоп-приложении (в браузерном демо не тратит CPU).
- Проверено: 149 Rust + 94 фронтенд-тестов + 44 e2e-теста в браузере — все зелёные (e2e-набор стал стабильнее и быстрее в 4 раза после фикса мок-режима).

## v0.6.3

Производительность запуска и стабильность терминала.

- **Быстрый запуск окна**: найден и исправлен баг сборки — вспомогательный модуль Vite попадал внутрь чанка Monaco, из-за чего редактор (~4 МБ, 72% всего JS) грузился и парсился целиком ДО первой отрисовки окна. Теперь стартовая загрузка меньше в ~4 раза; Monaco подгружается лениво и дополнительно прогревается в фоне, когда приложение простаивает — первая вкладка редактора открывается без задержки.
- **«Unhandled rejection: [object Object]» исправлено**: ошибки Tauri-команд теперь сериализуются в читаемый текст (message / JSON), а все фоновые PTY-вызовы (write/resize/kill) и фоновые сохранения перехватывают ошибки мёртвых сессий вместо анонимного reject.
- **Пропадающий терминал после возврата из трея**: при возвращении окна из скрытого состояния терминал принудительно перерисовывается (re-fit + полный refresh) — webview мог сбрасывать отрисованную поверхность, пока окно скрыто.
- Подвисания при переключении вкладок: основной источник (парсинг гигантского бандла, конкурирующий с кликами) устранён фиксом выше; если зависания останутся — экспортируй отчёт диагностики (Settings → Interface), детектор фризов запишет их с таймстампами.
- Проверено: 149 Rust + 94 фронтенд-тестов, 32 e2e-теста в браузере (все панели, вкладки, палитра) — зелёные.

## v0.6.2

Аудит, ревью кода и система диагностики.

- **Экспорт диагностики** (Settings → Interface → «Диагностика»): одна кнопка сохраняет отчёт `luxor-diagnostics.txt` — версия, ОС, конфиг (без секретов: токены живут в keychain), список и содержимое последних краш-репортов, журнал ошибок фронтенда. Этот файл пользователи могут прикладывать к баг-репортам.
- **Журнал ошибок фронтенда** (`frontend.log` в каталоге конфига, авторотация на 512 КБ): туда автоматически пишутся необработанные JS-ошибки, promise-rejections, креши панелей (с компонентным стеком) и зависания UI.
- **Детектор зависаний**: heartbeat-проба фиксирует блокировки главного потока >500 мс (`FREEZE ... ~Nms`) с таймстампами — лаг-репорт теперь часть диагностики.
- **Аудит кода**: production-код ядра — 0 `unwrap`/`panic!`; все async-команды корректно используют `spawn_blocking` (UI не блокируется); во фронтенде нет утечек интервалов/слушателей; clippy — 0 предупреждений.
- Стабилизирован интеграционный PTY-тест (kill-fallback при недоставленном exit-сигнале ОС).

## v0.6.1

Стабилизация и оптимизация.

- **Починены «пустые» вкладки** (Git, GitHub, Tasks, Skills, AI, Search, Snippets, HTTP Client, Docker, Dev Tools, Activity, Browser и др.): панели больше не грузятся отдельными lazy-чанками — в некоторых Tauri-webview динамический `import()` не срабатывал и вкладка оставалась пустой. Теперь весь код панелей в стартовом бандле.
- **Видимые ошибки вместо пустых вкладок**: каждая панель обёрнута в error boundary — при сбое показывается текст ошибки и кнопка «Повторить».
- **Полное меню «+»**: все панели доступны из плюсика на полосе вкладок; состав меню настраивается в Settings → Interface (галочка на каждый пункт).
- **Глобальный перехват JS-ошибок**: необработанные исключения и promise-rejections показываются тостом.
- **Быстрее/надёжнее старт**: окно гарантированно показывается не позже чем через 2 с (фейлсейф, даже если фронтенд задержался); тяжёлый опрос списка процессов (агенты в статус-баре) отложен на 2,5 с после запуска.
- **Надёжный exit-сигнал терминала**: завершение шелла эмитится и по EOF PTY, и по wait() — раньше иногда оставались «зомби»-терминалы.
- Исправлен баг логики в Dev Tools → Disk usage (флаг cleanable), чистка по clippy (0 предупреждений).

## 0.6.0

### Added

**UI localization**
- New language setting (Settings → Interface → UI language): English and Русский, applied instantly without restart. Translated: nav buttons (labels + tooltips), command palette entries, panel titles, Git explorer tabs, settings sections, the GitHub panel and the update flow. The i18n framework (`src/lib/i18n.ts`) makes adding languages a dictionary-only change.

**Auto-update**
- Update checks against GitHub Releases: set the repo (Settings → Interface → Update repo), and Luxor checks once on startup (toggleable) and on demand ("Check now" button or palette → "Updates: Check for a new version"). Shows the latest version with a one-click link to the release download. No silent binary swaps — installation stays a user action.

**GitHub panel** (Issues / Pull Requests / CI)
- Auto-detects `owner/repo` from the project's `origin` remote (https/ssh forms).
- **Issues**: list with state filter (open/closed/all), labels, comment counts; full issue view with comments; write comments and create new issues (with a stored GitHub token).
- **Pull Requests**: list with draft/state badges and head → base branches; click to open on GitHub.
- **CI**: GitHub Actions runs with live status icons (running/success/failure), branch and trigger event; click through to logs.
- Works without a token on public repos (60 req/h); the stored git token for `github.com` (Settings → Git) is reused automatically for higher limits, private repos and writes.

### Tests
- 147 Rust core tests and 94 frontend tests, all green (new: GitHub URL/JSON parsing, release/version comparison, i18n).


## 0.5.0

### Added

**Search**
- **Project-wide search & replace**: new Search panel (Ctrl+Shift+F, sidebar button) — literal or regex queries, case toggle, results grouped by file with highlighted matches, click-to-open. Replace across the project with per-file checkboxes and a confirmation step (regex group references like `${1}` supported). Skips node_modules/target/.git, binaries and files > 1.5 MB.

**Git**
- **Tags tab**: list annotated & lightweight tags, create a tag on HEAD (with optional annotation), delete, and push a single tag to the remote (uses the stored token).
- **Reflog tab**: browse HEAD movements with timestamps and recover lost commits via one-click cherry-pick.
- **Cherry-pick**: apply any commit from the reflog onto HEAD; conflicts abort safely with the conflicting files listed.
- **Submodules tab**: list submodules with URL and pinned commit; init/update individually.
- **Conflicts tab**: see conflicted files during a merge, open a 3-way style editor (take ours / take theirs / hand-edit) and mark resolved (stages the file).

**Database**
- **SQL console**: the SQLite viewer gained a console mode — run SELECT/PRAGMA/EXPLAIN/WITH queries read-only by default; writes (INSERT/UPDATE/…) require an explicit "allow writes" opt-in. Ctrl+Enter to run, results capped at 500 rows.

**Dev Tools panel** (new, in sidebar & palette)
- **.env inspector**: parses all .env* files at the project root, masks values by default, and flags keys missing vs `.env.example`.
- **Log viewer**: finds *.log files in the project (depth ≤ 4) and tails the last 256 KB.
- **Disk usage**: per-directory size bars with "cleanable" highlighting for node_modules/target/dist/… caches.
- **Dependencies**: reads package.json / Cargo.toml / requirements.txt, checks latest versions against npm/crates.io/PyPI, and runs an OSV.dev vulnerability check on pinned versions.
- **Process viewer**: top processes by CPU (or a specific tree), with kill (PID 0/1 and Luxor itself are protected).
- **Crash reports**: panics are now written to crash files in the config dir (last 20 kept); browse and copy them for bug reports.

**Snippets / Notes / Bookmarks panel** (new)
- **Snippets library**: save reusable code blocks with title, language and tags; copy to clipboard in one click. Stored in a separate SQLite store (WAL, corrupt-db auto-recovery).
- **Project notes**: a per-project scratch pad that auto-saves as you type.
- **Bookmarks**: pin file:line locations with optional notes and jump back from the panel.

**HTTP client panel** (new)
- REST scratch pad: method + URL + headers + body, pretty-printed JSON responses, status/time/size badges, response headers. 2 MB body cap, http/https only.

**Docker panel** (new)
- Containers (with state dot, image, ports) and images via the docker CLI: start/stop/restart/remove, image removal, log tail. Graceful "docker not found" state.

**Files & editor**
- **Encoding support**: new core commands to detect file encodings (BOM + heuristics) and read/write files as UTF-8, UTF-16 LE/BE, Windows-125x, KOI8-R, ISO-8859-x, Shift-JIS, GBK and more.

**UX**
- **Zen mode**: Ctrl+Shift+Z (or palette) hides the top bar and status bar for distraction-free work.
- **Session snapshots**: save the current dock layout under a name from the palette and restore/delete it later (stored per project).
- **Command palette**: entries for all new panels; **hotkeys**: Ctrl+Shift+F (search) and Ctrl+Shift+Z (zen) are rebindable in Settings.
- **Sidebar**: optional nav buttons for Search, Snippets, HTTP, Docker and Dev Tools (drag/hide as usual).

### Fixed
- Projects database now runs an integrity check on open: a corrupt `projects.sqlite` is renamed to `.corrupt` and recreated instead of failing to start.

### Tests
- 139 Rust core tests (search/replace, env/deps/disk, notes store, registries/OSV parsing, docker parsing, process tree, crash log, encodings, SQL console guards, git tags/reflog/cherry-pick/conflicts/submodules) and 90 frontend tests, all green.


## 0.4.6

### Added
- **Git blame**: new "blame" tab in the Git explorer — enter a file path and see per-line authorship against HEAD (short hash + author in the gutter, commit summary and date on hover). Large files are blamed up to 20 000 lines with a clear notice.
- **AI agents in the status bar**: a new segment shows which AI CLI agents are running right now (Claude Code, Codex, Gemini, Aider, Goose, OpenCode, Amp, Cursor Agent, Copilot CLI and 8 more — 17 detected kinds, including ones launched via node/python/bun), with total CPU and RAM of their process trees. Hover for a per-agent breakdown; toggle like any other segment.
- **Per-terminal CPU/RAM badge**: each terminal shows live resource usage of its shell's whole process tree in the corner (process count on hover). Toggle in Settings → Terminal.
- **Terminal bell notifications**: when a background terminal rings the bell (an agent finished and waits for input, a long build ended), Luxor shows a toast and records it in the activity log. Toggle in Settings → Terminal.
- **Save terminal output**: right-click a terminal → "Save output to file…" captures the whole scrollback (hard-wrapped lines re-joined) to a text file via the native save dialog.
- **Activity Log panel**: a searchable, filterable history of what happened this session — commits, terminal events, file saves, errors, app events. Every toast is recorded too; the last 300 events survive restarts. Open it from the sidebar, the command palette, or the new nav button.
- **Editor minimap + multi-cursor**: optional Monaco minimap (Settings → Appearance), and Ctrl+Click now adds cursors (Ctrl+D selects the next occurrence — built into the editor).
- **`luxor .` command line**: launching the binary with a path opens that folder as a project. If Luxor is already running, the folder opens in the running instance (no second window); otherwise the app starts with it. `--help` / `--version` included.

### Fixed
- A latent compile error in the Tauri shell (`log::warn!` used without the `log` crate; now `tracing`).

### Tests
- New unit suites: activity log (dedupe, cap, snapshot stability, filtering), terminal buffer capture (wrapped lines, trailing blanks). 90 frontend unit tests total.
- New Rust suites: agent detection/aggregation, CLI handshake (pid file, request queue, path resolution), git blame hunks. 109 core tests total.
- New e2e spec: activity log panel (open/filter/clear/palette), status-bar agents segment, git blame tab, terminal stats badge, settings search for the new toggles (44 e2e total).

## 0.4.5

### Added
- **Built-in browser fixed for blocked sites**: new "App window mode" — every site opens in one persistent native browser window (full web compatibility: YouTube, Google, GitHub login, anything that refuses to embed in an iframe). The window is reused and refocused instead of spawning a new one per link, and the chosen mode is remembered across restarts. Embedded mode keeps working for sites that allow it.
- **4 new themes**: Rosé Pine, Everforest Dark, Ayu Mirage, GitHub Light (15 total).
- **Settings export/import**: share your whole config as a JSON file (Settings → Appearance → Share settings). Import validates the file, merges only known keys (junk and type mismatches are dropped per-field) and applies on Save.
- **Settings search by content**: the search box now finds individual settings ("scrollback", "tray", "keybindings", …), not just section names, and shows the matched items under each section.
- **Tab customization**: 14 preset tab colors plus a custom hex color, and a curated picker of 16 built-in SVG icons (rocket, star, flame, terminal, …) alongside the old custom-emoji option.
- **Blank workspace folder CTA**: Files, Git and Quick-actions panels with no folder now show "Choose folder…" (native picker) and a paste-a-path field instead of a dead-end message.
- **More editors in "Open in IDE"**: Trae, Antigravity, Kiro, Void, Sublime Text, Notepad++ (PATH), Windows Notepad, GNOME Text Editor, Mousepad, KWrite, gVim, Emacs.

### Changed
- **Faster startup**: ten heavyweight panels (editor, AI, git, tasks, browser, db, diff, image, skills, pdf) are now code-split and load on first open instead of inflating the launch bundle.

### Tests
- New unit suites: settings search index, tab icon parsing, config export/import merge rules (78 frontend unit tests total).
- New Rust tests: KNOWN_IDES uniqueness + new editors, new theme TOML round-trip (95 total).

## 0.4.4

### Added
- **Fuzzy search in the command palette**: queries match as subsequences with smart ranking (word-boundary and consecutive-character bonuses), and multi-word queries match in any order — "split term" finds "Layout: Split right with new terminal". The Ctrl+P project switcher uses the same matcher (name + path).
- **Recently used commands**: the palette remembers the last 8 commands you ran and lists them on top (with a "Recently used" section) when opened with an empty query. Persisted locally; survives restarts.
- **Tasks board filter**: a search box in the board header narrows cards across all columns by title or description text. Esc or the ✕ button clears it; drag & drop is paused while a filter is active so card positions can't get scrambled.

### Fixed
- **Markdown/HTML preview no longer waits for Monaco**: opening a `.md`/`.html` file rendered an empty panel until the (lazy-loaded, ~3.8 MB) editor chunk finished downloading. The preview now renders as soon as the file is read; the source editor still loads in the background. This also removes a flaky e2e failure under parallel load.

### Tests
- New unit suites for the fuzzy matcher and palette recents (23 tests; 61 total frontend unit tests).
- New `e2e/palette.spec.ts` (fuzzy ranking, multi-word matching, empty state, recents incl. persistence across reload) and a tasks-board filter e2e — 34 Playwright tests total.

## 0.4.3

### Added
- **Skill management**: per-skill enable/disable toggle (renames to `.disabled` on disk — agents stop seeing it), duplicate-name and identical-copy detection badges, and skill deletion. Double-click opens a skill; right-click menu: Open, Enable/Disable, Check for update on skills.sh (content-hash compare + one-click overwrite), Copy path, Copy to conventions, Delete.
- **Quick skill install**: the market Install button remembers your last destination (one click installs there); the chevron opens the full destination menu.
- **Git history insights**: commits show author, relative date and +/− line stats; expanding a commit lists per-file insertions/deletions ("N files changed, +X −Y").
- **12 editor themes** for the code editor and diff views (Monokai, Dracula, Nord, One Dark, GitHub Dark, Solarized…) — Settings → Appearance → "Code editor theme"; switches live.
- **Status bar extras**: optional Open-tasks counter, clock, and zoom indicator segments; the git segment now splits staged (green) / unstaged (amber) counts and has a right-click menu (Open Git explorer, Fetch, Pull, Push).
- **Tab-strip "+" button** right after the last panel tab: click adds a terminal, right-click lists every panel; right-clicking the empty tab-strip area shows the same menu.
- **Project tab customization**: pin tabs (protected from closing — including Shift+click, middle-click and "Close others"), per-tab emoji icons and accent colors via the tab context menu.
- **Run in background**: closing the window now hides Luxor to the system tray by default — terminals and agents keep running. Toggle in Settings → Interface or directly in the tray menu. Tray rebuilt: Open / Hide / background toggle / Quit, with version tooltip.
- **Side panel** (opt-in): compact left panel with configurable widgets — project info, git summary, open tasks, recent projects (Settings → Interface).
- **Default IDE picker**: Settings now lists detected IDEs in a dropdown (~24 known editors probed), plus "System default app" and "File explorer" pseudo-entries — both also appear in the IDE chooser menu.

### Fixed
- Context menus near the bottom/right screen edge no longer get clipped — they flip and clamp into the viewport.
- Built-in browser: sites that forbid embedding (YouTube, Google, GitHub…) now show a friendly explanation with "Open as app window" and "Try anyway" instead of silently failing; a persistent hint chip appears on every loaded page.

### Changed
- Settings modal: section headers with descriptions, better search keywords, and new Interface/Appearance/Status bar options.

## 0.4.2

### Added
- **Built-in web browser** (opt-in): new Browser nav button + panel with URL bar, search fallback (DuckDuckGo) and quick links. YouTube watch/shorts links are rewritten to the embeddable player so videos play inline; an "App window" button opens any URL in a dedicated native webview window (full site compatibility). Disabled by default — enable in Settings → Interface → "Web browser panel"; uses zero resources while off.
- **HTML preview**: `.html`/`.htm` files now open rendered like a real page (sandboxed iframe, scripts enabled), with a Source/Preview toggle in the footer — same UX as Markdown preview.
- **PDF viewer**: `.pdf` files open in a dedicated panel using the webview's native PDF renderer via the Tauri asset protocol.
- **More context-menu actions** — file explorer: "Open with default app", "Duplicate" (auto "name copy", "name copy 2" naming, works on folders too), "Copy name"; project tabs: "Copy project path".
- New `fs_copy` command (recursive directory copy, refuses to overwrite) backing the Duplicate action.
- E2E regression test for the v0.4.0 frozen-tab bug (tab switching, dock layering & input).

### Fixed
- **Duplicate project tab** when adding the first workspace in dev/mock mode: the mock backend handed out its live project array, so the store aliased internal state. Mock now returns snapshots and the store dedupes by project id on insert.
- Poisoned-mutex panics: registry/config/stats locks now recover via `PoisonError::into_inner` instead of crashing the app after a panic in any other thread.
- Terminal command history capture recovers at every prompt via OSC 133 marks (a poisoned partial line can no longer corrupt the next entry).
- Recent-projects table is pruned to the 50 newest entries instead of growing forever.
- Stale e2e assertion for the IDE chevron (it sits right of the launch icon since 0.4.1).

### Changed
- Code-split the frontend bundle: Monaco (3.8 MB) now loads only when an editor opens; xterm, dockview, react, icons and markdown ship as separate cacheable chunks — faster startup.
- CSP extended and the asset protocol enabled to support the PDF viewer, HTML preview and browser panel (frames/media restricted to sandboxed sources).

## 0.4.1

### Fixed
- **"Command project_add_blank not found"**: the blank-workspace command existed but was never registered with the Tauri invoke handler. Registered it (and audited that every other command is registered).
- **Frozen window when switching project tabs**: inactive dock layouts were hidden with `visibility`, which dockview re-overrides on its inner nodes, so a stale dock could cover the active one and swallow all clicks. Docks now hide via `opacity` + `pointer-events` + z-index.
- **Drag & drop everywhere (panel splitting, kanban cards, sidebar, status bar)**: Tauri's built-in drag-drop handler (`dragDropEnabled`) intercepted HTML5 drag events in the webview. Disabled it — Luxor doesn't use native file-drop.
- **Clipped buttons in the compressed sidebar**: quick-action and nav labels now truncate with ellipsis instead of overflowing; icons no longer shrink.

### Added
- **Recent projects**: closing a folder tab records it; reopen from the "+" menu or the Welcome screen (missing folders are flagged). Entries can be removed.
- **Terminal command history** (Ctrl+Shift+R or right-click → Command history): commands typed in any Luxor terminal are recorded locally; filter, click to run, Shift+click to paste without running.
- **Configurable shell & external terminal** in Settings → Terminal: dropdowns of detected shells (PowerShell, pwsh, bash, zsh, fish, nushell, …) and terminal emulators (Windows Terminal, Ghostty, Alacritty, kitty, WezTerm, GNOME Terminal, …) plus free-text for custom commands. The "Open external terminal" quick action honors the choice.
- **Global skills tab**: manage user-level skills in `~/.claude/skills` & co alongside project skills; the market can install into project or global conventions.
- **"Installed" badges** in the skills market, cross-referencing project and global skills.
- **Files panel multi-select** (Ctrl/Shift+click): copy paths, or copy a ready AI-agent prompt with the selected files' paths or full contents in fenced code blocks.
- **Tasks board quick actions**: hover ◀/▶ buttons and Shift+click to advance a card, done/total counter in the header, "Clear done" button, and the add-task input stays open for rapid entry.
- **Success toasts** for launcher buttons (terminal, file manager, IDE) — actions confirm visibly instead of failing silently.
- Shift+click a project tab to close it instantly; "Close other tabs" in the tab context menu.

### Changed
- **skills.sh catalog is cached on disk for 1 hour** (manual reload bypasses the cache; offline falls back to the stale cache) and **SKILL.md downloads race all URL candidates in parallel** instead of trying them sequentially — market browsing and installs are much faster.
- Skills market filtering uses deferred rendering, so typing stays responsive on large catalogs.
- Smooth scrolling in all scrollable panes (terminal viewport excluded to keep fast output snappy).
- IDE-selector chevron moved to the right of the launch button.

## 0.4.0

### Added
- **Kanban task board** (Tasks panel): per-project and global boards with Backlog / To do / In progress / Done columns, drag & drop between columns with live drop hints, inline add and edit, and a right-click menu with "Copy as agent prompt" to hand a task to any AI agent. Stored in Luxor's SQLite registry.
- **Agent skills manager** (Skills panel): scans the open project for skills of all major agent conventions (`.agents`, `.claude`, `.codex`, `.cursor`, `.opencode`, `.github`), opens SKILL.md files straight in the editor, creates new skills from a template, imports .md files, and copies skills between conventions.
- **Skills market**: browse the skills.sh catalog inside Luxor (official badges, install counts, filtering) and install any skill into the convention folder of your choice in one click.
- **App zoom**: Ctrl +/− and Ctrl+wheel zoom the whole window (Ctrl+0 resets); the level lives in Settings → Interface and persists across restarts. Uses the native webview zoom with a CSS fallback.
- **Customizable sidebar**: nav buttons can be reordered by dragging them directly, hidden/shown from their right-click menu, or managed in Settings → Interface; the order and visibility persist.
- **Customizable status bar**: right-click toggles every segment (project, git branch, CPU, RAM, network and ping), segments reorder by drag & drop, and "Reset segment order" restores the default.
- **Visible drag previews**: dragging tabs, sidebar buttons, status-bar segments, or kanban cards now shows a labeled ghost of the dragged item.
- **Discoverable splitting**: split buttons in every group header (split right/down with a new terminal), split and move-to-split actions in the tab context menu, and "Layout: Split right/down" palette commands — no more hidden drag-only splitting.
- **Markdown preview** in the file editor: .md files open rendered, with a one-click raw/preview toggle.
- **Playwright e2e suite**: 25 browser tests covering the sidebar, splitting, popup dismissal, zoom, status bar, kanban, skills, and markdown preview (`bun run e2e`), plus 20 unit tests (`bun test src`).
- New palette commands: open Tasks/Skills, open file in viewer, zoom in/out/reset, customize sidebar/status bar, save layout as preset.
- Welcome panel now lists tips for the DB viewer, file explorer, splitting, Tasks, and Skills so existing features are easier to find.

### Changed
- Nav buttons fill the full sidebar width (or top-bar height) instead of floating oddly centered; quick actions align consistently.
- The IDE picker chevron now sits to the LEFT of (or above, in the vertical sidebar) the IDE launch button.
- Settings window is larger, split into sidebar sections (General, Interface, Status bar, Terminal, Hotkeys, IDEs, Advanced), and more detailed.

### Fixed
- **Empty window / dead dock when switching projects or tabs rapidly** — a dock initialization race (also triggered by React StrictMode remounts) could leave a project dock permanently empty; docks now always finish initializing.
- **Sidebar buttons sometimes not registering clicks** — open dropdowns no longer swallow the first click on a nav button, and the resize handle no longer overlaps the buttons.
- Terminals losing their WebGL context (many terminals open) no longer glitch the window when switching tabs; the affected terminal falls back to the DOM renderer.
- ALL popups, dropdowns, dialogs, and context menus now close on Esc and on outside click, consistently.

## 0.3.0

### Added
- **8 color themes**: Dark, Light, Tokyo Night, Catppuccin Mocha, Catppuccin Latte, Dracula, Nord, Gruvbox Dark, One Dark, Solarized Light — theme grid picker in Settings and theme commands in the palette; terminals and editors re-theme live.
- **File explorer panel** (Ctrl+Shift+E): dockable lazy tree with full context menu — new file/folder, rename, delete, copy path, open terminal here, reveal in file manager.
- **File viewer/editor panel**: Monaco-based editor with syntax highlighting by extension, Ctrl+S save, dirty indicator, large/binary-file guards.
- **Image viewer panel**: zoom (fit / ± / Ctrl+wheel), checkerboard backdrop for transparency.
- **SQLite database viewer panel**: read-only table list + paginated rows.
- **Blank workspaces**: project tabs without a folder — just terminals and panels.
- **Quick project switcher** (Ctrl+P): fuzzy jump between tabs, Ctrl+P again cycles.
- **System stats in the status bar**: CPU, RAM, network throughput, and TCP ping — each toggleable in Settings, with configurable refresh interval and ping host.
- **Quick-action buttons** (external terminal / file manager / IDE / favorite commands) placeable in the top bar or a side rail, or hidden — no longer a tab.
- **Single IDE button with dropdown**: detected + custom IDEs with brand badges, per-IDE "set as default" star; custom IDEs (label + path to .exe) configurable in Settings.
- **Editable hotkeys**: click-to-record hotkey editor in Settings.
- **Tray icon**: show/hide window and quit from the system tray; left-click toggles the window.
- **Custom context menus** app-wide (terminals, tabs, file tree, fallback menu) replacing the browser menu; native menu kept inside text fields and Monaco.
- **In-app dialogs and prompts** replacing `window.confirm` / `window.prompt`; polished toast notifications with icons.
- **Drag & drop**: reorder project tabs by dragging; full dockview drag & drop of panels into custom layouts (per-project layouts persist and restore).
- Tab UX: close button on the active tab only (with confirmation), middle-click closes any tab, tab context menu (rename / new terminal / reveal / close), "+" menu for folder or blank workspace.
- Resizable sidebar (drag its edge) and configurable top bar height.
- SVG icon set (lucide) across the entire UI — no more emoji icons.

### Fixed
- **Terminals no longer reload when switching projects** — each project's dock stays mounted in the background.
- **White flash at startup** — the window starts hidden with a dark background and is shown only after the first React paint.
- IDE launches on Windows no longer flash a console window (fixes Zed opening a terminal).
- IDE launch resolves absolute executable paths and respects the configured default IDE.
- Git explorer discovers the repository root from subfolders instead of requiring the tab to point at the repo root.

## 0.2.0

### Added
- **Settings overhaul**: sectioned settings window (Appearance / Terminal / Git / AI / Launcher / Hotkeys).
- Accent color customization with swatches and hex input; applied live across the UI.
- "Confirm destructive actions" toggle — controls confirmations for discard, branch delete, and tab removal.
- Terminal: cursor style (block / underline / bar), cursor blink and copy-on-select options.
- Terminal: in-terminal search (Ctrl+F) with incremental highlight, next/previous navigation.
- Terminal: clickable URLs (opened in the system browser).
- Terminal: "Restart shell" overlay when the shell process exits.
- Git: amend last commit (with message prefill) — works even with an empty stage.
- Git: configurable diff view (side-by-side / inline) plus a per-panel toggle button.
- Git: configurable auto-refresh interval (0 disables polling) and a manual refresh button.
- Project tabs: right-click context menu (rename, open in terminal, remove).
- Project tabs: warning badge when the project folder no longer exists on disk.
- Command palette: theme toggle and rename-tab commands.
- Config recovery: a corrupt `config.toml` is backed up (`config.toml.corrupt`) and defaults are loaded instead of failing to start.

### Fixed
- Removing a project tab now respects the confirmation setting instead of deleting instantly.

## 0.1.0

Initial release: multi-terminal workspace with layout presets, project tabs,
Git explorer with Monaco diffs and the quick-actions launcher
services center.

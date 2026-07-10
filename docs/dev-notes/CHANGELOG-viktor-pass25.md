# Viktor pass25 — unified Explorer + IDE file editor

## Что изменено

- Объединил отдельный редактор файлов и редактор внутри Files/Explorer через общий `FileEditorSurface` на Monaco.
- Вынес IDE-поведение из `EditorPanel` в переиспользуемую поверхность:
  - подсветка синтаксиса и расширенный autodetect языков;
  - выбор темы редактора;
  - панель Save / Find / Replace / Commands;
  - переключатели font size, whitespace, wrap;
  - hotkeys help;
  - Monaco guides, bracket pair colorization, sticky scroll, smooth scrolling;
  - Ctrl/Cmd+S, Ctrl/Cmd+Enter, Alt+Z, Ctrl/Cmd+Shift+O.
- Files/Explorer теперь открывает текстовые файлы прямо справа, внутри проводника, тем же полноценным редактором.
- Для image/db/pdf оставил прежнюю маршрутизацию в специализированные панели.
- Добавил контекстное меню файлов:
  - `Open in Explorer editor` — открыть inline в проводнике;
  - `Open in editor tab` — открыть отдельной вкладкой;
  - `Open with default app` — открыть системным приложением.
- Добавил split-layout в Files/Explorer: дерево слева, редактор справа, с заголовком текущего файла, индикатором `*` для unsaved и кнопками открыть во вкладке / закрыть.
- Добавил guard от потери изменений при переключении/закрытии inline-редактора, если файл не сохранён.
- Обычный `EditorPanel` продолжает работать как раньше, но теперь использует тот же общий компонент.

## Проверки

- `bun run typecheck` — OK.
- `bun test src` — OK: 235 tests passed, 0 failed.
- `bun run build` — OK: production build completed in 42.69s.

## Примечание

Rust/Cargo тесты не запускались: изменения pass25 только во frontend TypeScript/React.

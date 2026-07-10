# Viktor pass26 — default IDE/Zed button + project audit polish

## Что изменено

- Добавил единый helper `ideActions` для действий внешних IDE:
  - объединяет custom IDE из Settings и auto-detected IDE;
  - сохраняет приоритет custom IDE;
  - поддерживает fallback-действия `System default` и `File explorer`;
  - корректно показывает выбранную IDE даже если она временно не найдена в PATH (например `zed` или путь к `zed.exe`).
- Добавил заметную кнопку `Open in <выбранная IDE>` там, где реально открывают проект:
  - Files/Explorer toolbar;
  - header встроенного Explorer editor;
  - DevTools → Run / IDE workspace actions;
  - Launcher → Open in….
- Если в настройках выбран Zed как default IDE, кнопка теперь будет явно показывать `Open in Zed` и открывать проект через Zed.
- Убрал дублирование выбранной default IDE в списках второстепенных IDE-кнопок.
- Backend `launcher_open_ide` теперь безопасно понимает pseudo-default из настроек:
  - `__default__` открывает системным приложением;
  - `__explorer__` открывает file manager;
  - обычные команды IDE запускаются как раньше.
- Продолжил аудит Files/Explorer после объединения редакторов:
  - новые текстовые файлы теперь сразу открываются inline в Explorer editor;
  - активный файл в дереве подсвечивается accent-ring;
  - rename текущего inline-файла обновляет путь редактора, selection и focus;
  - delete текущего inline-файла или папки, в которой он лежит, закрывает inline-редактор и сбрасывает dirty-state;
  - при rename текущего dirty-файла включён guard от потери несохранённых изменений;
  - контекстное меню файлов получило действие `Open project in <выбранная IDE>`.

## Проверки

- `bun run typecheck` — OK.
- `bun test src` — OK: 238 tests passed, 0 failed.
- `bun run build` — OK: production build completed in 44.81s.
- `cargo test -p luxor-core launcher --lib` — не запустился в sandbox: `cargo: command not found`.

## Примечание

Изменения pass26 сфокусированы на default IDE/Zed flow, добивке Explorer/editor edge-cases и UI-polish без рискованной переделки архитектуры.

from pathlib import Path
import re
import sys

root = Path('/agent/workspace/luxor_project/luxor-audit')
failures: list[str] = []

patterns_absent = [
    'hideNavButton',
    'moveNavToSidebar',
    'moveNavToTopbar',
    'GatewayInfo',
    'config.omniroute',
    'openPanel("ai"',
    'AI services center',
    'Git Explorer',
    'runningIds',
]

for pattern in patterns_absent:
    hits = []
    for path in (root / 'src').rglob('*'):
        if path.suffix not in {'.ts', '.tsx'}:
            continue
        text = path.read_text(errors='ignore')
        if pattern in text:
            hits.append(str(path.relative_to(root)))
    if hits:
        failures.append(f'unexpected pattern {pattern!r} in {hits}')

agents = root / 'src/panels/AgentsPanel.tsx'
agents_text = agents.read_text()
if 'import { Bot, FolderOpen, RefreshCw, Skull, TerminalSquare } from "lucide-react";' not in agents_text:
    failures.append('AgentsPanel lucide import is not the expected reduced import list')

# Check TS/JS/JSX delimiter balance while ignoring strings and comments.
def strip_strings_and_comments(src: str) -> str:
    out = []
    i = 0
    n = len(src)
    state = 'code'
    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if state == 'code':
            if ch == '/' and nxt == '/':
                state = 'line_comment'; out.append('  '); i += 2; continue
            if ch == '/' and nxt == '*':
                state = 'block_comment'; out.append('  '); i += 2; continue
            if ch in {'"', "'", '`'}:
                quote = ch; state = 'string_' + quote; out.append(' '); i += 1; continue
            out.append(ch); i += 1; continue
        if state == 'line_comment':
            out.append('\n' if ch == '\n' else ' ')
            if ch == '\n': state = 'code'
            i += 1; continue
        if state == 'block_comment':
            out.append('\n' if ch == '\n' else ' ')
            if ch == '*' and nxt == '/':
                out.append(' '); i += 2; state = 'code'; continue
            i += 1; continue
        if state.startswith('string_'):
            quote = state[len('string_'):]
            out.append('\n' if ch == '\n' else ' ')
            if ch == '\\':
                if i + 1 < n:
                    out.append('\n' if nxt == '\n' else ' ')
                i += 2; continue
            if ch == quote:
                state = 'code'
            i += 1; continue
    return ''.join(out)

clean = strip_strings_and_comments(agents_text)
pairs = {'(': ')', '{': '}', '[': ']'}
stack: list[tuple[str, int]] = []
for i, ch in enumerate(clean):
    if ch in pairs:
        stack.append((ch, i))
    elif ch in pairs.values():
        if not stack or pairs[stack[-1][0]] != ch:
            failures.append(f'AgentsPanel unbalanced closing {ch} at char {i}')
            break
        stack.pop()
if stack:
    failures.append(f'AgentsPanel unclosed delimiter {stack[-1]}')

wc = root / 'src/components/WindowChrome.tsx'
wc_text = wc.read_text()
if '<ChromeNavButtons config={config} />' in wc_text:
    before = wc_text[:wc_text.index('<ChromeNavButtons config={config} />')]
    # Only inspect the WindowChrome function body immediately before usage.
    fn_start = before.rfind('export function WindowChrome()')
    if fn_start == -1 or 'const config = useAppStore((s) => s.config);' not in before[fn_start:]:
        failures.append('WindowChrome uses config without a local declaration')
else:
    failures.append('WindowChrome no longer renders ChromeNavButtons with config prop')

cargo_root = root / 'Cargo.toml'
ta = root / 'src-tauri/Cargo.toml'
if 'chrono = { version = "0.4", features = ["serde"] }' not in cargo_root.read_text():
    failures.append('workspace chrono dependency missing')
if 'chrono.workspace = true' not in ta.read_text():
    failures.append('src-tauri chrono workspace dependency missing')

if failures:
    print('\n'.join(failures))
    sys.exit(1)
print('static regression checks OK')

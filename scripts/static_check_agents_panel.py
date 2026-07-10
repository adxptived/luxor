from pathlib import Path

path = Path('/agent/workspace/luxor_project/luxor-audit/src/panels/AgentsPanel.tsx')
text = path.read_text()

pairs = {'(': ')', '{': '}', '[': ']'}
stack = []
for i, ch in enumerate(text):
    if ch in pairs:
        stack.append((ch, i))
    elif ch in pairs.values():
        if not stack or pairs[stack[-1][0]] != ch:
            raise SystemExit(f'unbalanced {ch} at {i}')
        stack.pop()
if stack:
    raise SystemExit(f'unclosed {stack[-1]}')

# Light JSX tag balance for ordinary tags used here.
import re
voidish = set()
tag_stack = []
for m in re.finditer(r'<(/?)([A-Za-z][A-Za-z0-9.]*)\b([^>]*)>', text):
    slash, name, rest = m.groups()
    raw = m.group(0)
    if raw.startswith('<>') or raw.startswith('</>'):
        name = 'Fragment'
    if slash:
        if not tag_stack or tag_stack[-1] != name:
            raise SystemExit(f'jsx close mismatch {name} at {m.start()}, stack tail {tag_stack[-3:]}')
        tag_stack.pop()
    elif raw.endswith('/>') or name in voidish:
        continue
    else:
        tag_stack.append(name)
if tag_stack:
    raise SystemExit(f'unclosed jsx tags {tag_stack[-5:]}')

print('AgentsPanel bracket and JSX tag balance OK')

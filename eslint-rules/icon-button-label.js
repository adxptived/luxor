// Local ESLint rule: every icon-only <button> must carry an accessible name.
//
// The 2026 a11y audit found two dozen icon-only buttons that relied on `title`
// alone. `title` is a hover tooltip: it is not announced consistently by
// screen readers (NVDA/Narrator on WebView2 skip it in several modes) and it is
// invisible to keyboard and touch users. This rule requires an explicit
// `aria-label` (or `aria-labelledby`) whenever a <button>'s visible content is
// nothing but icons.
//
// "Icon" means: an <svg>, a component imported from `lucide-react`, a component
// whose name ends in `Icon`, or a member expression ending in `.icon` / `.Icon`
// (the `<b.icon />` pattern used by the nav button definitions). Wrapper
// <span>/<div>/<i> elements are looked through. Any text, any unknown component
// or any non-trivial expression counts as potential visible text, so the rule
// never fires on a button that might already be labelled by its content.
//
// It has no dependencies, so it runs in CI today; eslint-plugin-jsx-a11y is
// wired in eslint.config.js on top of it once installed.

const LOOK_THROUGH = new Set(["span", "div", "i"]);

/** @returns {"empty" | "icon" | "text"} */
function merge(a, b) {
  if (a === "text" || b === "text") return "text";
  if (a === "icon" || b === "icon") return "icon";
  return "empty";
}

function elementName(name) {
  if (!name) return null;
  if (name.type === "JSXIdentifier") return { kind: "id", value: name.name };
  if (name.type === "JSXMemberExpression") return { kind: "member", value: name.property.name };
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require aria-label (or aria-labelledby) on icon-only <button> elements",
    },
    schema: [],
    messages: {
      missing:
        "Icon-only <button> needs an accessible name: add aria-label (title is only a tooltip and is not reliably announced).",
    },
  },
  create(context) {
    const lucide = new Set();

    const classifyElement = (el) => {
      const n = elementName(el.openingElement?.name);
      if (!n) return "text";
      if (n.kind === "member") return /^(icon|Icon)$/.test(n.value) ? "icon" : "text";
      if (n.value === "svg") return "icon";
      if (lucide.has(n.value) || /Icon$/.test(n.value)) return "icon";
      if (LOOK_THROUGH.has(n.value)) return classifyChildren(el.children ?? []);
      return "text";
    };

    const classifyExpr = (e) => {
      if (!e || e.type === "JSXEmptyExpression") return "empty";
      if (e.type === "Literal" && (e.value === null || e.value === false || e.value === "")) return "empty";
      if (e.type === "JSXElement") return classifyElement(e);
      if (e.type === "LogicalExpression" && e.operator === "&&") return merge("empty", classifyExpr(e.right));
      if (e.type === "ConditionalExpression") return merge(classifyExpr(e.consequent), classifyExpr(e.alternate));
      if (e.type === "JSXFragment") return classifyChildren(e.children ?? []);
      return "text";
    };

    const classifyChildren = (children) => {
      let out = "empty";
      for (const c of children) {
        let k;
        if (c.type === "JSXText" || c.type === "Literal") k = String(c.value).trim() ? "text" : "empty";
        else if (c.type === "JSXElement") k = classifyElement(c);
        else if (c.type === "JSXFragment") k = classifyChildren(c.children ?? []);
        else if (c.type === "JSXExpressionContainer") k = classifyExpr(c.expression);
        else k = "text";
        out = merge(out, k);
        if (out === "text") return out;
      }
      return out;
    };

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "lucide-react") return;
        for (const s of node.specifiers) if (s.local?.name) lucide.add(s.local.name);
      },
      JSXElement(node) {
        const open = node.openingElement;
        if (open.name.type !== "JSXIdentifier" || open.name.name !== "button") return;
        for (const a of open.attributes) {
          if (a.type === "JSXSpreadAttribute") return; // name may come from props
          const name = a.name?.name;
          if (name === "aria-label" || name === "aria-labelledby") return;
        }
        if (classifyChildren(node.children) === "icon") {
          context.report({ node: open, messageId: "missing" });
        }
      },
    };
  },
};

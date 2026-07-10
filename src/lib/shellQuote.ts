/** Quote a path for pasting into a shell: wrap in double quotes if it has
 *  spaces/specials (works for bash, zsh, PowerShell and cmd for plain paths). */
export function shellQuote(p: string): string {
  if (!/[\s"'`$&|;<>()*?#!]/.test(p)) return p;
  // Escape bash double-quote specials. Also escape ! because bash history
  // expansion treats it specially inside double quotes when histexpand is on
  // (e.g. a path like /home/user/hello!world would otherwise trigger history
  // substitution). Leave backslashes unescaped so Windows paths (C:\Users\…)
  // survive intact.
  //
  // NOTE: The replace regex is written as a RegExp constructor (not a literal)
  // because the character class includes a backtick, which would prematurely
  // end the surrounding template literal if embedded as a regex literal.
  const escaped = p.replace(new RegExp('(["' + "`" + '$!])', "g"), "\\$1");
  return '"' + escaped + '"';
}

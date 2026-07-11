/**
 * Input validation utilities for security-sensitive operations.
 *
 * All validation functions return `{ valid: boolean, error?: string }`.
 * Use `validateOrThrow` to get a typed error for try/catch blocks.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Validate a file path: no null bytes, no path traversal, reasonable length. */
export function validateFilePath(path: string): ValidationResult {
  if (!path || path.length === 0) return { valid: false, error: "Path is empty" };
  if (path.length > 4096) return { valid: false, error: "Path exceeds maximum length (4096)" };
  if (path.includes("\0")) return { valid: false, error: "Path contains null bytes" };
  // Block any path traversal (one or more ../ or ..\ segments).
  if (/(\.\.[\/\\])/.test(path) || path === ".." || path.endsWith("/..")  || path.endsWith("\\..")){
    return { valid: false, error: "Path traversal detected" };
  }
  return { valid: true };
}

/** Validate a project name: alphanumeric + spaces, dashes, underscores, dots. */
export function validateProjectName(name: string): ValidationResult {
  if (!name || name.trim().length === 0) return { valid: false, error: "Name is empty" };
  if (name.length > 200) return { valid: false, error: "Name exceeds 200 characters" };
  // Allow letters, digits, spaces, dashes, underscores, dots, parens, brackets.
  if (!/^[\w\s\-.\[\](){}а-яА-ЯёЁ]+$/.test(name)) {
    return { valid: false, error: "Name contains invalid characters" };
  }
  return { valid: true };
}

/** Validate a git branch name per git-check-ref-format rules. */
export function validateBranchName(name: string): ValidationResult {
  if (!name || name.trim().length === 0) return { valid: false, error: "Branch name is empty" };
  if (name.length > 200) return { valid: false, error: "Branch name too long" };
  if (name.includes("..")) return { valid: false, error: "Branch name cannot contain '..'" };
  if (name.includes("~") || name.includes("^") || name.includes(":") || name.includes(" ")) {
    return { valid: false, error: "Branch name contains invalid characters" };
  }
  if (name.startsWith("-") || name.startsWith(".")) {
    return { valid: false, error: "Branch name cannot start with '-' or '.'" };
  }
  if (name.endsWith(".lock") || name.endsWith("/")) {
    return { valid: false, error: "Branch name has invalid suffix" };
  }
  return { valid: true };
}

/** Validate an API key format (generic — checks length and no whitespace). */
export function validateApiKey(key: string): ValidationResult {
  if (!key || key.length === 0) return { valid: false, error: "API key is empty" };
  if (key.length < 8) return { valid: false, error: "API key is too short" };
  if (key.length > 4096) return { valid: false, error: "API key exceeds maximum length" };
  if (/\s/.test(key)) return { valid: false, error: "API key contains whitespace" };
  return { valid: true };
}

/** Validate a URL (http/https only, no embedded credentials). */
export function validateHttpUrl(url: string): ValidationResult {
  if (!url || url.trim().length === 0) return { valid: false, error: "URL is empty" };
  if (url.length > 2048) return { valid: false, error: "URL exceeds maximum length" };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, error: "Only http and https URLs are allowed" };
    }
    // Match the backend policy (httpx.rs): credentials embedded in a URL leak
    // into logs, history and share links — require an Authorization header.
    if (parsed.username !== "" || parsed.password !== "") {
      return { valid: false, error: "URL credentials are not supported; use an Authorization header" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

/** Validate an email address. */
export function validateEmail(email: string): ValidationResult {
  if (!email || email.trim().length === 0) return { valid: false, error: "Email is empty" };
  if (email.length > 254) return { valid: false, error: "Email exceeds maximum length" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, error: "Invalid email format" };
  }
  return { valid: true };
}

/** Validate a shell command (blocks obvious injection patterns). */
export function validateShellCommand(cmd: string): ValidationResult {
  if (!cmd || cmd.trim().length === 0) return { valid: false, error: "Command is empty" };
  if (cmd.length > 10000) return { valid: false, error: "Command exceeds maximum length" };
  if (cmd.includes("\0")) return { valid: false, error: "Command contains null bytes" };
  return { valid: true };
}

/** Sanitize a string for safe display (strip control characters). */
export function sanitizeDisplayString(str: string): string {
  // Remove control characters except tab, newline, carriage return.
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/** Throw a typed error if validation fails. */
export function validateOrThrow(result: ValidationResult): void {
  if (!result.valid) {
    throw new Error(result.error ?? "Validation failed");
  }
}

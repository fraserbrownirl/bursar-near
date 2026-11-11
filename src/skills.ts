import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Playbooks on disk. The 9B firmware has no `files` command, so they are not read from the weights. */
export function skillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../skills");
}

export function skillNames(dir = skillsDir()): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
}

/** Empty name lists the playbooks. A name returns that file. Anything else is refused. */
export function skillText(name: string, dir = skillsDir()): string {
  const wanted = name.trim();
  if (!wanted) return skillNames(dir).join("\n");
  if (!/^[a-z0-9-]+$/.test(wanted)) return "unknown playbook";
  const path = join(dir, `${wanted}.md`);
  if (!existsSync(path) || !path.startsWith(dir)) return "unknown playbook";
  return readFileSync(path, "utf8");
}

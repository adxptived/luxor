import {
  Bot,
  CheckSquare,
  Container,
  FolderGit2,
  FolderTree,
  GitBranch,
  Globe,
  GraduationCap,
  History,
  Rocket,
  Search,
  Send,
  StickyNote,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Every panel the tab-strip "+" menu can open. Items can be hidden per-user
 *  via Settings → Interface (ui.plus_menu_hidden). */
export const PLUS_MENU_PANELS: { kind: string; label: string; icon: LucideIcon }[] = [
  { kind: "files", label: "Files", icon: FolderTree },
  { kind: "git", label: "Git", icon: GitBranch },
  { kind: "github", label: "GitHub", icon: FolderGit2 },
  { kind: "tasks", label: "Tasks", icon: CheckSquare },
  { kind: "skills", label: "Skills", icon: GraduationCap },
  { kind: "launcher", label: "Launcher", icon: Rocket },
  { kind: "agents", label: "AI Agents", icon: Bot },
  { kind: "search", label: "Search", icon: Search },
  { kind: "snippets", label: "Snippets", icon: StickyNote },
  { kind: "http", label: "HTTP Client", icon: Send },
  { kind: "docker", label: "Docker", icon: Container },
  { kind: "devtools", label: "Dev Tools", icon: Wrench },
  { kind: "activity", label: "Activity", icon: History },
  { kind: "web", label: "Browser", icon: Globe },
];

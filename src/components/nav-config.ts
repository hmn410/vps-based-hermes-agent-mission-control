/* Single source of truth for HQ navigation: the sidebar, the mobile tab bar
   and the ⌘K command palette all render from these arrays, so labels and
   links cannot drift apart. Page H1s use the same labels. */

import {
  Home,
  Bot,
  Lightbulb,
  ClipboardList,
  Cpu,
  Coins,
  Activity,
  MessageSquare,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  name: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    name: "Mission Control",
    items: [
      { href: "/", label: "Morning Brief", icon: Home },
      { href: "/hermes", label: "Dispatch Terminal", icon: Cpu },
      { href: "/follow-ups", label: "Follow-ups", icon: MessageSquare },
      { href: "/live-work", label: "Live Work", icon: Activity },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
      { href: "/usage", label: "Usage", icon: Coins },
    ],
  },
  {
    name: "Workspace",
    items: [
      { href: "/wiki", label: "Wiki", icon: BookOpen },
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/ideas", label: "Ideas", icon: Lightbulb },
    ],
  },
];

/** Flat list (sidebar order) for the command palette. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Mobile bottom tabs: short labels for a subset of NAV_ITEMS. */
const MOBILE_TABS: { href: string; label: string }[] = [
  { href: "/", label: "Brief" },
  { href: "/hermes", label: "Dispatch" },
  { href: "/live-work", label: "Live" },
  { href: "/tasks", label: "Tasks" },
  { href: "/agents", label: "Agents" },
];

export const MOBILE_NAV_ITEMS: NavItem[] = MOBILE_TABS.map((tab) => {
  const item = NAV_ITEMS.find((n) => n.href === tab.href);
  if (!item) throw new Error(`mobile tab ${tab.href} is not in NAV_GROUPS`);
  return { ...item, label: tab.label };
});

export function navLabel(href: string): string {
  return NAV_ITEMS.find((n) => n.href === href)?.label ?? href;
}

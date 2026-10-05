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
  BookOpen,
  CalendarClock,
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

// Retired routes (kept as redirects, never linked): /live-work → /tasks?tab=live,
// /follow-ups → /hermes.
export const NAV_GROUPS: NavGroup[] = [
  {
    name: "Today",
    items: [
      { href: "/", label: "Morning Brief", icon: Home },
      { href: "/hermes", label: "Dispatch", icon: Cpu },
    ],
  },
  {
    name: "Work",
    items: [
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
      { href: "/ideas", label: "Ideas", icon: Lightbulb },
      { href: "/wiki", label: "Wiki", icon: BookOpen },
    ],
  },
  {
    name: "System",
    items: [
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/schedules", label: "Schedules", icon: CalendarClock },
      { href: "/usage", label: "Usage", icon: Coins },
    ],
  },
];

/** Flat list (sidebar order) for the command palette. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Mobile bottom tabs: short labels for a subset of NAV_ITEMS. */
const MOBILE_TABS: { href: string; label: string }[] = [
  { href: "/", label: "Brief" },
  { href: "/hermes", label: "Dispatch" },
  { href: "/tasks", label: "Tasks" },
  { href: "/ideas", label: "Ideas" },
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

export const AGENT_ROSTER = [
  { id: "hermes", name: "Hermes", profile: "default" },
  { id: "integgy", name: "Integgy", profile: "ops" },
  { id: "jbt", name: "JBT", profile: "builder" },
  { id: "josh", name: "Josh", profile: "personal" },
  { id: "pixel", name: "Pixel", profile: "seocontent" },
] as const;

export type AgentId = (typeof AGENT_ROSTER)[number]["id"];

export function profileForAgent(agentId: string): string | undefined {
  return AGENT_ROSTER.find((agent) => agent.id === agentId)?.profile;
}

export function agentForProfile(profile: string): AgentId | undefined {
  return AGENT_ROSTER.find((agent) => agent.profile === profile)?.id;
}

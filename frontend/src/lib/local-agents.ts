const LOCAL_AGENT_PROMPTS: Record<string, string> = {
  researcher: 'Act as JARVIS Researcher. Structure the question, distinguish known facts from uncertainty, use only information present in the conversation or attached material, and never invent sources or claim to browse when no browsing tool is available.',
  engineer: 'Act as JARVIS Engineer. Diagnose systematically, state assumptions, propose safe and testable designs, and give implementation steps with validation checks.',
  analyst: 'Act as JARVIS Analyst. Break the problem into evidence, assumptions, calculations and conclusions. Check arithmetic and call out missing data.',
  planner: 'Act as JARVIS Planner. Convert the goal into ordered milestones, dependencies, risks and measurable completion checks. Keep the plan practical.',
  writer: 'Act as JARVIS Writer. Produce polished, audience-aware writing while preserving the user’s intended meaning and factual accuracy.',
};

export function getLocalAgentPrompt(message: string): { name: string; prompt: string } | null {
  const match = message.trim().match(/^@(researcher|engineer|analyst|planner|writer)\b/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return { name, prompt: LOCAL_AGENT_PROMPTS[name] };
}

export function localAgentHelp(): string {
  return 'Local specialist modes: @researcher, @engineer, @analyst, @planner, @writer. Prefix a message with one of these to activate that specialist for the turn.';
}

// Backend factory for BOTS=trueforge: maps game seats onto named TrueForge
// agents. Seat wizard-0..3 -> BotWizard-A/B/C (or the matching index); Gronk
// -> the "Gronk" agent. Each TrueForgeBackend fails open: any HTTP/parse error
// is caught by the orchestrator, which falls back to the scripted FSM.
import type { AgentBackend } from "./agent";
import type { BackendFactory } from "./lobby";
import { BOT_WIZARD_NAMES, GRONK_AGENT_NAME, TrueForgeBackend, type TrueForgeConfig } from "./trueforge";

export function trueforgeBackendFactory(cfg: TrueForgeConfig): BackendFactory {
  // Map the four seats to agent names. The order follows BOT_WIZARD_NAMES, but
  // seat indexes beyond the name list wrap so any seat count still works.
  const nameForSeat = (seatId: string): string => {
    const idx = Number(seatId.split("-")[1] ?? 0);
    return BOT_WIZARD_NAMES[idx % BOT_WIZARD_NAMES.length];
  };

  return {
    wizard(seatId: string): AgentBackend {
      return new TrueForgeBackend(seatId, nameForSeat(seatId), cfg);
    },
    gronk(): AgentBackend | null {
      return new TrueForgeBackend("gronk", GRONK_AGENT_NAME, cfg);
    },
  };
}
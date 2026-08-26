// Config loading for M4. Models live in separate, swappable files so they can
// be edited (or changed from the TrueForge UI) without touching code:
//   config/gronk-model.json -> Gronk's cheap/fast model
//   config/bots-model.json   -> bot wizards' standard model
//   config/trueforge.json    -> baseUrl, timeout, agent names
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ModelConfig, TrueForgeConfig } from "./trueforge";

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "config");

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export interface LoadedConfig {
  trueforge: TrueForgeConfig;
  gronkModel: ModelConfig;
  botsModel: ModelConfig;
}

/** Load the three config files with sane defaults so missing files don't crash. */
export function loadConfig(): LoadedConfig {
  const gronkModel = readJson<ModelConfig>(join(CONFIG_DIR, "gronk-model.json"), {
    name: "openai/gpt-4o-mini",
  });
  const botsModel = readJson<ModelConfig>(join(CONFIG_DIR, "bots-model.json"), {
    name: "openai/gpt-4o",
  });
  const tf = readJson<Partial<TrueForgeConfig>>(join(CONFIG_DIR, "trueforge.json"), {});
  return {
    gronkModel,
    botsModel,
    trueforge: {
      baseUrl: tf.baseUrl ?? process.env.TRUEFORGE_URL ?? "http://localhost:8790",
      apiKey: tf.apiKey ?? process.env.TRUEFORGE_API_KEY,
      decisionTimeoutMs: tf.decisionTimeoutMs,
      gronkModel,
      botsModel,
      mcpServerUrl: tf.mcpServerUrl ?? process.env.MCP_SERVER_URL,
    },
  };
}
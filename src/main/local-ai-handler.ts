// Utility process (utilityProcess.fork from src/main/local-ai.ts): answers the Prompt API for every
// page session main registers it on. Settings arrive from main as { type: 'settings', settings }.
import { LanguageModelUtility, localAIHandler } from "electron/utility";
import {
  DEFAULT_LOCAL_AI_SETTINGS,
  isLocalAIOrigin,
  type LocalAISettings,
  type PromptMessage,
} from "../shared/local-ai";
import { estimateTokens, respond } from "./local-ai-providers";

const CONTEXT_WINDOW = 8192;
let settings: LocalAISettings = { ...DEFAULT_LOCAL_AI_SETTINGS };

process.parentPort.on("message", (event) => {
  const data = event.data as { type?: string; settings?: LocalAISettings };
  if (data?.type === "settings" && data.settings) settings = data.settings;
});

localAIHandler.setPromptAPIHandler((details) => {
  if (!isLocalAIOrigin(details.securityOrigin)) return null;
  class SurffishLanguageModel extends LanguageModelUtility {
    history: PromptMessage[] = [];

    static override async create(
      options: Electron.LanguageModelCreateOptions,
    ): Promise<SurffishLanguageModel> {
      const model = new SurffishLanguageModel({
        contextUsage: 0,
        contextWindow: CONTEXT_WINDOW,
      });
      model.history = [...((options?.initialPrompts ?? []) as PromptMessage[])];
      model.contextUsage = estimateTokens(model.history);
      return model;
    }

    static override async availability(): Promise<string> {
      return "available";
    }

    override async prompt(
      input: Electron.LanguageModelMessage[],
      options: Electron.LanguageModelPromptOptions,
    ): Promise<string> {
      const turn = input as PromptMessage[];
      const answer = await respond(
        [...this.history, ...turn],
        settings,
        options?.signal,
      );
      this.history.push(...turn, {
        role: "assistant",
        content: [{ type: "text", value: answer }],
      });
      this.contextUsage = estimateTokens(this.history);
      return answer;
    }

    override async append(
      input: Electron.LanguageModelMessage[],
    ): Promise<undefined> {
      this.history.push(...(input as PromptMessage[]));
      this.contextUsage = estimateTokens(this.history);
      return undefined;
    }

    override async measureContextUsage(
      input: Electron.LanguageModelMessage[],
    ): Promise<number> {
      return estimateTokens(input as PromptMessage[]);
    }

    override async clone(): Promise<SurffishLanguageModel> {
      const copy = new SurffishLanguageModel({
        contextUsage: this.contextUsage,
        contextWindow: CONTEXT_WINDOW,
      });
      copy.history = [...this.history];
      return copy;
    }

    override destroy(): void {
      this.history = [];
    }
  }
  return SurffishLanguageModel;
});

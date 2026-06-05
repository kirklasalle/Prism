export interface PromptAST {
  raw: string;
  sections: {
    objective?: string;
    constraints?: string;
    context?: string;
    examples?: string;
  };
  tokenCount: number;
  signalDensity: number;
  lintErrors: string[];
}

export class LLRECompiler {
  /**
   * Compiles a raw string prompt containing XML-style delimiters into an AST structure.
   */
  static compile(text: string): PromptAST {
    const sections: PromptAST["sections"] = {};
    const tags = ["objective", "constraints", "context", "examples"] as const;

    for (const tag of tags) {
      const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
      const match = text.match(regex);
      if (match) {
        sections[tag] = match[1].trim();
      }
    }

    // Standard word-split token count
    const tokenCount = text.split(/\s+/).filter(Boolean).length;
    
    // Evaluate signal density (Objective + Constraints) vs Noise (Metadata/Examples/Padding)
    const signalText = `${sections.objective ?? ""} ${sections.constraints ?? ""}`.trim();
    const signalTokens = signalText.split(/\s+/).filter(Boolean).length;
    const signalDensity = tokenCount > 0 ? signalTokens / tokenCount : 0.0;

    // Linting validations
    const lintErrors: string[] = [];
    if (!sections.objective) {
      lintErrors.push("Missing mandatory tag: <objective>.");
    }
    if (!sections.constraints) {
      lintErrors.push("Missing mandatory tag: <constraints>.");
    }
    
    if (sections.objective && sections.objective.split(/\s+/).length < 3) {
      lintErrors.push("Objective block is too concise; provide clear functional end-states.");
    }
    if (signalDensity < 0.2 && tokenCount > 50) {
      lintErrors.push(`High prompt noise detected (Signal Density: ${(signalDensity * 100).toFixed(1)}%). Consider pruning redundant descriptions.`);
    }

    return { raw: text, sections, tokenCount, signalDensity, lintErrors };
  }
}

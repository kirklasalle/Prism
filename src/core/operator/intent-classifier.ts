/**
 * Intent Classifier for PRISM.
 * Parses incoming chat requests to detect if they are:
 * 1. Autonomous OS / Computer use tasks (e.g., shopping, email checking, system navigation).
 * 2. PRISM internal operating tasks (e.g., spawning agents, configuring swarms, adjusting settings).
 * 3. Standard chat (standard conversational interactions, general Q&A).
 */

export type IntentType = "autonomous_os_task" | "prism_operating_task" | "standard_chat";

export interface ClassificationResult {
    intent: IntentType;
    category: string;
    objective: string;
    requiresBrowser: boolean;
    requiresComputer: boolean;
    confidence: number; // 0.0 to 1.0
}

export class IntentClassifier {
    /**
     * Parse a user prompt to identify intent and details for autonomous execution.
     */
    public classify(prompt: string): ClassificationResult {
        const text = prompt.trim().toLowerCase();

        // 1. Check for Autonomous OS Tasks (e.g., Browser control, computer use, e-commerce)
        const osPatterns = [
            {
                category: "research",
                patterns: [
                    // "find/search/look up/locate/research" + real-world object
                    /\b(find|search|look\s*up|locate|research|investigate)\b.*\b(car|cars|vehicle|vehicles|truck|suv|listing|listings|price|prices|deal|deals|sale|property|properties|house|houses|home|homes|apartment|apartments|rental|rentals|job|jobs|hotel|hotels|flight|flights|ticket|tickets|restaurant|restaurants|product|products|item|items)\b/,
                    // real-world object + "find/search/look up/locate/research"
                    /\b(car|cars|vehicle|vehicles|truck|suv|listing|listings|price|prices|deal|deals|sale|property|properties|house|houses|home|homes|apartment|apartments|rental|rentals|job|jobs|hotel|hotels|flight|flights|ticket|tickets|restaurant|restaurants|product|products|item|items)\b.*\b(find|search|look\s*up|locate|research|investigate)\b/,
                    // "help me/I need to find" patterns
                    /\b(help|need)\b.*\b(find|search|look|locate)\b.*\b(car|vehicle|truck|suv|listing|price|deal|property|house|home|apartment|rental|job|hotel|flight|ticket|restaurant|product)\b/,
                    // Direct vehicle search patterns (common Kirk use case)
                    /\b(ford|chevy|chevrolet|toyota|honda|nissan|dodge|jeep|ram|bmw|mercedes|audi|hyundai|kia|subaru|mazda|volkswagen|vw|lexus|acura|infiniti|cadillac|buick|gmc|lincoln)\b.*\b(for sale|listing|price|under|miles|mileage)\b/,
                    /\b(for sale|listing|price|under|miles|mileage)\b.*\b(ford|chevy|chevrolet|toyota|honda|nissan|dodge|jeep|ram|bmw|mercedes|audi|hyundai|kia|subaru|mazda|volkswagen|vw|lexus|acura|infiniti|cadillac|buick|gmc|lincoln)\b/,
                ],
                requiresBrowser: true,
                requiresComputer: false
            },
            {
                category: "shopping",
                patterns: [
                    /\bshop\b/, /\bbuy\b/, /\bpurchase\b/, /\border\b/, /\bfind.*shoes\b/,
                    /\bsearch.*on amazon\b/, /\bcheck out.*cart\b/, /\bclothing\b/, /\bclothes\b/,
                    /\bshoes\b/, /\bjeans\b/, /\bpants\b/, /\bshirt\b/, /\bwear\b/, /\bstore\b/
                ],
                requiresBrowser: true,
                requiresComputer: true
            },
            {
                category: "email",
                patterns: [
                    /\bemail\b/, /\bgmail\b/, /\boutlook\b/, /\bcheck.*inbox\b/, /\bsend.*message\b/,
                    /\bmail\b/
                ],
                requiresBrowser: true,
                requiresComputer: false
            },
            {
                category: "browser",
                patterns: [
                    /\bnavigate\b/, /\bopen.*website\b/, /\bgo to\b/, /\bweb search\b/, /\bplaywright\b/,
                    /\bsearch.*google\b/, /\bscrape\b/, /\bbrowse\b/, /\bweb\b/, /\bsearch.*web\b/
                ],
                requiresBrowser: true,
                requiresComputer: false
            },
            {
                category: "computer",
                patterns: [
                    /\bmouse\b/, /\bkeyboard\b/, /\bclick\b/, /\btype\b/, /\bscreenshot\b/,
                    /\bdesktop\b/, /\bwindows\b/, /\bcontrol.*mouse\b/, /\brun.*command\b/
                ],
                requiresBrowser: false,
                requiresComputer: true
            }
        ];

        for (const item of osPatterns) {
            for (const pattern of item.patterns) {
                if (pattern.test(text)) {
                    return {
                        intent: "autonomous_os_task",
                        category: item.category,
                        objective: prompt,
                        requiresBrowser: item.requiresBrowser,
                        requiresComputer: item.requiresComputer,
                        confidence: 0.9
                    };
                }
            }
        }

        // 2. Check for PRISM Internal Operating Tasks (Kirk's PRISM Operating tasks comment)
        const prismPatterns = [
            {
                category: "agent_management",
                patterns: [
                    /\blaunch.*agent\b/, /\bspawn.*agent\b/, /\bcreate.*agent\b/,
                    /\bstop.*agent\b/, /\bpromote.*agent\b/, /\bdemote.*agent\b/,
                    /\bactive.*agents\b/, /\blist.*agents\b/, /\bagent pool\b/
                ],
                requiresBrowser: false,
                requiresComputer: false
            },
            {
                category: "swarm_coordination",
                patterns: [
                    /\bcreate.*swarm\b/, /\bstart.*swarm\b/, /\brun.*swarm\b/,
                    /\bswarm topology\b/, /\bswarm coordinator\b/, /\bmesh topology\b/,
                    /\bstar topology\b/, /\bpipeline topology\b/
                ],
                requiresBrowser: false,
                requiresComputer: false
            },
            {
                category: "settings_routing",
                patterns: [
                    /\bchange.*model\b/, /\bswitch.*llm\b/, /\bmodel capability matrix\b/,
                    /\bmodel matrix\b/, /\bpower manager\b/, /\beco-mode\b/, /\beco mode\b/,
                    /\badaptive mode\b/, /\bperformance mode\b/, /\bvalidate.*triad\b/,
                    /\bspectrum refraction\b/, /\bprism sr\b/, /\benable sr\b/
                ],
                requiresBrowser: false,
                requiresComputer: false
            },
            {
                category: "diagnostics",
                patterns: [
                    /\bhealth check\b/, /\bdiagnostics\b/, /\bself-healing\b/, /\bguardian agent\b/,
                    /\baab ledger\b/, /\brun.*diagnostics\b/, /\btelemetry\b/
                ],
                requiresBrowser: false,
                requiresComputer: false
            }
        ];

        for (const item of prismPatterns) {
            for (const pattern of item.patterns) {
                if (pattern.test(text)) {
                    return {
                        intent: "prism_operating_task",
                        category: item.category,
                        objective: prompt,
                        requiresBrowser: item.requiresBrowser,
                        requiresComputer: item.requiresComputer,
                        confidence: 0.95
                    };
                }
            }
        }

        // 3. Fallback: Standard Chat
        return {
            intent: "standard_chat",
            category: "general",
            objective: prompt,
            requiresBrowser: false,
            requiresComputer: false,
            confidence: 1.0
        };
    }
}

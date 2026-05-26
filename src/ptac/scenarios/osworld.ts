import type { PtacScenario } from "../types.js";
import { registerScenario } from "../scenario-registry.js";

const SCENARIO_OSWORLD: PtacScenario = {
    id: "osworld-benchmark",
    title: "OSWorld Benchmark Suite",
    suites: ["osworld"],
    requiresHost: true,
    tags: ["benchmark", "computer-use"],
    steps: [
        {
            id: "osworld-run",
            kind: "osworld",
            label: "Execute the OSWorld benchmark harness against the live agent.",
            args: {
                max_steps_per_task: 100,
                max_duration_per_task_ms: 300000,
                task_subset: "full",
            },
        },
    ],
};

registerScenario(SCENARIO_OSWORLD);

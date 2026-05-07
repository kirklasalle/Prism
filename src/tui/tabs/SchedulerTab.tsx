/**
 * PRISM TUI — Scheduler tab
 */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { PrismClient } from "../api/prism-client.js";
import { useApi, useListNavigation } from "../hooks.js";
import { colors, symbols } from "../theme.js";
import {
    Panel, DataTable, SubTabBar, StatusBadge,
    Loading, ErrorBox, KeyValue, SectionHeader,
} from "../components/ui.js";

const KANBAN_COLS = ["Backlog", "To Do", "In Progress", "Review", "Done"];

export function SchedulerTab({
    client,
    focused,
}: {
    client: PrismClient;
    focused: boolean;
}): React.JSX.Element {
    const [subTab, setSubTab] = useState("calendar");
    const events = useApi(client, (c) => c.getSchedulerEvents(), 10000);
    const projects = useApi(client, (c) => c.getProjects(), 15000);
    const tasks = useApi(client, (c) => c.getSchedulerTasks(), 10000);
    const [actionMsg, setActionMsg] = useState<string | null>(null);
    const eventNav = useListNavigation(events.data?.length ?? 0, focused && subTab === "calendar");

    useInput((input, key) => {
        if (!focused) return;
        if (key.tab) {
            const tabs = ["calendar", "projects", "board", "timeline"];
            const idx = tabs.indexOf(subTab);
            setSubTab(tabs[(idx + 1) % tabs.length]!);
        }
        if (subTab === "calendar" && input === "d" && events.data?.[eventNav.selectedIndex]) {
            const evt = events.data[eventNav.selectedIndex]!;
            client.deleteSchedulerEvent(evt.id)
                .then(() => { setActionMsg(`Deleted: ${evt.title}`); events.refresh(); })
                .catch((e: Error) => setActionMsg(`Error: ${e.message}`));
        }
    });

    React.useEffect(() => {
        if (!actionMsg) return;
        const t = setTimeout(() => setActionMsg(null), 3000);
        return () => clearTimeout(t);
    }, [actionMsg]);

    // Group tasks by column for Kanban
    const kanbanData: Record<string, Array<Record<string, unknown>>> = {};
    for (const col of KANBAN_COLS) kanbanData[col] = [];
    if (tasks.data) {
        for (const task of tasks.data) {
            const col = String(task.status ?? "Backlog");
            const bucket = KANBAN_COLS.includes(col) ? col : "Backlog";
            kanbanData[bucket]!.push(task);
        }
    }

    return (
        <Box flexDirection="column">
            <SubTabBar
                tabs={[
                    { id: "calendar", label: `Calendar (${events.data?.length ?? 0})` },
                    { id: "projects", label: `Projects (${projects.data?.length ?? 0})` },
                    { id: "board", label: "Board" },
                    { id: "timeline", label: "Timeline" },
                ]}
                activeTab={subTab}
                onSelect={setSubTab}
            />

            {actionMsg && (
                <Box marginBottom={1}>
                    <Text color={colors.info}>{symbols.arrow} {actionMsg}</Text>
                </Box>
            )}

            {/* Calendar view */}
            {subTab === "calendar" && (
                <Box flexDirection="column">
                    <Box marginBottom={1}>
                        <Text color={colors.muted}>d: delete event | j/k: navigate</Text>
                    </Box>
                    {events.loading && <Loading />}
                    {events.error && <ErrorBox message={events.error} />}
                    {events.data && (
                        <DataTable
                            data={events.data}
                            columns={[
                                { header: "Title", accessor: "title", width: 28 },
                                { header: "Category", accessor: "category", width: 12 },
                                {
                                    header: "Start",
                                    accessor: ((r: Record<string, unknown>) =>
                                        r.start ? new Date(r.start as string).toLocaleString() : ""),
                                    width: 22,
                                },
                                {
                                    header: "End",
                                    accessor: ((r: Record<string, unknown>) =>
                                        r.end ? new Date(r.end as string).toLocaleString() : ""),
                                    width: 22,
                                },
                                {
                                    header: "Recurring",
                                    accessor: ((r: Record<string, unknown>) =>
                                        r.recurring ? `${symbols.check} ${r.cron ?? ""}` : symbols.cross),
                                    width: 14,
                                },
                            ]}
                            selectedIndex={eventNav.selectedIndex}
                            emptyMessage="No scheduled events."
                        />
                    )}
                </Box>
            )}

            {/* Projects */}
            {subTab === "projects" && (
                <Box flexDirection="column">
                    {projects.loading && <Loading />}
                    {projects.error && <ErrorBox message={projects.error} />}
                    {projects.data && (
                        <DataTable
                            data={projects.data}
                            columns={[
                                { header: "Project", accessor: "name", width: 24 },
                                {
                                    header: "Status",
                                    accessor: "status",
                                    width: 12,
                                    color: ((r: Record<string, unknown>) => {
                                        const s = String(r.status);
                                        return s === "active" ? colors.success : s === "completed" ? colors.info : colors.muted;
                                    }),
                                },
                                { header: "Milestones", accessor: "milestones", width: 12 },
                                { header: "Tasks", accessor: "tasks", width: 8 },
                            ]}
                            emptyMessage="No projects."
                        />
                    )}
                </Box>
            )}

            {/* Kanban Board */}
            {subTab === "board" && (
                <Box flexDirection="column">
                    {tasks.loading && <Loading />}
                    {tasks.error && <ErrorBox message={tasks.error} />}
                    <Box gap={2}>
                        {KANBAN_COLS.map((col) => (
                            <Box key={col} flexDirection="column" width={20}>
                                <Text bold color={colors.brand}>{col}</Text>
                                <Text color={colors.border}>{"─".repeat(18)}</Text>
                                {kanbanData[col]!.length === 0 && (
                                    <Text color={colors.muted}>(empty)</Text>
                                )}
                                {kanbanData[col]!.map((task, i) => (
                                    <Box key={i} marginBottom={0}>
                                        <Text color={colors.text} wrap="truncate">
                                            {symbols.bullet} {String(task.title ?? task.name ?? `Task ${i + 1}`)}
                                        </Text>
                                    </Box>
                                ))}
                            </Box>
                        ))}
                    </Box>
                </Box>
            )}

            {/* Timeline */}
            {subTab === "timeline" && (
                <Box flexDirection="column">
                    {events.loading && <Loading />}
                    {events.error && <ErrorBox message={events.error} />}
                    {events.data?.map((evt, i) => {
                        const start = evt.start ? new Date(evt.start).toLocaleDateString() : "?";
                        const end = evt.end ? new Date(evt.end).toLocaleDateString() : start;
                        return (
                            <Box key={evt.id || i}>
                                <Text color={colors.muted}>{start}</Text>
                                <Text color={colors.brand}> {"━".repeat(4)} </Text>
                                <Text color={colors.text}>{evt.title}</Text>
                                <Text color={colors.brand}> {"━".repeat(4)} </Text>
                                <Text color={colors.muted}>{end}</Text>
                            </Box>
                        );
                    })}
                    {events.data?.length === 0 && (
                        <Text color={colors.muted}>No events for timeline.</Text>
                    )}
                </Box>
            )}
        </Box>
    );
}

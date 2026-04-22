/**
 * PRISM TUI — Shared UI components: Panel, StatusBadge, DataTable, Sparkline, etc.
 */
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { colors, symbols, borders, statusColor, tierColor } from "../theme.js";

/* ------------------------------------------------------------------ */
/*  StatusBadge                                                        */
/* ------------------------------------------------------------------ */

export function StatusBadge({ status, label }: { status: string; label?: string }): React.JSX.Element {
    const c = statusColor(status);
    return (
        <Text color={c}>
            {symbols.bullet} {label ?? status}
        </Text>
    );
}

/* ------------------------------------------------------------------ */
/*  Panel — collapsible section                                        */
/* ------------------------------------------------------------------ */

export function Panel({
    title,
    children,
    defaultOpen = true,
    badge,
}: {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
    badge?: string;
}): React.JSX.Element {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text color={colors.brand} bold>
                    {open ? "▼" : "▶"} {title}
                </Text>
                {badge && (
                    <Text color={colors.muted}> [{badge}]</Text>
                )}
            </Box>
            {open && (
                <Box flexDirection="column" marginLeft={2}>
                    {children}
                </Box>
            )}
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  DataTable — simple tabular display                                 */
/* ------------------------------------------------------------------ */

export interface Column {
    header: string;
    accessor: string | ((row: Record<string, unknown>) => string);
    width?: number;
    color?: string | ((row: Record<string, unknown>) => string);
}

export function DataTable({
    data,
    columns,
    selectedIndex,
    emptyMessage = "No data",
}: {
    data: object[];
    columns: Column[];
    selectedIndex?: number;
    emptyMessage?: string;
}): React.JSX.Element {
    if (data.length === 0) {
        return <Text color={colors.muted}>{emptyMessage}</Text>;
    }

    const getValue = (row: object, col: Column): string => {
        if (typeof col.accessor === "function") return col.accessor(row as Record<string, unknown>);
        const v = (row as Record<string, unknown>)[col.accessor];
        return v == null ? "" : String(v);
    };

    const getColor = (row: object, col: Column): string | undefined => {
        if (!col.color) return undefined;
        if (typeof col.color === "function") return col.color(row as Record<string, unknown>);
        return col.color;
    };

    return (
        <Box flexDirection="column">
            {/* Header */}
            <Box>
                {columns.map((col, i) => (
                    <Box key={i} width={col.width ?? 16}>
                        <Text bold color={colors.text}>
                            {col.header}
                        </Text>
                    </Box>
                ))}
            </Box>
            <Text color={colors.border}>
                {columns.map((col) => borders.top.repeat(col.width ?? 16)).join(" ")}
            </Text>
            {/* Rows */}
            {data.map((row, ri) => (
                <Box key={ri}>
                    {selectedIndex === ri && <Text color={colors.brand}>{symbols.arrow} </Text>}
                    {selectedIndex !== ri && selectedIndex !== undefined && <Text>  </Text>}
                    {columns.map((col, ci) => (
                        <Box key={ci} width={col.width ?? 16}>
                            <Text color={getColor(row, col)} wrap="truncate">
                                {getValue(row, col)}
                            </Text>
                        </Box>
                    ))}
                </Box>
            ))}
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  Sparkline — inline ASCII chart                                     */
/* ------------------------------------------------------------------ */

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

export function Sparkline({ values, color = colors.info }: { values: number[]; color?: string }): React.JSX.Element {
    if (values.length === 0) return <Text color={colors.muted}>-</Text>;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const spark = values
        .map((v) => {
            const idx = Math.round(((v - min) / range) * (SPARK_CHARS.length - 1));
            return SPARK_CHARS[idx];
        })
        .join("");
    return <Text color={color}>{spark}</Text>;
}

/* ------------------------------------------------------------------ */
/*  ProgressBar                                                        */
/* ------------------------------------------------------------------ */

export function ProgressBar({
    percent,
    width = 20,
    color = colors.brand,
}: {
    percent: number;
    width?: number;
    color?: string;
}): React.JSX.Element {
    const filled = Math.round(Math.max(0, Math.min(1, percent)) * width);
    const empty = width - filled;
    return (
        <Text>
            <Text color={color}>{"█".repeat(filled)}</Text>
            <Text color={colors.muted}>{"░".repeat(empty)}</Text>
            <Text color={colors.textDim}> {(percent * 100).toFixed(0)}%</Text>
        </Text>
    );
}

/* ------------------------------------------------------------------ */
/*  KeyValue — label: value pair                                       */
/* ------------------------------------------------------------------ */

export function KeyValue({
    label,
    value,
    valueColor,
}: {
    label: string;
    value: string;
    valueColor?: string;
}): React.JSX.Element {
    return (
        <Box>
            <Text color={colors.muted}>{label}: </Text>
            <Text color={valueColor ?? colors.text}>{value}</Text>
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  Loading spinner                                                    */
/* ------------------------------------------------------------------ */

export function Loading({ label = "Loading..." }: { label?: string }): React.JSX.Element {
    return (
        <Box>
            <Text color={colors.brand}>
                <Spinner type="dots" />
            </Text>
            <Text color={colors.muted}> {label}</Text>
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  ErrorBox                                                           */
/* ------------------------------------------------------------------ */

export function ErrorBox({ message }: { message: string }): React.JSX.Element {
    return (
        <Box borderStyle="single" borderColor={colors.error} paddingX={1}>
            <Text color={colors.error}>{symbols.cross} {message}</Text>
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  Header bar                                                         */
/* ------------------------------------------------------------------ */

export function Header({
    profile,
    connected,
    version,
}: {
    profile: string;
    connected: boolean;
    version: string;
}): React.JSX.Element {
    const profColor = profile === "business" ? colors.business : colors.individual;
    return (
        <Box borderStyle="single" borderColor={colors.brand} paddingX={1} justifyContent="space-between">
            <Box>
                <Text bold color={colors.brand}>PRISM</Text>
                <Text color={colors.muted}> v{version}</Text>
            </Box>
            <Box>
                <Text color={profColor}>
                    {symbols.bullet} {profile.toUpperCase()}
                </Text>
                <Text> </Text>
                <Text color={connected ? colors.success : colors.error}>
                    {connected ? `${symbols.connection} Connected` : `${symbols.circle} Disconnected`}
                </Text>
            </Box>
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  TabBar                                                             */
/* ------------------------------------------------------------------ */

export function TabBar({
    tabs,
    activeTab,
    onSelect,
}: {
    tabs: Array<{ id: string; label: string; shortcut: string }>;
    activeTab: string;
    onSelect: (id: string) => void;
}): React.JSX.Element {
    return (
        <Box flexWrap="wrap" gap={1}>
            {tabs.map((tab) => {
                const active = tab.id === activeTab;
                return (
                    <Box key={tab.id}>
                        <Text
                            color={active ? colors.brand : colors.muted}
                            bold={active}
                            inverse={active}
                        >
                            {" "}{tab.shortcut}:{tab.label}{" "}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  StatusBar — bottom status line                                     */
/* ------------------------------------------------------------------ */

export function StatusBar({
    left,
    center,
    right,
}: {
    left?: string;
    center?: string;
    right?: string;
}): React.JSX.Element {
    return (
        <Box justifyContent="space-between" paddingX={1}>
            <Text color={colors.muted}>{left ?? ""}</Text>
            <Text color={colors.muted}>{center ?? ""}</Text>
            <Text color={colors.muted}>{right ?? ""}</Text>
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  HelpOverlay — keyboard shortcut reference                          */
/* ------------------------------------------------------------------ */

export function HelpOverlay(): React.JSX.Element {
    return (
        <Box flexDirection="column" borderStyle="double" borderColor={colors.brand} paddingX={2} paddingY={1}>
            <Text bold color={colors.brand}>Keyboard Shortcuts</Text>
            <Text> </Text>
            <Text color={colors.text}>1-9, 0, -, =   Switch tabs</Text>
            <Text color={colors.text}>Tab / Shift+Tab Focus cycle</Text>
            <Text color={colors.text}>j / k / ↑ / ↓  Navigate lists</Text>
            <Text color={colors.text}>g / G           Jump to top/bottom</Text>
            <Text color={colors.text}>Enter           Select / Confirm</Text>
            <Text color={colors.text}>Escape          Back / Dismiss</Text>
            <Text color={colors.text}>r               Refresh current view</Text>
            <Text color={colors.text}>?               Toggle this help</Text>
            <Text color={colors.text}>q               Quit PRISM TUI</Text>
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  SectionHeader — titled divider within a tab                        */
/* ------------------------------------------------------------------ */

export function SectionHeader({ title }: { title: string }): React.JSX.Element {
    return (
        <Box marginTop={1} marginBottom={0}>
            <Text bold color={colors.brand}>
                {borders.teeLeft}{borders.top}{borders.top} {title} {borders.top.repeat(30)}
            </Text>
        </Box>
    );
}

/* ------------------------------------------------------------------ */
/*  SubTabBar — for tabs within tabs (e.g. Tools sub-tabs)             */
/* ------------------------------------------------------------------ */

export function SubTabBar({
    tabs,
    activeTab,
    onSelect,
}: {
    tabs: Array<{ id: string; label: string }>;
    activeTab: string;
    onSelect: (id: string) => void;
}): React.JSX.Element {
    return (
        <Box gap={1} marginBottom={1}>
            {tabs.map((tab) => {
                const active = tab.id === activeTab;
                return (
                    <Box key={tab.id}>
                        <Text
                            color={active ? colors.info : colors.muted}
                            bold={active}
                            underline={active}
                        >
                            {tab.label}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}

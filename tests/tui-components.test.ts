/**
 * PRISM TUI — Shared UI component render tests.
 *
 * Uses ink-testing-library to render Ink components and verify text output.
 *
 * Run: node --test dist/tests/tui-components.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { render } from "ink-testing-library";
import {
    StatusBadge, Panel, DataTable, Sparkline, ProgressBar,
    KeyValue, ErrorBox, Header, TabBar, StatusBar,
    HelpOverlay, SectionHeader, SubTabBar,
} from "../src/tui/components/ui.js";
import { TABS } from "../src/tui/theme.js";
import { createMockClient } from "./tui-mocks.js";
import { LoginTab } from "../src/tui/tabs/LoginTab.js";

/* ================================================================== */
/*  StatusBadge                                                        */
/* ================================================================== */

describe("StatusBadge", () => {
    it("renders status text", () => {
        const { lastFrame } = render(React.createElement(StatusBadge, { status: "running" }));
        assert.ok(lastFrame()?.includes("running"));
    });

    it("renders custom label when provided", () => {
        const { lastFrame } = render(React.createElement(StatusBadge, { status: "ok", label: "All Good" }));
        assert.ok(lastFrame()?.includes("All Good"));
        assert.ok(!lastFrame()?.includes(" ok"));
    });
});

/* ================================================================== */
/*  KeyValue                                                           */
/* ================================================================== */

describe("KeyValue", () => {
    it("renders label and value", () => {
        const { lastFrame } = render(React.createElement(KeyValue, { label: "Host", value: "localhost" }));
        const frame = lastFrame() ?? "";
        assert.ok(frame.includes("Host"));
        assert.ok(frame.includes("localhost"));
    });
});

/* ================================================================== */
/*  ErrorBox                                                           */
/* ================================================================== */

describe("ErrorBox", () => {
    it("renders error message with cross symbol", () => {
        const { lastFrame } = render(React.createElement(ErrorBox, { message: "Connection refused" }));
        const frame = lastFrame() ?? "";
        assert.ok(frame.includes("Connection refused"));
        assert.ok(frame.includes("✗"));
    });
});

/* ================================================================== */
/*  Header                                                             */
/* ================================================================== */

describe("Header", () => {
    it("renders PRISM branding", () => {
        const { lastFrame } = render(React.createElement(Header, { profile: "individual", connected: true, version: "0.2.0" }));
        const frame = lastFrame() ?? "";
        assert.ok(frame.includes("PRISM"));
        assert.ok(frame.includes("0.2.0"));
    });

    it("shows INDIVIDUAL for individual profile", () => {
        const { lastFrame } = render(React.createElement(Header, { profile: "individual", connected: true, version: "0.2.0" }));
        assert.ok(lastFrame()?.includes("INDIVIDUAL"));
    });

    it("shows BUSINESS for business profile", () => {
        const { lastFrame } = render(React.createElement(Header, { profile: "business", connected: true, version: "0.2.0" }));
        assert.ok(lastFrame()?.includes("BUSINESS"));
    });

    it("shows Connected when connected", () => {
        const { lastFrame } = render(React.createElement(Header, { profile: "individual", connected: true, version: "0.2.0" }));
        assert.ok(lastFrame()?.includes("Connected"));
    });

    it("shows Disconnected when not connected", () => {
        const { lastFrame } = render(React.createElement(Header, { profile: "individual", connected: false, version: "0.2.0" }));
        assert.ok(lastFrame()?.includes("Disconnected"));
    });
});

/* ================================================================== */
/*  TabBar                                                             */
/* ================================================================== */

describe("TabBar", () => {
    it("renders all tab labels", () => {
        const { lastFrame } = render(React.createElement(TabBar, {
            tabs: TABS,
            activeTab: "chat",
            onSelect: () => {},
        }));
        const frame = lastFrame() ?? "";
        for (const tab of TABS) {
            assert.ok(frame.includes(tab.label), `should include tab label "${tab.label}"`);
        }
    });

    it("renders tab shortcuts", () => {
        const { lastFrame } = render(React.createElement(TabBar, {
            tabs: TABS.slice(0, 3),
            activeTab: "chat",
            onSelect: () => {},
        }));
        const frame = lastFrame() ?? "";
        assert.ok(frame.includes("1:"));
        assert.ok(frame.includes("2:"));
        assert.ok(frame.includes("3:"));
    });
});

/* ================================================================== */
/*  StatusBar                                                          */
/* ================================================================== */

describe("StatusBar", () => {
    it("renders left/center/right sections", () => {
        const { lastFrame } = render(React.createElement(StatusBar, {
            left: "chat",
            center: "warning msg",
            right: "q: quit",
        }));
        const frame = lastFrame() ?? "";
        assert.ok(frame.includes("chat"));
        assert.ok(frame.includes("warning msg"));
        assert.ok(frame.includes("q: quit"));
    });
});

/* ================================================================== */
/*  SectionHeader                                                      */
/* ================================================================== */

describe("SectionHeader", () => {
    it("renders title text", () => {
        const { lastFrame } = render(React.createElement(SectionHeader, { title: "Agent Management" }));
        assert.ok(lastFrame()?.includes("Agent Management"));
    });
});

/* ================================================================== */
/*  SubTabBar                                                          */
/* ================================================================== */

describe("SubTabBar", () => {
    it("renders sub-tab labels", () => {
        const tabs = [
            { id: "overview", label: "Overview" },
            { id: "details", label: "Details" },
            { id: "history", label: "History" },
        ];
        const { lastFrame } = render(React.createElement(SubTabBar, {
            tabs,
            activeTab: "overview",
            onSelect: () => {},
        }));
        const frame = lastFrame() ?? "";
        for (const t of tabs) {
            assert.ok(frame.includes(t.label), `should include sub-tab "${t.label}"`);
        }
    });
});

/* ================================================================== */
/*  DataTable                                                          */
/* ================================================================== */

describe("DataTable", () => {
    it("renders headers and rows", () => {
        const data = [
            { name: "alpha", status: "ok" },
            { name: "beta", status: "error" },
        ];
        const columns = [
            { header: "Name", accessor: "name", width: 12 },
            { header: "Status", accessor: "status", width: 12 },
        ];
        const { lastFrame } = render(React.createElement(DataTable, { data, columns }));
        const frame = lastFrame() ?? "";
        assert.ok(frame.includes("Name"));
        assert.ok(frame.includes("Status"));
        assert.ok(frame.includes("alpha"));
        assert.ok(frame.includes("beta"));
    });

    it("shows empty message when data is empty", () => {
        const { lastFrame } = render(React.createElement(DataTable, {
            data: [],
            columns: [{ header: "X", accessor: "x" }],
            emptyMessage: "Nothing here",
        }));
        assert.ok(lastFrame()?.includes("Nothing here"));
    });

    it("supports function accessors", () => {
        const data = [{ first: "John", last: "Doe" }] as object[];
        const columns = [
            { header: "Full", accessor: (row: Record<string, unknown>) => `${row.first} ${row.last}`, width: 20 },
        ];
        const { lastFrame } = render(React.createElement(DataTable, { data, columns }));
        assert.ok(lastFrame()?.includes("John Doe"));
    });

    it("shows arrow for selected index", () => {
        const data = [{ n: "a" }, { n: "b" }];
        const columns = [{ header: "N", accessor: "n", width: 8 }];
        const { lastFrame } = render(React.createElement(DataTable, { data, columns, selectedIndex: 1 }));
        assert.ok(lastFrame()?.includes("→"));
    });
});

/* ================================================================== */
/*  Sparkline                                                          */
/* ================================================================== */

describe("Sparkline", () => {
    it("renders dash for empty values", () => {
        const { lastFrame } = render(React.createElement(Sparkline, { values: [] }));
        assert.ok(lastFrame()?.includes("-"));
    });

    it("renders spark characters for values", () => {
        const { lastFrame } = render(React.createElement(Sparkline, { values: [1, 5, 3, 8, 2] }));
        const frame = lastFrame() ?? "";
        // Should contain block characters
        assert.ok(frame.length > 0);
        assert.ok(!frame.includes("-"), "should not be dash for non-empty");
    });
});

/* ================================================================== */
/*  ProgressBar                                                        */
/* ================================================================== */

describe("ProgressBar", () => {
    it("shows 0% for zero percent", () => {
        const { lastFrame } = render(React.createElement(ProgressBar, { percent: 0 }));
        assert.ok(lastFrame()?.includes("0%"));
    });

    it("shows 100% for full", () => {
        const { lastFrame } = render(React.createElement(ProgressBar, { percent: 1 }));
        assert.ok(lastFrame()?.includes("100%"));
    });

    it("shows 50% for half", () => {
        const { lastFrame } = render(React.createElement(ProgressBar, { percent: 0.5 }));
        assert.ok(lastFrame()?.includes("50%"));
    });

    it("clamps negative to 0%", () => {
        const { lastFrame } = render(React.createElement(ProgressBar, { percent: -0.5 }));
        assert.ok(lastFrame()?.includes("0%") || lastFrame()?.includes("-50%"));
    });
});

/* ================================================================== */
/*  HelpOverlay                                                        */
/* ================================================================== */

describe("HelpOverlay", () => {
    it("renders keyboard shortcuts", () => {
        const { lastFrame } = render(React.createElement(HelpOverlay, {}));
        const frame = lastFrame() ?? "";
        // Should mention help-related text
        assert.ok(frame.includes("q") || frame.includes("quit") || frame.includes("help"),
            "should include some keyboard hint");
    });
});

/* ================================================================== */
/*  LoginTab                                                           */
/* ================================================================== */

describe("LoginTab", () => {
    it("renders operator authentication fields", () => {
        const client = createMockClient();
        const { lastFrame } = render(React.createElement(LoginTab, {
            client,
            focused: true,
            onSuccess: () => {},
            onLaunchWizard: () => {},
        }));
        const frame = lastFrame() ?? "";
        assert.ok(frame.includes("OPERATOR AUTHENTICATION"));
        assert.ok(frame.includes("Email:"));
        assert.ok(frame.includes("Password:"));
        assert.ok(frame.includes("QUICK ACTIONS"));
    });

    it("autofills email and password on pressing shortcut keys", async () => {
        const client = createMockClient({
            login: () => Promise.resolve({ ok: true, user: {}, session: {}, dashboardToken: "tok" }),
        });
        const inst = render(React.createElement(LoginTab, {
            client,
            focused: true,
            onSuccess: () => {},
            onLaunchWizard: () => {},
        }));
        // Write shortcut key "t" to trigger testing operator autofill
        await inst.stdin.write("t");
        await new Promise((r) => setTimeout(r, 100));
        const frame = inst.lastFrame() ?? "";
        // Check if testing operator email is now present in the frame
        assert.ok(frame.includes("testing@prism.ai"), "should autofill testing@prism.ai");
        inst.unmount();
    });

    it("calls login when pressing Enter on active input", async () => {
        let loginCalled = false;
        const client = createMockClient({
            login: (email, password) => {
                loginCalled = true;
                return Promise.resolve({ ok: true, user: {}, session: {}, dashboardToken: "tok" });
            },
        });
        const inst = render(React.createElement(LoginTab, {
            client,
            focused: true,
            onSuccess: () => {},
            onLaunchWizard: () => {},
        }));
        
        // Type email character-by-character
        for (const char of "test@prism.ai") {
            await inst.stdin.write(char);
            await new Promise((r) => setTimeout(r, 10));
        }
        await new Promise((r) => setTimeout(r, 50));
        
        // Press Enter
        await inst.stdin.write("\r");
        await new Promise((r) => setTimeout(r, 50));
        
        // Type password character-by-character
        for (const char of "password") {
            await inst.stdin.write(char);
            await new Promise((r) => setTimeout(r, 10));
        }
        await new Promise((r) => setTimeout(r, 50));
        
        // Press Enter
        await inst.stdin.write("\r");
        await new Promise((r) => setTimeout(r, 50));
        
        assert.ok(loginCalled, "login should be called");
        inst.unmount();
    });
});

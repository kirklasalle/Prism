import React, { useState, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import type { PrismClient } from "../api/prism-client.js";
import { colors, symbols, PRISM_LOGO } from "../theme.js";
import { ErrorBox, Loading } from "../components/ui.js";

interface LoginTabProps {
    client: PrismClient;
    focused: boolean;
    onSuccess: (token: string | null, cookie: string | null) => void;
    onLaunchWizard: () => void;
}

export function LoginTab({
    client,
    focused,
    onSuccess,
    onLaunchWizard,
}: LoginTabProps): React.JSX.Element {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    
    // 0: Email field, 1: Password field, 2: Autofill Admin, 3: Autofill Testing, 4: Launch Wizard, 5: Quit
    const [activeIndex, setActiveIndex] = useState(0);
    const { exit } = useApp();

    const handleQuit = useCallback(() => {
        exit();
        process.exit(0);
    }, [exit]);

    const handleLogin = useCallback(async (customEmail?: string, customPassword?: string) => {
        const targetEmail = (customEmail ?? email).trim();
        const targetPassword = customPassword ?? password;

        if (!targetEmail || !targetPassword) {
            setError("Email and Password are required.");
            return;
        }

        setError(null);
        setSubmitting(true);

        try {
            const res = await client.login(targetEmail, targetPassword);
            if (res.ok) {
                // PrismClient request automatically stores the cookie.
                // We also pass back the token if any.
                onSuccess(res.dashboardToken || null, client.getCookie());
            } else {
                setError("Authentication failed.");
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSubmitting(false);
        }
    }, [client, email, password, onSuccess]);
 
    const handleReturnKey = useCallback(() => {
        if (activeIndex === 0) {
            if (!password) {
                setActiveIndex(1);
            } else {
                handleLogin();
            }
        } else if (activeIndex === 1) {
            if (!email) {
                setActiveIndex(0);
            } else {
                handleLogin();
            }
        } else if (activeIndex === 2) {
            setEmail("admin@prism.ai");
            setPassword("admin");
            handleLogin("admin@prism.ai", "admin");
        } else if (activeIndex === 3) {
            setEmail("testing@prism.ai");
            setPassword("testing");
            handleLogin("testing@prism.ai", "testing");
        } else if (activeIndex === 4) {
            onLaunchWizard();
        } else if (activeIndex === 5) {
            handleQuit();
        }
    }, [activeIndex, email, password, handleLogin, onLaunchWizard, handleQuit]);

    useInput((input, key) => {
        if (!focused || submitting) return;

        if (key.downArrow || (key.tab && !key.shift)) {
            setActiveIndex((i) => (i + 1) % 6);
            return;
        }
        if (key.upArrow || (key.tab && key.shift)) {
            setActiveIndex((i) => (i - 1 + 6) % 6);
            return;
        }

        if (key.return) {
            if (activeIndex !== 0 && activeIndex !== 1) {
                handleReturnKey();
            }
            return;
        }

        if (key.escape) {
            handleQuit();
            return;
        }

        // Quick profile shortcuts (only if not typing in text fields)
        if (activeIndex !== 0 && activeIndex !== 1) {
            if (input === "a" || input === "A") {
                setEmail("admin@prism.ai");
                setPassword("admin");
                handleLogin("admin@prism.ai", "admin");
            } else if (input === "t" || input === "T") {
                setEmail("testing@prism.ai");
                setPassword("testing");
                handleLogin("testing@prism.ai", "testing");
            } else if (input === "w" || input === "W") {
                onLaunchWizard();
            } else if (input === "q" || input === "Q") {
                handleQuit();
            }
        }
    });

    return (
        <Box flexDirection="column" alignItems="center" justifyContent="center" width="100%">
            <Box marginBottom={1}>
                <Text color={colors.brand}>{PRISM_LOGO}</Text>
            </Box>
            <Box marginBottom={1}>
                <Text bold color={colors.text}>
                    OPERATOR AUTHENTICATION
                </Text>
            </Box>

            {error && (
                <Box width={50} marginBottom={1}>
                    <ErrorBox message={error} />
                </Box>
            )}

            <Box width={50} flexDirection="column" borderStyle="single" borderColor={colors.brandDim} paddingX={2} paddingY={1} marginBottom={1}>
                {/* Email Field */}
                <Box marginBottom={1}>
                    <Text color={activeIndex === 0 ? colors.brand : colors.muted} bold={activeIndex === 0}>
                        {activeIndex === 0 ? `${symbols.arrow} Email: ` : "  Email: "}
                    </Text>
                    {activeIndex === 0 ? (
                        <TextInput
                            value={email}
                            onChange={setEmail}
                            placeholder="operator@prism.ai"
                            focus={focused}
                            onSubmit={handleReturnKey}
                        />
                    ) : (
                        <Text color={email ? colors.text : colors.muted}>
                            {email || "operator@prism.ai"}
                        </Text>
                    )}
                </Box>

                {/* Password Field */}
                <Box marginBottom={1}>
                    <Text color={activeIndex === 1 ? colors.brand : colors.muted} bold={activeIndex === 1}>
                        {activeIndex === 1 ? `${symbols.arrow} Password: ` : "  Password: "}
                    </Text>
                    {activeIndex === 1 ? (
                        <TextInput
                            value={password}
                            onChange={setPassword}
                            placeholder="••••••••"
                            mask="*"
                            focus={focused}
                            onSubmit={handleReturnKey}
                        />
                    ) : (
                        <Text color={password ? colors.text : colors.muted}>
                            {password ? "*".repeat(password.length) : "••••••••"}
                        </Text>
                    )}
                </Box>
            </Box>

            {/* Quick Actions */}
            <Box width={50} flexDirection="column" borderStyle="single" borderColor={colors.muted} paddingX={2} paddingY={1}>
                <Box marginBottom={1}>
                    <Text color={colors.muted} bold>
                        QUICK ACTIONS
                    </Text>
                </Box>

                <Box>
                    <Text color={activeIndex === 2 ? colors.brand : colors.text}>
                        {activeIndex === 2 ? `${symbols.bullet} ` : "  "}Autofill Admin Profile (admin@prism.ai)
                    </Text>
                </Box>
                <Box>
                    <Text color={activeIndex === 3 ? colors.brand : colors.text}>
                        {activeIndex === 3 ? `${symbols.bullet} ` : "  "}Autofill Testing Operator (testing@prism.ai)
                    </Text>
                </Box>
                <Box>
                    <Text color={activeIndex === 4 ? colors.brand : colors.text}>
                        {activeIndex === 4 ? `${symbols.bullet} ` : "  "}Launch Onboarding Setup Wizard
                    </Text>
                </Box>
                <Box>
                    <Text color={activeIndex === 5 ? colors.brand : colors.text}>
                        {activeIndex === 5 ? `${symbols.bullet} ` : "  "}Quit PRISM TUI
                    </Text>
                </Box>
            </Box>

            {submitting && (
                <Box marginTop={1}>
                    <Loading label="Verifying operator credentials..." />
                </Box>
            )}

            <Box marginTop={1}>
                <Text color={colors.muted}>
                    Use Tab/Arrows to navigate | Enter to select | Esc to quit
                </Text>
            </Box>
        </Box>
    );
}

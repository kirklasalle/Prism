import assert from "node:assert";
import { getSmsEmailAddress, SmsCommunicationTool } from "../src/adapters/application/sms-adapter.js";
import { InboundChannelPoller } from "../src/core/operator/services/inbound-channel-poller.js";
import { ApprovalQueue } from "../src/core/approval/approval-queue.js";
import { writePreferences, readPreferences } from "../src/core/config/workspace-resolver.js";

export async function testOperatorPresenceChannels(): Promise<void> {
    console.log("  → Testing Operator Presence and Channels");

    // 1. Gateway Address Mappings
    const attEmail = getSmsEmailAddress("123-456-7890", "att");
    assert.strictEqual(attEmail, "1234567890@txt.att.net");

    const verizonEmail = getSmsEmailAddress("+1 (987) 654-3210", "verizon");
    assert.strictEqual(verizonEmail, "19876543210@vtext.com");

    const tmobileEmail = getSmsEmailAddress("5551112222", "tmobile");
    assert.strictEqual(tmobileEmail, "5551112222@tmomail.net");

    // 2. SmsCommunicationTool Validation
    const mockGmail = {
        isConnected: true,
        sendEmail: async (to: string[], subject: string, body: string) => {
            return { messageId: "mock-id", to, subject, body };
        },
    };
    const mockOutlook = {
        isConnected: false,
        sendEmail: async () => {
            throw new Error("Should not be called");
        },
    };

    const tool = new SmsCommunicationTool(mockGmail as any, mockOutlook as any);

    // Save mock operator preferences
    const prefs = readPreferences() || { lastModified: "" };
    prefs.operatorPresence = {
        status: "online",
        autoAway: false,
        autoAwayTimeout: 10,
        smsPhone: "123-456-7890",
        smsCarrier: "att",
    };
    writePreferences(prefs);

    const res = await tool.execute({
        operation: "send_sms",
        args: {
            message: "Hello world from PRISM testing. This message will be sent through the simulated carrier gateway.",
        },
        risk: "low",
        mutatesState: false,
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.output.sentTo as string, "1234567890@txt.att.net");
    assert.strictEqual(
        res.output.message as string,
        "Hello world from PRISM testing. This message will be sent through the simulated carrier gateway.",
    );

    // 3. InboundChannelPoller & Approval Queue Resolution
    const queue = new ApprovalQueue();
    const mockChatStore = {
        listSessions: () => [{ sessionId: "test-session-1" }],
        appendMessage: () => ({ messageId: "msg-id" }),
    };
    const mockDashboardService = {
        submitChatMessage: async () => {},
    };

    const poller = new InboundChannelPoller(mockGmail, mockOutlook, queue, mockChatStore, mockDashboardService);

    // Start a pending approval
    const approvalPromise = queue.request("test-session-1", "test-ops", { detail: "test" });

    // Find the approval ID
    const pendingList = queue.list();
    assert.strictEqual(pendingList.length, 1);
    const approvalId = pendingList[0]!.id;

    // Simulate an approval email reply
    const emailMessage = {
        from: "1234567890@txt.att.net",
        subject: `Re: Request Approval [PRISM-TASK:${approvalId}]`,
        body: "APPROVE - Checked and it looks good.",
    };

    // Process email reply
    await (poller as any).processMessage(emailMessage, ["1234567890@txt.att.net"]);

    // Verify approval resolves to true
    const approved = await approvalPromise;
    assert.strictEqual(approved, true);
    assert.strictEqual(queue.list().length, 0);

    poller.stop();
}

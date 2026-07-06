import type { Tool, ToolRequest, ToolResult } from "../../core/tools/types.js";
import type { GmailOAuthAdapter } from "./email-oauth-adapter.js";
import type { OutlookOAuthAdapter } from "./outlook-oauth-adapter.js";
import { readPreferences } from "../../core/config/workspace-resolver.js";

const CARRIER_SMTP_DOMAINS: Record<string, string> = {
    att: "txt.att.net",
    verizon: "vtext.com",
    tmobile: "tmomail.net",
    sprint: "messaging.sprintpcs.com",
};

export function getSmsEmailAddress(phone: string, carrier: string): string {
    const cleanPhone = phone.replace(/[^0-9]/g, ""); // strip non-numeric
    const domain = CARRIER_SMTP_DOMAINS[carrier.toLowerCase()];
    if (!domain) throw new Error(`Unsupported carrier: ${carrier}`);
    return `${cleanPhone}@${domain}`;
}

export class SmsCommunicationTool implements Tool {
    readonly name = "sms_communication";

    constructor(
        private readonly gmailAdapter?: GmailOAuthAdapter,
        private readonly outlookAdapter?: OutlookOAuthAdapter,
    ) {}

    async execute(request: ToolRequest): Promise<ToolResult> {
        const args = request.args as {
            action?: "send_sms" | "send_email_to_sms";
            phone?: string;
            carrier?: string;
            message?: string;
            subject?: string;
        };

        const action = args.action ?? "send_sms";
        const message = args.message ?? "";

        let targetPhone = args.phone;
        let targetCarrier = args.carrier;

        // If not specified, fall back to stored operator presence configuration
        if (!targetPhone || !targetCarrier) {
            const prefs = readPreferences();
            if (prefs?.operatorPresence?.smsPhone && prefs?.operatorPresence?.smsCarrier) {
                targetPhone = targetPhone || prefs.operatorPresence.smsPhone;
                targetCarrier = targetCarrier || prefs.operatorPresence.smsCarrier;
            }
        }

        if (!targetPhone) {
            return { ok: false, output: { error: "No mobile number specified or configured for operator." } };
        }
        if (!targetCarrier) {
            return { ok: false, output: { error: "No carrier gateway specified or configured for operator." } };
        }

        try {
            const smsEmail = getSmsEmailAddress(targetPhone, targetCarrier);

            // Format subject if not provided, including unique transaction tag for two-way tracking
            const subject = args.subject || `[PRISM-TASK:sms-${Date.now().toString(36)}]`;

            // Max 150 characters for SMS limit
            const smsBody = message.substring(0, 150);

            const useGmail = this.gmailAdapter?.isConnected === true;
            const useOutlook = !useGmail && this.outlookAdapter?.isConnected === true;

            let result: unknown;
            if (useGmail) {
                result = await this.gmailAdapter!.sendEmail([smsEmail], subject, smsBody);
            } else if (useOutlook) {
                result = await this.outlookAdapter!.sendEmail([smsEmail], subject, smsBody);
            } else {
                return {
                    ok: false,
                    output: {
                        error: "No active email channel (Gmail or Outlook) is connected. Please connect a channel first.",
                    },
                };
            }

            return {
                ok: true,
                output: {
                    sentTo: smsEmail,
                    message: smsBody,
                    result,
                },
                sideEffects: [{ type: "network", description: `SMS relay sent to ${smsEmail} via connected channel` }],
            };
        } catch (error: any) {
            return {
                ok: false,
                output: { error: `Failed to dispatch SMS relay: ${error.message || error}` },
            };
        }
    }
}

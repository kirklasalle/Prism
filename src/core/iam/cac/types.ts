/**
 * PRISM CAC Authentication — Core Types & Interfaces
 *
 * Defines the type system for Common Access Card (CAC) authentication flows,
 * certificate validation, and secure operator session management. Integrates
 * with PRISM's existing IAM infrastructure to provide enterprise-grade
 * authentication with full audit trail and traceability.
 *
 * CAC authentication supports both hardware card readers and certificate-based
 * authentication for secure operator workflows.
 */

export type CacAuthMethod = "card_reader" | "certificate" | "mock_development";

export type CacSessionStatus = "initializing" | "authenticated" | "active" | "suspended" | "terminated" | "expired";

export type CacSecurityLevel = "unclassified" | "confidential" | "secret" | "top_secret";

export type CacOperatorPrivilege = "read_only" | "operator" | "administrator" | "emergency";

/**
 * CAC Certificate Information extracted from the authentication process.
 */
export interface CacCertificateInfo {
    /** Common Name from certificate subject */
    commonName: string;
    /** Email address from certificate subject alternative name */
    email: string;
    /** CAC ID number */
    cacId: string;
    /** Certificate serial number */
    serialNumber: string;
    /** Certificate issuer distinguished name */
    issuer: string;
    /** Certificate not valid before timestamp */
    notBefore: string;
    /** Certificate not valid after timestamp */
    notAfter: string;
    /** Certificate thumbprint (SHA-256) */
    thumbprint: string;
    /** Raw certificate data (PEM format) */
    certificatePem: string;
    /** Certificate chain validation status */
    chainValid: boolean;
    /** Certificate revocation status */
    revocationStatus: "valid" | "revoked" | "unknown";
}

/**
 * CAC Authentication Request containing all necessary information
 * for initiating a CAC authentication flow.
 */
export interface CacAuthRequest {
    /** Authentication method to use */
    method: CacAuthMethod;
    /** Certificate data (for certificate method) */
    certificateData?: string;
    /** PIN for card reader method */
    pin?: string;
    /** Requested security level for the session */
    securityLevel: CacSecurityLevel;
    /** Requested operator privilege level */
    operatorPrivilege: CacOperatorPrivilege;
    /** Tenant ID for multi-tenant deployments */
    tenantId: string;
    /** Client IP address for audit */
    clientIp: string;
    /** User agent for audit */
    userAgent?: string;
    /** Session timeout in milliseconds (default 8 hours) */
    sessionTimeoutMs?: number;
    /** The type of session to create */
    sessionType?: "cac_only" | "computer_control" | "browser_control" | "full_control";
    /** Character ID to bind for accountability */
    characterId?: string;
    /** Additional metadata for the session */
    metadata?: Record<string, unknown>;
}

/**
 * CAC Authentication Response containing the result of authentication
 * and session establishment.
 */
export interface CacAuthResponse {
    /** Whether authentication succeeded */
    success: boolean;
    /** Error message if authentication failed */
    error?: string;
    /** Error code for programmatic handling */
    errorCode?: CacAuthErrorCode;
    /** Session ID if authentication succeeded */
    sessionId?: string;
    /** Certificate information if authentication succeeded */
    certificateInfo?: CacCertificateInfo;
    /** Established operator privilege level */
    privilegeLevel?: CacOperatorPrivilege;
    /** Security level of the established session */
    securityLevel?: CacSecurityLevel;
    /** Session expiration timestamp */
    expiresAt?: string;
    /** Additional audit information */
    auditInfo?: CacAuditInfo;
}

/**
 * CAC Authentication Error Codes for programmatic error handling.
 */
export type CacAuthErrorCode =
    | "card_not_present"
    | "invalid_pin"
    | "certificate_expired"
    | "certificate_revoked"
    | "certificate_invalid"
    | "chain_validation_failed"
    | "insufficient_privilege"
    | "session_limit_exceeded"
    | "security_policy_violation"
    | "system_error";

/**
 * CAC Session Information for active operator sessions.
 */
export interface CacSession {
    /** Unique session identifier */
    sessionId: string;
    /** Associated user ID from IAM */
    userId: string;
    /** Tenant ID */
    tenantId: string;
    /** Certificate information */
    certificateInfo: CacCertificateInfo;
    /** Current session status */
    status: CacSessionStatus;
    /** Security level of the session */
    securityLevel: CacSecurityLevel;
    /** Operator privilege level */
    privilegeLevel: CacOperatorPrivilege;
    /** Session creation timestamp */
    createdAt: string;
    /** Session last activity timestamp */
    lastActivityAt: string;
    /** Session expiration timestamp */
    expiresAt: string;
    /** Client IP address */
    clientIp: string;
    /** Associated character ID for accountability */
    characterId?: string;
    /** CAC assignment ID for traceability */
    cacAssignmentId?: string;
    /** Session metadata */
    metadata: Record<string, unknown>;
}

/**
 * CAC Audit Information for comprehensive logging and traceability.
 */
export interface CacAuditInfo {
    /** Authentication attempt ID */
    attemptId: string;
    /** Timestamp of authentication attempt */
    timestamp: string;
    /** Authentication method used */
    method: CacAuthMethod;
    /** Client IP address */
    clientIp: string;
    /** User agent string */
    userAgent?: string;
    /** Certificate serial number */
    certificateSerial?: string;
    /** Authentication result */
    result: "success" | "failure" | "error";
    /** Error details if applicable */
    errorDetails?: string;
    /** Duration of authentication process in milliseconds */
    authDurationMs: number;
    /** Additional audit metadata */
    metadata: Record<string, unknown>;
}

/**
 * CAC Security Policy configuration for operator sessions.
 */
export interface CacSecurityPolicy {
    /** Maximum concurrent sessions per user */
    maxConcurrentSessions: number;
    /** Session timeout in milliseconds */
    sessionTimeoutMs: number;
    /** Idle timeout in milliseconds */
    idleTimeoutMs: number;
    /** Maximum authentication attempts before lockout */
    maxAuthAttempts: number;
    /** Lockout duration in milliseconds */
    lockoutDurationMs: number;
    /** Required security level for specific operations */
    operationSecurityLevels: Record<string, CacSecurityLevel>;
    /** Required privilege levels for specific operations */
    operationPrivilegeLevels: Record<string, CacOperatorPrivilege>;
    /** Certificate validation requirements */
    certificateValidation: {
        requireChainValidation: boolean;
        requireRevocationCheck: boolean;
        allowedIssuers: string[];
        maximumCertificateAge: number;
    };
    /** Audit requirements */
    auditRequirements: {
        logAllOperations: boolean;
        requireApprovalFor: CacOperatorPrivilege[];
        screenshotFrequency?: number;
    };
}

/**
 * CAC Provider interface for different authentication backends
 * (hardware readers, certificate stores, development mocks).
 */
export interface CacProvider {
    /** Provider identifier */
    readonly id: string;
    /** Provider display name */
    readonly name: string;
    /** Whether the provider is available in the current environment */
    isAvailable(): Promise<boolean>;
    /** Authenticate using the provider */
    authenticate(request: CacAuthRequest): Promise<CacAuthResponse>;
    /** Validate a certificate using the provider */
    validateCertificate(certificatePem: string): Promise<{
        valid: boolean;
        info?: CacCertificateInfo;
        error?: string;
    }>;
    /** Check if a card is present (for card reader providers) */
    isCardPresent?(): Promise<boolean>;
    /** Get available certificates (for certificate store providers) */
    listCertificates?(): Promise<CacCertificateInfo[]>;
}
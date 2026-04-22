# VRGC Network Protocols & Algorithms

> VRGC = Virtually Robotic GitHub Copilot — the PRISM MCP server at `.mcp/impressioncore-vrgc/server_enhanced.py`

This document defines reusable protocol sequences that orchestrate VRGC Phase 6 web tools alongside PRISM's tier-based network command governance to solve common network operations use cases.

---

## Protocol 1: Autonomous Network Troubleshooting

**Trigger:** User reports a network symptom (e.g., "DNS timeout on port 53").

**Sequence:**

```
1. RESEARCH   → vrgc_research_assistant(topic, depth="standard")
                 Fetch known issues, documentation, and community solutions
2. DIAGNOSE   → network_exec("nslookup <target>")         [TIER 1]
               → network_exec("ping <target>")             [TIER 1]
               → network_exec("tracert <target>")          [TIER 1]
                 Run read-only diagnostics to gather local state
3. CORRELATE  → vrgc_research_assistant(symptom + diagnostic_output)
                 Correlate diagnostic output with known patterns
4. REPORT     → Generate structured remediation report with:
                 - Symptom summary
                 - Diagnostic evidence
                 - Research-backed recommendations
                 - Risk-rated remediation steps
```

**Governance:** All diagnostic commands are Tier 1 (auto-allow). Remediation that requires Tier 3 commands must be surfaced as suggestions, not auto-executed.

**Algorithm:** Longest-match command classification → tier lookup → auto-execute if tier1, prompt if tier2/3.

---

## Protocol 2: Security Posture Assessment

**Trigger:** User requests security analysis of a target URL or host.

**Sequence:**

```
1. SSL SCAN   → vrgc_web_security_scan(url, scan_type="ssl")
                 Check certificate validity, chain, and expiration
2. HEADER     → vrgc_web_security_scan(url, scan_type="headers")
                 Analyze security headers (HSTS, CSP, X-Frame-Options, etc.)
3. CVE LOOKUP → vrgc_research_assistant("CVE + <server software version>")
                 Search for known vulnerabilities
4. LOCAL NET  → network_exec("nslookup <host>")            [TIER 1]
               → network_exec("openssl s_client <host>")   [TIER 1]
                 Verify local DNS resolution and TLS handshake
5. SCORE      → Aggregate findings into a security score (0-100):
                 - Valid SSL cert:         +25
                 - HSTS header present:    +15
                 - CSP header present:     +15
                 - No known CVEs:          +25
                 - All headers secure:     +20
```

**Governance:** All operations are read-only (Tier 1 network + VRGC scan tools). No mutations.

---

## Protocol 3: Performance Baseline & Monitoring

**Trigger:** User wants to establish a performance baseline for a service.

**Sequence:**

```
1. BASELINE   → vrgc_web_performance_test(url, test_type="load_time")
                 Measure initial load time and TTFB
2. NETWORK    → network_exec("ping <host> -n 10")          [TIER 1]
               → network_exec("tracert <host>")            [TIER 1]
                 Establish local network path and latency
3. COMPARE    → vrgc_web_performance_test(url, device="mobile")
               → vrgc_web_performance_test(url, device="tablet")
                 Cross-device performance comparison
4. MONITOR    → vrgc_web_monitor(url, interval=5, type="availability")
                 Set up continuous monitoring for drift detection
5. ALERT      → If performance drifts > 20% from baseline:
                 - Emit dashboard notification
                 - Re-run Protocol 1 (troubleshooting) automatically
```

**Metrics Tracked:**

- Load time (ms) — p50, p95, p99
- TTFB (ms) — time to first byte
- Ping RTT (ms) — local network latency
- Hop count — traceroute hops to destination

---

## Protocol 4: FTP/File Transfer Governance

**Trigger:** Agent or user requests file transfer via FTP/SFTP.

**Sequence:**

```
1. ENUMERATE  → vrgc_ftp_access(server, path="/", operation="list")
                 List directory contents at target
2. APPROVE    → If download requested:
                 - Tier 2 approval required (ftp/sftp are tier2 commands)
                 - Log transfer intent with metadata
3. TRANSFER   → vrgc_ftp_access(server, path, operation="download")
                 Execute transfer via VRGC (sandboxed)
4. VERIFY     → vrgc_download_file(url, verify_integrity=true)
                 Checksum verification of downloaded content
5. LOG        → Record transfer in audit trail:
                 {server, path, size, checksum, timestamp, approvedBy}
```

**Governance:** FTP/SFTP commands are classified as Tier 2 (conditional). Upload operations would require Tier 3 approval.

---

## Protocol 5: Local Network Discovery

**Trigger:** User wants to map the local network topology.

**Sequence:**

```
1. SHARES     → network_exec("net view")                   [TIER 1]
                 Enumerate visible network shares
2. ARP TABLE  → network_exec("arp -a")                     [TIER 1]
                 List all known MAC-to-IP mappings
3. NETBIOS    → network_exec("nbtstat -n")                 [TIER 1]
                 List NetBIOS name table
4. SESSIONS   → network_exec("net session")                [TIER 2]
                 Show active sessions (requires conditional approval)
5. DEVICES    → Aggregate results into device tree:
                 - IP addresses from ARP
                 - Hostnames from NetBIOS
                 - Shares from net view
                 - Session data from net session
6. RENDER     → Display as collapsible device tree in dashboard
```

**Warning:** Network discovery results may expose sensitive topology information. The dashboard renders a "⚠ Sensitive Data" badge on discovery results.

**Governance:** Steps 1-3 are Tier 1 (auto-allow). Step 4 requires Tier 2 conditional approval.

---

## Algorithm: Command Classification (Longest Match)

The core algorithm used by `NetworkTool.classifyCommand()`:

```
INPUT:  command string "netsh interface ip set address"
OUTPUT: { tier: "tier3", mutating: true }

ALGORITHM:
  1. Tokenize command: ["netsh", "interface", "ip", "set", "address"]
  2. For each entry in NETWORK_COMMANDS:
     a. Check platform compatibility (skip if wrong OS)
     b. Compare entry.match tokens against command tokens (prefix match)
     c. If all match tokens present and this is the longest match so far, save it
  3. Return the longest match (most specific) or undefined if no match

MATCH EXAMPLES:
  "netsh interface ip set address"
    → matches "netsh" (len 1)
    → matches "netsh interface set" (len 3) — SKIPPED, tokens don't align
    → matches "netsh interface ip set" (len 4) — BEST MATCH → tier3

  "ping 8.8.8.8"
    → matches "ping" (len 1) → tier1

  "route add 10.0.0.0"
    → matches "route" (len 1) → tier2
    → matches "route add" (len 2) → tier3 — BEST MATCH
```

---

## Algorithm: Security Score Computation

```
INPUTS:  ssl_info, headers, cve_results
OUTPUT:  score (0-100), grade (A-F)

COMPUTATION:
  base_score = 0

  IF ssl_info.valid:           base_score += 25
  IF headers.hsts:             base_score += 15
  IF headers.csp:              base_score += 15
  IF cve_results.count == 0:   base_score += 25
  IF headers.x_frame_options:  base_score += 5
  IF headers.x_content_type:   base_score += 5
  IF headers.referrer_policy:  base_score += 5
  IF headers.permissions:      base_score += 5

  grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F"

  RETURN { score: base_score, grade }
```

---

## Integration Points

| Protocol | VRGC Tools Used | Network Commands | Tier Max |
|----------|----------------|-----------------|----------|
| 1. Troubleshooting | research_assistant | nslookup, ping, tracert | Tier 1 |
| 2. Security Assessment | web_security_scan, research_assistant | nslookup, openssl s_client | Tier 1 |
| 3. Performance Baseline | web_performance_test, web_monitor | ping, tracert | Tier 1 |
| 4. FTP Governance | ftp_access, download_file | ftp, sftp | Tier 2 |
| 5. Network Discovery | — | net view, arp, nbtstat, net session | Tier 2 |

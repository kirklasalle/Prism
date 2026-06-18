# Test Plan
1. [x] Click 'Admin Profile' button to login.
2. [x] Go to 'Workspace & Identity' tab.
3. [x] Assign 'Test Custom Agent' using:
    - Character: 'Test Custom Agent' [x]
    - Prism Agent Email: 'test-agent@prism.local' [x]
    - Operator Email (Personal): 'op1@prism.local' [x]
    - Operator ID (Personal): 'op-1' [x]
    - Workspace Label: 'Local Dev 1' [x]
4. [x] Click 'Assign Character' and verify 'Test Custom Agent' card in the active assignments roster.
    - Findings: 'Test Custom Agent' shows `active` status immediately. Audit log shows `dispatch` event succeeded immediately after assignment. All other pre-existing active assignments (ARIA, old Test Custom Agent) were automatically changed to `suspended`.
5. [ ] Assign a different agent:
    - Character: 'Analyst'
    - Prism Agent Email: 'analyst-agent@prism.local'
    - Operator Email (Personal): 'op2@prism.local'
    - Operator ID (Personal): 'op-2'
    - Workspace Label: 'Local Dev 2'
6. [ ] Click 'Assign Character' and verify that 'Analyst' is now active, and 'Test Custom Agent' has been suspended (no longer active).
7. [ ] Go to 'Logs & Debug' tab.
8. [ ] Verify logs show suspension of 'Test Custom Agent' and dispatch/assign of 'Analyst'.

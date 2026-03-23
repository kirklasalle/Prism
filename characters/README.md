# PRISM Characters Directory

Character briefs define the persona, capabilities, and governance constraints for each PRISM agent identity.

## Location

At runtime PRISM resolves character briefs from the **workspace** characters directory:

| Platform | Default path |
|----------|-------------|
| Windows  | `%USERPROFILE%\Documents\Prism_Refraction\characters\` |
| macOS    | `~/Documents/Prism_Refraction/characters/` |
| Linux    | `$XDG_DATA_HOME/Prism_Refraction/characters/` (fallback `~/.local/share`) |

Override with `PRISM_WORKSPACE_ROOT` to relocate the entire workspace including characters.

This source-tree `characters/` directory ships **example** briefs. They are not loaded automatically — copy or symlink them into the workspace characters directory to activate.

## Character Brief Schema

Each `.json` file in the characters directory defines one agent identity:

```jsonc
{
  // Required
  "name": "analyst",                        // unique identifier (kebab-case)
  "displayName": "Analyst Agent",            // human-readable label
  "systemPrompt": "You are a data analyst…", // base system prompt

  // Optional — governance
  "toolPermissions": {
    "allow": ["semantic_query", "web_search"],  // whitelist (if set, only these tools)
    "deny":  ["shell_exec"]                     // blacklist (evaluated after allow)
  },
  "maxRiskTier": 2,                          // highest risk tier this character may execute (1-3)
  "executionProfile": "individual",          // default profile binding

  // Optional — personality
  "persona": "concise, data-driven",         // short personality descriptor
  "greeting": "Ready for analysis.",         // initial message shown on load
  "tags": ["data", "reporting"]              // searchable tags
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique kebab-case identifier |
| `displayName` | string | yes | Human-readable name |
| `systemPrompt` | string | yes | Base system prompt injected for this character |
| `toolPermissions` | object | no | `allow` / `deny` arrays of tool names |
| `maxRiskTier` | number | no | Max risk tier (1–3). Default: profile-level setting |
| `executionProfile` | string | no | Default execution profile binding |
| `persona` | string | no | Short personality descriptor |
| `greeting` | string | no | Initial message on character load |
| `tags` | string[] | no | Searchable tags |

## Example

See `example-analyst.json` in this directory for a minimal working brief.

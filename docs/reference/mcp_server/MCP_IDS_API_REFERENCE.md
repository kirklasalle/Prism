# MCP IDS API Reference

Status: Active
Updated: 2026-07-20
Scope: PRISM IDS MCP runtime tools

## Tool Catalog

Prism integration note:

- The IDS server exposes canonical MCP tool names in the format
 `mcp_impressioncor_mcp_impressioncor_<tool-suffix>`.
- Guardian and runtime workflows commonly resolve IDS tools by suffix, such as
 `get-file-info` and `run-system-validator`.

## ids_search

Purpose: search indexed documentation using IDS conventions.

Canonical MCP name:

- mcp_impressioncor_mcp_impressioncor_search

Common Prism alias:

- ids_search

Parameters:

- query: string, required
- tags: string[], optional
- max_results: integer, optional, default 10

Returns:

- result list with file path, excerpt, score, tags
- metadata including query and result count

## ids_get_file_info

Purpose: retrieve file metadata, tags, and index visibility.

Canonical MCP name:

- mcp_impressioncor_mcp_impressioncor_get-file-info

Common Prism alias:

- ids_get_file_info

Parameters:

- file_path: string, required

Returns:

- exists flag
- index status
- tags
- metadata fields (category, status, update time when available)

## ids_list_tags

Purpose: discover tag space for controlled search.

Canonical MCP name:

- mcp_impressioncor_mcp_impressioncor_list-tags

Common Prism alias:

- ids_list_tags

Parameters:

- category: string, optional
- pattern: string, optional

Returns:

- tag list
- optional grouped statistics

## ids_get_system_status

Purpose: retrieve runtime health and index freshness.

Canonical MCP name:

- mcp_impressioncor_mcp_impressioncor_get-system-status

Common Prism alias:

- ids_get_system_status

Parameters:

- none

Returns:

- health indicator
- index counts
- last refresh timestamp
- server status details

## ids_get_documentation_stats

Purpose: aggregate documentation coverage and indexing statistics.

Canonical MCP name:

- mcp_impressioncor_mcp_impressioncor_get-documentation-stats

Common Prism alias:

- ids_get_documentation_stats

Parameters:

- none

Returns:

- total document count
- indexed coverage indicators
- category-level rollups when available

## ids_run_system_validator

Purpose: run policy and structure validation.

Canonical MCP name:

- mcp_impressioncor_mcp_impressioncor_run-system-validator

Common Prism alias:

- ids_run_system_validator

Parameters:

- validation_scope: string, optional; one of full, headers, tags, covenant

Returns:

- pass/fail summary
- validation findings
- severity-annotated issues

Mutation: No
Governance: required for release validation workflows

## ids_run_documentation_indexer

Purpose: rebuild or refresh documentation index.

Canonical MCP name:

- mcp_impressioncor_mcp_impressioncor_run-documentation-indexer

Common Prism alias:

- ids_run_documentation_indexer

Parameters:

- force_rebuild: boolean, optional

Returns:

- indexing summary
- processed counts
- failure list when present

Mutation: Yes
Governance: approval-gated in business profile

## ids_run_header_updater

Purpose: standardize and remediate header consistency.

Canonical MCP name:

- mcp_impressioncor_mcp_impressioncor_run-header-updater

Common Prism alias:

- ids_run_header_updater

Parameters:

- target_directory: string, optional
- dry_run: boolean, optional, default true

Returns:

- changed files list
- skipped files list
- warnings and errors

Mutation: Yes when dry_run is false
Governance: approval-gated in business profile

## Error Handling Contract

All IDS tool failures should return:

- error_code
- error_message
- retryable flag
- suggested_action

Recommended error_code families:

- IDS_CONFIG_*
- IDS_IO_*
- IDS_INDEX_*
- IDS_VALIDATION_*
- IDS_TIMEOUT_*

## Search Conventions

- Prefer underscore tags for stable filtering.
- Use explicit tags for governance-sensitive queries.
- For deterministic audit workflows, set max_results to a fixed value.

## Versioning

This reference is versioned with the repository and should be updated when tool schemas change.

## Related

- ../../MCP_IDS_RUNTIME_AWARENESS_FRAMEWORK.md
- MCP_IDS_OPERATIONAL_RUNBOOK.md
- MCP_IDS_SAP_ALIGNMENT.md

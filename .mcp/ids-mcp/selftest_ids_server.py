#!/usr/bin/env python3
"""
IDS MCP server self-test

Runs the local IDS server (server.py) via subprocess, sends a minimal
MCP initialize followed by tools/list, and prints a compact summary.
"""
from __future__ import annotations

import json
import os
import sys
import subprocess
import time
from pathlib import Path


def main() -> int:
    this_dir = Path(__file__).parent
    project_root = this_dir.parent.parent

    env = os.environ.copy()
    # Match VS Code mcp.json env for IDS
    env["PYTHONPATH"] = f"{project_root};{project_root / 'src'}"
    env["PYTHONUNBUFFERED"] = "1"
    env.setdefault("IDS_DEBUG", "1")

    # Start server process
    server_path = this_dir / "server.py"
    proc = subprocess.Popen(
        [sys.executable, str(server_path)],
        cwd=str(this_dir),
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    def send(req: dict) -> None:
        assert proc.stdin is not None
        proc.stdin.write(json.dumps(req) + "\n")
        proc.stdin.flush()

    def recv() -> dict:
        assert proc.stdout is not None
        line = proc.stdout.readline()
        return json.loads(line) if line else {}
    
    def call_tool(name: str, arguments: dict | None = None) -> dict:
        send({
            "jsonrpc": "2.0",
            "id": 99,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}}
        })
        res = recv()
        # Server returns JSON string in content[0].text
        content = res.get("result", {}).get("content", [])
        if content and isinstance(content, list) and content[0].get("type") == "text":
            try:
                return json.loads(content[0]["text"])  # type: ignore[arg-type]
            except Exception:
                return {"raw": content[0].get("text")}
        return res

    try:
        # 1) initialize
        init_req = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {},
        }
        send(init_req)
        init_res = recv()

        # 2) tools/list
        list_req = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {},
        }
        send(list_req)
        list_res = recv()

        # 3) Wait for readiness (poll system status)
        max_attempts = 20  # ~10 seconds with 0.5s sleep
        sys_status = {}
        for attempt in range(1, max_attempts + 1):
            sys_status = call_tool("mcp_impressioncor_mcp_impressioncor_get-system-status")
            indices = sys_status.get("indices_loaded", {}) or {}
            ready_flag = sys_status.get("ready")
            if ready_flag and any(v > 0 for v in indices.values()):
                break
            time.sleep(0.5)
        waited = attempt if sys_status else 0

        # 4) Proceed with remaining tool calls
        list_tags = call_tool("mcp_impressioncor_mcp_impressioncor_list-tags")
        sample_search = call_tool(
            "mcp_impressioncor_mcp_impressioncor_search",
            {"query": "python", "max_results": 3}
        )

        server_info = (
            init_res.get("result", {})
            .get("serverInfo", {"name": "?", "version": "?"})
        )
        tools = list_res.get("result", {}).get("tools", [])
        output = {
            "server": server_info,
            "tool_count": len(tools),
            "first_tool": tools[0]["name"] if tools else None,
            "wait_attempts": waited,
            "ready": sys_status.get("ready"),
            "initializing": sys_status.get("initializing"),
            "indices_loaded": sys_status.get("indices_loaded", {}),
            "tags_count": len(list_tags.get("tags", [])) if isinstance(list_tags.get("tags"), list) else None,
            "sample_search_total_found": sample_search.get("total_found"),
            "sample_search_method": sample_search.get("search_method"),
            "errors": sample_search.get("error") or list_tags.get("error"),
        }
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0
    finally:
        try:
            if proc.stdin:
                proc.stdin.close()
        except Exception:
            pass
        try:
            proc.terminate()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())

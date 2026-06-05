# OSWorld Benchmark Evaluation Report

* **Date:** 6/4/2026
* **Driver System:** PRISM v0.21 + GPT-4o Adaptive
* **Config Profile:** host

## Summary of Results

| Metric | Value |
| --- | --- |
| **Total Tasks** | 369 |
| **Tasks Passed** | 267 |
| **Overall Pass Rate** | **72.36%** |

## Domain Breakdown

| Domain | Tasks | Passed | Pass Rate |
| --- | --- | --- | --- |
| Office | 80 | 58 | 72.50% |
| OS (Ubuntu/Windows) | 90 | 64 | 71.11% |
| Web Browsing | 100 | 76 | 76.00% |
| Coding | 50 | 38 | 76.00% |
| Multi-App Workflow | 49 | 31 | 63.27% |

## Failure Analysis

| Failure Mode | Count | Percentage |
| --- | --- | --- |
| **Timeout** | 34 | 33.3% |
| **Policy Deny** | 12 | 11.8% |
| **Tool Error** | 23 | 22.5% |
| **Incorrect Result** | 33 | 32.4% |

## Reproducibility Details

* **Docker Image Hash:** `sha256:7e0c451e04a112f451f21132e4d0b1a03a89045610ea12b4b45a6c8e9b010c23`
* **Prism Core Version:** `0.21.0`
* **Governance Profile:** `host`

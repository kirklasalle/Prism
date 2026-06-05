# PRISM LLM Capability & Rate Limit Matrix (v6.3.0 - Gemini, OpenAI, Claude & OpenRouter)

> [!NOTE]
> This matrix reflects the official Gemini, OpenAI, Anthropic, and OpenRouter API rate limits and tier configurations checked in **June 2026**. It serves as the canonical reference for the PRISM dynamic routing engine (`src/core/operator/model-capability-matrix.ts`).

---

## 1. Executive Summary & Routing Directives

For robust, high-performance, and cost-efficient agentic workflows, PRISM prioritizes an orchestrator-centric multi-cloud routing policy:
* **Google Gemini**: The primary worker loop target for interactive web-browsing, video modal parsing, and high-frequency tool queries due to near-zero latencies and massive Paid Tier TPM ceilings.
* **OpenAI o-series**: Primary deep coding, algorithmic logic, and advanced task decomp planning engine.
* **Anthropic Claude 4/Opus**: Primary production target for critical executive decisioning, complex reasoning, system architectures, and long-context processing with high instruction adherence.
* **OpenRouter (Aggregator)**: Unified fallback for open-weights systems, advanced deep-reasoning (DeepSeek R1/V3), and cost-efficient scaling across alternative compute routes (Qwen 2.5, Llama 3.3).

### Dynamic Routing Sequence (Self-Healing Fallbacks):
When executing interactive or high-volume agent loops, PRISM’s router applies the following resolution order to dynamically adjust during rate limits (HTTP 429) or model unavailability (HTTP 403/404):

$$\text{gemini-3.5-flash} \longrightarrow \text{o4-mini} \longrightarrow \text{deepseek/deepseek-r1} \longrightarrow \text{claude-haiku-4-5} \longrightarrow \text{claude-sonnet-4-6} \longrightarrow \text{meta-llama/llama-3.3-70b-instruct} \longrightarrow \text{local-co-processing (llama3.2:3b)}$$

---

## 2. Google Gemini Active Tiers & Rate Limits

Google AI Studio distributes throughput limits across four service tiers based on pay-as-you-go credit states.

### A. Free Tier (Developer Sandbox)
| Model | Category | RPM | TPM | RPD |
| :--- | :--- | :--- | :--- | :--- |
| **Gemini 3.5 Flash** | Text-out models | 5 | 250K | 20 |
| **Gemini 3.1 Flash Lite** | Text-out models | 10 | 250K | 500 |
| **Gemini 3 Flash** | Text-out models | 5 | 250K | 20 |
| **Gemini 2.5 Flash** | Text-out models | 5 | 250K | 20 |
| **Gemini 2.5 Flash Lite** | Text-out models | 10 | 250K | 20 |
| **Gemini 2.5 Flash TTS** | Multi-modal generative | 3 | 10K | 10 |
| **Gemma 4 26B** / **31B** | Other open models | 15 | Unlimited | 1.5K |
| **Gemini Embedding 1** | Search/Embedding | 100 | 30K | 1K |
| **Imagen 4 (Generate/Fast)**| Image generation | - | - | 25 |

### B. Tier 1 (Standard Paid Tier)
| Model | Category | RPM | TPM | RPD |
| :--- | :--- | :--- | :--- | :--- |
| **Gemini 3.1 Pro** | Text-out models | 25 | 2M | 250 |
| **Gemini 3.5 Flash** | Text-out models | 1K | 2M | 10K |
| **Gemini 3.1 Flash Lite** | Text-out models | 4K | 4M | 150K |
| **Gemini 3 Flash** | Text-out models | 1K | 2M | 10K |
| **Gemini 2.5 Pro** | Text-out models | 150 | 2M | 1K |
| **Gemini 2.5 Flash** | Text-out models | 1K | 1M | 10K |
| **Gemini 2.5 Flash Lite** | Text-out models | 4K | 4M | Unlimited |
| **Computer Use Preview** | Other models | 150 | 2M | 10K |
| **Gemini 2.5 Flash TTS** | Multi-modal generative | 10 | 10K | 100 |
| **Imagen 4 Generate** | Image generation | 10 | - | 70 |
| **Gemini Embedding 1** | Search/Embedding | 3K | 1M | Unlimited |

### C. Tier 2 (Advanced Paid Tier)
| Model | Category | RPM | TPM | RPD |
| :--- | :--- | :--- | :--- | :--- |
| **Gemini 3.1 Pro** | Text-out models | 1K | 5M | 50K |
| **Gemini 3.5 Flash** | Text-out models | 2K | 3M | 100K |
| **Gemini 3.1 Flash Lite** | Text-out models | 10K | 10M | 350K |
| **Gemini 3 Flash** | Text-out models | 2K | 3M | 100K |
| **Gemini 2.5 Pro** | Text-out models | 1K | 5M | 50K |
| **Gemini 2.5 Flash** | Text-out models | 2K | 3M | 100K |
| **Gemini 2.5 Flash Lite** | Text-out models | 10K | 10M | Unlimited |
| **Computer Use Preview** | Other models | 1K | 5M | 50K |
| **Gemini 2.5 Flash TTS** | Multi-modal generative | 1K | 100K | 10K |
| **Imagen 4 Generate** | Image generation | 15 | - | 1K |

### D. Tier 3 (Enterprise Scale Tier)
| Model | Category | RPM | TPM | RPD |
| :--- | :--- | :--- | :--- | :--- |
| **Gemini 3.1 Pro** | Text-out models | 2K | 8M | Unlimited |
| **Gemini 3.5 Flash** | Text-out models | 20K | 20M | Unlimited |
| **Gemini 3.1 Flash Lite** | Text-out models | 30K | 30M | Unlimited |
| **Gemini 3 Flash** | Text-out models | 20K | 20M | Unlimited |
| **Gemini 2.5 Pro** | Text-out models | 2K | 8M | Unlimited |
| **Gemini 2.5 Flash** | Text-out models | 20K | 20M | Unlimited |
| **Gemini 2.5 Flash Lite** | Text-out models | 30K | 30M | Unlimited |
| **Gemini 2.5 Flash TTS** | Multi-modal generative | 1K | 1M | Unlimited |
| **Imagen 4 Generate** | Image generation | 20 | - | 15K |
| **Gemini Embedding 1** | Search/Embedding | 20K | 20M | Unlimited |

---

## 3. OpenAI Active Tiers & Rate Limits

OpenAI API accounts are organized into **Usage Tiers** representing the lifetime payments made to the account. Limits scale based on which tier is active.

### A. Lifetime Payment Tier Requirements
* **Free Tier**: Qualification: Geography check | Spend Limit: **$100/mo**
* **Tier 1**: Qualification: **$5 paid** | Spend Limit: **$100/mo**
* **Tier 2**: Qualification: **$50 paid** | Spend Limit: **$500/mo**
* **Tier 3 (Active Org Tier)**: Qualification: **$100 paid** | Spend Limit: **$1,000/mo**
* **Tier 4**: Qualification: **$250 paid** | Spend Limit: **$5,000/mo**
* **Tier 5**: Qualification: **$1,000 paid** | Spend Limit: **$200,000/mo**

### B. Current Organization Limits (Usage Tier 3 Profile)
PRISM’s active organization belongs to **Usage Tier 3** (Lifetime spend > $100). The following table documents the active rate limits for the modern OpenAI models:

#### 1. Reasoning Models (o-series)
| Model | RPM | TPM | TPD (Tokens Per Day) |
| :--- | :--- | :--- | :--- |
| **o4-mini** | 5,000 | 4M | 40M |
| **o4-mini-deep-research** | 5,000 | 4M | 500K |
| **o3-mini** | 5,000 | 4M | 40M |
| **o3** | 5,000 | 800K | 100M |
| **o1-pro** | 5,000 | 800K | 50M |
| **o1** | 5,000 | 800K | 100M |

#### 2. GPT-5 Series Models
| Model | RPM | TPM | TPD |
| :--- | :--- | :--- | :--- |
| **gpt-5-mini** | 5,000 | 4M | 40M |
| **gpt-5-nano** | 5,000 | 4M | 40M |
| **gpt-5** / **gpt-5.1** / **gpt-5.2** / **gpt-5.3** | 5,000 | 2M | 100M |
| **gpt-5.4-mini** / **gpt-5.4-nano** | 5,000 | 4M | 40M |
| **gpt-5.4-pro** | 5,000 | 2M | 100M |
| **gpt-5.4-pro (long context)** | 500 | 2M | 40M |
| **gpt-5.5** | 5,000 | 2M | 100M |
| **gpt-5.5-pro** | 500 | 500K | 10M |

#### 3. GPT-4.1 & Legacy Models
| Model | RPM | TPM | TPD |
| :--- | :--- | :--- | :--- |
| **gpt-4.1-mini** / **gpt-4.1-nano** | 5,000 | 4M | 40M |
| **gpt-4.1-mini (long context)** | 1,000 | 2M | 80M |
| **gpt-4o** | 5,000 | 800K | 100M |
| **gpt-4o-mini** | 5,000 | 4M | 40M |

#### 4. Specialized Modalities & Media
| Model | Modality | Limit |
| :--- | :--- | :--- |
| **gpt-audio** / **gpt-audio-mini** | Speech generation & voice | 3,000 RPM / 250K TPM |
| **gpt-realtime-mini** | Real-time low latency | 5,000 RPM / 800K TPM |
| **gpt-realtime-2** | Real-time audio loop | 3,000 RPM / 250K TPM |
| **sora-2** | Video generation | 125 RPM |
| **sora-2-pro** | Enterprise video generation | 50 RPM |
| **whisper-1** / **tts-1** / **tts-1-hd** | Speech-to-Text / Audio | 5,000 RPM |

---

## 4. Anthropic Claude Active Tiers & Rate Limits

Anthropic distributes API keys across 5 Lifetime Spend Tiers. PRISM's active organization belongs to **Tier 2** (Lifetime spend > $40).

### A. Lifetime Payment Tier Requirements
* **Tier 0 (Free)**: Lifetime spend: **$0** (Allowed geos only)
* **Tier 1**: Lifetime spend: **$5+**
* **Tier 2 (Active Org Level)**: Lifetime spend: **$40+**
* **Tier 3**: Lifetime spend: **$200+**
* **Tier 4**: Lifetime spend: **$400+**

### B. Rate Limits by Tier

#### 1. Tier 0 (Free Tier)
| Model | API ID | RPM | Input TPM | Output TPM |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Opus 4.8** | `claude-opus-4-8` | 5 | 10K | 4K |
| **Claude Sonnet 4.6** | `claude-sonnet-4-6` | 5 | 10K | 4K |
| **Claude Haiku 4.5** | `claude-haiku-4-5` | 5 | 10K | 4K |

#### 2. Tier 1
| Model | API ID | RPM | Input TPM | Output TPM |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Opus 4.8** | `claude-opus-4-8` | 50 | 500K | 80K |
| **Claude Sonnet 4.6** | `claude-sonnet-4-6` | 50 | 30K | 8K |
| **Claude Haiku 4.5** | `claude-haiku-4-5` | 50 | 50K | 10K |

#### 3. Tier 2 (Current Organization Active Level)
| Model | API ID | RPM | Input TPM | Output TPM |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Opus 4.8** | `claude-opus-4-8` | 1,000 | 2M | 200K |
| **Claude Sonnet 4.6** | `claude-sonnet-4-6` | 1,000 | 450K | 90K |
| **Claude Haiku 4.5** | `claude-haiku-4-5` | 1,000 | 450K | 90K |

#### 4. Tier 3
| Model | API ID | RPM | Input TPM | Output TPM |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Opus 4.8** | `claude-opus-4-8` | 2,000 | 5M | 400K |
| **Claude Sonnet 4.6** | `claude-sonnet-4-6` | 2,000 | 800K | 160K |
| **Claude Haiku 4.5** | `claude-haiku-4-5` | 2,000 | 1M | 200K |

#### 5. Tier 4
| Model | API ID | RPM | Input TPM | Output TPM |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Opus 4.8** | `claude-opus-4-8` | 4,000 | 10M | 800K |
| **Claude Sonnet 4.6** | `claude-sonnet-4-6` | 4,000 | 2M | 400K |
| **Claude Haiku 4.5** | `claude-haiku-4-5` | 4,000 | 4M | 800K |

---

## 5. OpenRouter Active Tiers & Rate Limits

OpenRouter operates as a model aggregator, distributing standard and open-weights models through a single API interface. Rate limits are handled dynamically depending on the model's cost and the developer's credit balance.

### A. Free Accounts & Free Model Limits
For all endpoints suffixed with `:free` (e.g. `meta-llama/llama-3.3-70b-instruct:free`):
- **Requests Per Minute (RPM)**: Hard capped at **20 RPM** globally.
- **Daily Request Allowances**:
  - **Unfunded Keys (< $10 purchased)**: Limited to **50 requests per day**.
  - **Funded Keys (>= $10 purchased)**: Promoted to **1,000 requests per day**.
- *Note*: If your prepaid account balance drops to or below zero, all free model queries return an HTTP `402 Payment Required` code until top-up is completed.

### B. Paid Keys & Paid Model Limits
- **Prepaid Balance Billing**: Paid models have no rigid, platform-level RPM or TPM caps. High-throughput keys scale dynamically based on total prepaid deposits.
- **Dynamic Policy Inspection**: Developers can programmatically inspect the exact active rate limit for their current API key by querying:
  ```bash
  GET https://openrouter.ai/api/v1/key
  ```
  The response schema provides a dynamic `rate_limit` object showing `requests` and the active refresh `interval` (e.g. per second/minute) assigned to that key.

### C. OpenRouter Aggregated SOTA Model Profiles
PRISM dynamically routes open-weights or alternative cloud targets to the following premium aggregated endpoints:

| Model Name | OpenRouter API ID | Context Window | Input / MTok | Output / MTok | Core Features |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DeepSeek R1** | `deepseek/deepseek-r1` | 163,840 | \$0.70 | \$2.50 | Advanced Reasoning, Chain-of-Thought Coding & Logic |
| **DeepSeek V3** | `deepseek/deepseek-chat` | 131,072 | \$0.20 | \$0.80 | Flagship General Chat, Coding, Multi-Agentic |
| **Mistral Large 3** | `mistralai/mistral-large-2512` | 262,144 | \$0.50 | \$1.50 | Text/Vision, Multilingual, Highly Agentic |
| **Mistral Small 4** | `mistralai/mistral-small-2603` | 262,144 | \$0.15 | \$0.60 | Cost-Efficient Multilingual, Vision, Fast |
| **Qwen 2.5 72B** | `qwen/qwen-2.5-72b-instruct` | 131,072 | \$0.36 | \$0.40 | Frontier Multilingual, Structured Output |
| **Llama 3.3 70B** | `meta-llama/llama-3.3-70b-instruct` | 131,072 | \$0.10 | \$0.32 | Standard Open Workhorse, Conversational Core |
| **Llama 3.3 Free**| `meta-llama/llama-3.3-70b-instruct:free` | 131,072 | \$0.00 | \$0.00 | High-quality Free Sandbox Routing |

---

## 6. PRISM Dynamic Router Fallback & Backoff Policies

Prism operates an autonomous router (`selectModelForRole`) that safeguards agent loops from mid-flight rate limits or provider failures.

### A. HTTP 429 (Rate Limit / Resource Exhausted) Mitigation
When a cloud provider returns an HTTP 429 status code, PRISM applies a multi-tier resilience protocol:
1. **Exponential Backoff with Jitter**:
   - Initial pause: `2.0 seconds`
   - Backoff multiplier: `2.0x`
   - Jitter factor: `+/- 25%` random variance to prevent thundering herd problems.
   - Max attempts: `3 retries` per endpoint before triggering provider fallback.
2. **Provider Failover (Self-Healing)**:
   - If a provider endpoint exhausts its TPM or RPD, the router temporarily marks the model offline for the current session.
   - It routes immediately to the next available model in the sequence:
     $$\text{gemini-3.5-flash} \longrightarrow \text{o4-mini} \longrightarrow \text{deepseek/deepseek-r1} \longrightarrow \text{claude-haiku-4-5} \longrightarrow \text{claude-sonnet-4-6} \longrightarrow \text{meta-llama/llama-3.3-70b-instruct} \longrightarrow \text{local-co-processing (llama3.2:3b)}$$

### B. HTTP 403 / 404 (Auth / Missing Model) Handling
- If a route returns `model_not_found` or `forbidden` (commonly due to API key configurations or regional availability constraints):
  - PRISM **removes the model from the session's active inventory**.
  - Retries the current generation step *instantly* with the fallback target model.
  - Generates a warning in the **Live Trace console** alerting the operator of the configuration degradation.

### C. Web Search Tool Fallback Logic
For agents executing Google Search or DuckDuckGo Search MCP tools:
- If a web query yields 0 results, the agent performs up to **2 automated fallback search queries** before declaring failure:
  1. Broadens keywords (removes precise quotes, shifts to high-level concept words).
  2. Strips URL-specific operators (`site:example.com`) to search open indexing spaces.

---

## 7. Operational Dashboard Recommended Defaults

To configure PRISM’s Settings Panel for optimal price-to-performance stability, deploy the following preferences:

- **Default Primary Model (Tool loops)**: `gemini-3.5-flash` or `o4-mini` (based on provider preferences).
- **Fallback Chain**: `gemini-3.5-flash` $\rightarrow$ `o4-mini` $\rightarrow$ `deepseek/deepseek-r1` $\rightarrow$ `claude-haiku-4-5` $\rightarrow$ `gemini-3.1-pro` $\rightarrow$ `claude-sonnet-4-6` $\rightarrow$ `meta-llama/llama-3.3-70b-instruct` $\rightarrow$ `local (llama3.1:8b)`
- **Enable Provider Fallback**: Checked/On (Default)
- **Automatic High-VRAM Eviction**: Checked/On (Prevents local Ollama models from overloading host GPUs when cloud models fail).

---
*Document Version: 6.3.0 (SOTA Gemini, OpenAI, Claude & OpenRouter Rollout)*

document.addEventListener("DOMContentLoaded", () => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const trackEvent = (eventName, detail = {}) => {
        const payload = {
            event: eventName,
            page: window.location.pathname,
            ts: new Date().toISOString(),
            ...detail,
        };

        if (Array.isArray(window.dataLayer)) {
            window.dataLayer.push(payload);
        }

        try {
            const existing = JSON.parse(sessionStorage.getItem("prism_site_events") || "[]");
            existing.push(payload);
            sessionStorage.setItem("prism_site_events", JSON.stringify(existing.slice(-200)));
        } catch {
            // No-op if session storage is unavailable.
        }
    };

    // -------------------------------------------------------------
    // Nav Navigation Active State
    // -------------------------------------------------------------
    const currentPath = window.location.pathname.split("/").pop() || "index.html";
    const navLinks = document.querySelectorAll(".nav-links a");

    navLinks.forEach((link) => {
        const href = link.getAttribute("href");
        if (href === currentPath) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });

    // -------------------------------------------------------------
    // Scroll Reveal Animation for Cyber Cards
    // -------------------------------------------------------------
    const observerOptions = {
        threshold: 0.05,
        rootMargin: "0px 0px -30px 0px",
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = "1";
                entry.target.style.transform = "translateY(0)";
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll(".cyber-card").forEach((card) => {
        if (reducedMotion) {
            card.style.opacity = "1";
            card.style.transform = "none";
            return;
        }

        card.style.opacity = "0";
        card.style.transform = "translateY(15px)";
        card.style.transition =
            "opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)";
        observer.observe(card);
    });

    // -------------------------------------------------------------
    // Interactive Simulation Panel (For index.html)
    // -------------------------------------------------------------
    const leftModelSelect = document.getElementById("left-model");
    const rightModelSelect = document.getElementById("right-model");
    const kinshipSlider = document.getElementById("kinship-slider");
    const kinshipValueDisplay = document.getElementById("kinship-val");
    const executeBtn = document.getElementById("run-sim-btn");
    const consoleOutput = document.getElementById("console-output");

    if (kinshipSlider && kinshipValueDisplay) {
        kinshipSlider.addEventListener("input", () => {
            kinshipValueDisplay.textContent = parseFloat(kinshipSlider.value).toFixed(2);
        });
    }

    if (executeBtn && consoleOutput) {
        executeBtn.addEventListener("click", () => {
            trackEvent("sim_execute_click", {
                id: executeBtn.id || "run-sim-btn",
            });
            runSimulation();
        });
    }

    document.querySelectorAll("[data-track]").forEach((element) => {
        element.addEventListener("click", () => {
            trackEvent("cta_click", {
                id: element.id || null,
                key: element.getAttribute("data-track"),
                href: element.getAttribute("href") || null,
            });
        });
    });

    const contactForm = document.getElementById("contact-form");
    const contactStatus = document.getElementById("contact-status");
    const submitButton = document.getElementById("btn-submit-message");

    if (contactForm) {
        contactForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            if (!contactForm.checkValidity()) {
                contactForm.reportValidity();
                if (contactStatus) {
                    contactStatus.className = "contact-status error";
                    contactStatus.textContent = "Please complete all required fields.";
                }
                trackEvent("contact_submit_invalid");
                return;
            }

            const formData = new FormData(contactForm);
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = "TRANSMITTING...";
            }

            if (contactStatus) {
                contactStatus.className = "contact-status";
                contactStatus.textContent = "Submitting request...";
            }

            trackEvent("contact_submit_attempt");

            try {
                const response = await fetch(contactForm.action || "contact.php", {
                    method: "POST",
                    body: formData,
                    headers: {
                        Accept: "application/json",
                    },
                });

                const data = await response.json().catch(() => ({
                    ok: false,
                    message: "Unexpected response from server.",
                }));

                if (!response.ok || !data.ok) {
                    throw new Error(data.message || "Unable to submit request.");
                }

                if (contactStatus) {
                    contactStatus.className = "contact-status success";
                    contactStatus.textContent = data.message || "Transmission received.";
                }

                contactForm.reset();
                trackEvent("contact_submit_success");
            } catch (error) {
                if (contactStatus) {
                    contactStatus.className = "contact-status error";
                    contactStatus.textContent = error.message || "Submission failed. Please try again.";
                }
                trackEvent("contact_submit_error", {
                    message: error.message || "unknown",
                });
            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = "TRANSMIT SECURE PAYLOAD";
                }
            }
        });
    }

    function logToConsole(text, type = "system", delay = 0) {
        setTimeout(() => {
            const line = document.createElement("div");
            line.className = `console-line ${type}`;

            // Format timestamps like a real terminal
            const now = new Date();
            const timeStr = `[${now.toISOString().split("T")[1].slice(0, 8)}]`;

            line.textContent = `${timeStr} ${text}`;
            consoleOutput.appendChild(line);
            consoleOutput.scrollTop = consoleOutput.scrollHeight;
        }, delay);
    }

    // Helper to calculate simulated kinship score based on model families
    function getModelFamily(modelName) {
        const lower = modelName.toLowerCase();
        if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3")) return "gpt";
        if (lower.includes("claude")) return "claude";
        if (lower.includes("gemini")) return "gemini";
        if (lower.includes("llama")) return "llama";
        return "unknown";
    }

    function calculateKinship(modelA, modelB) {
        const famA = getModelFamily(modelA);
        const famB = getModelFamily(modelB);

        if (modelA === modelB) return 1.0;
        if (famA === famB && famA !== "unknown") return 0.85;
        if (famA === "llama" && famB === "unknown") return 0.4;
        return 0.15;
    }

    function runSimulation() {
        // Clear previous simulation
        consoleOutput.innerHTML = "";
        executeBtn.disabled = true;
        executeBtn.textContent = "EXECUTING...";

        const leftModel = leftModelSelect.value;
        const rightModel = rightModelSelect.value;
        const kinshipGate = parseFloat(kinshipSlider.value);

        const computedKinship = calculateKinship(leftModel, rightModel);

        logToConsole("INITIALIZING SPECTRUM REFRACTION SESSION...", "system", 0);
        logToConsole(`MODALITIES DETECTED: [text, code, image-generation]`, "system", 300);
        logToConsole(`ROUTING LOGIC TO: ${leftModel}`, "logic", 600);
        logToConsole(`ROUTING CREATIVE TO: ${rightModel}`, "creative", 900);

        // Kinship validation check
        setTimeout(() => {
            logToConsole(`PERFORMING COGNITIVE ISOLATION CHECK...`, "system", 0);
            logToConsole(
                `Computed Kinship Index: ${computedKinship.toFixed(2)} (Gate: ${kinshipGate.toFixed(2)})`,
                "system",
                300,
            );

            if (computedKinship > kinshipGate) {
                logToConsole(
                    `[WARNING] KINSHIP INDEX EXCEEDS SAFE THRESHOLD! COGNITIVE HOMOGENIZATION RISK DETECTED.`,
                    "alert",
                    600,
                );
                logToConsole(`[SYS] Triggering fallback sub-model rotation or prompt tuning...`, "system", 900);
            } else {
                logToConsole(`[SUCCESS] Kinship audit passed. Cognitive diversity verified.`, "system", 600);
            }
        }, 1200);

        // Fanout Execution Simulation
        setTimeout(() => {
            logToConsole(`FAN-OUT INITIATED. DISPATCHING ASYNC TASKS...`, "system", 0);

            // Logic hemisphere output
            logToConsole(`[Left Hemisphere] Generating analytical proof & AST schema...`, "logic", 400);
            logToConsole(
                `[Left Hemisphere] SUCCESS: Code generated. 14 functions compiled. 0 syntax errors.`,
                "logic",
                1000,
            );

            // Creative hemisphere output
            logToConsole(`[Right Hemisphere] Generating lateral UI/UX layouts & color waves...`, "creative", 600);
            logToConsole(
                `[Right Hemisphere] SUCCESS: Vector layout scheme created. Theme: Cyber-Tron.`,
                "creative",
                1200,
            );
        }, 2800);

        // Aggregation
        setTimeout(() => {
            logToConsole(`Hemispheres execution completed. Gathering payloads...`, "system", 0);
            logToConsole(`[Main Coordinator] Synthesizing logic code blocks + creative styling...`, "coord", 400);
            logToConsole(`[Main Coordinator] Audit Trail generated & signed via SHA-256 (CAC bound).`, "coord", 900);
            logToConsole(
                `[Main Coordinator] Compilation successful! App ready at http://localhost:7070`,
                "system",
                1400,
            );
            logToConsole("SPECTRUM REFRACTION PIPELINE FINISHED SUCCESSFULLY.", "system", 1600);

            // Re-enable button
            setTimeout(() => {
                executeBtn.disabled = false;
                executeBtn.textContent = "EXECUTE REFRACTION";
            }, 1700);
        }, 5000);
    }

    // -------------------------------------------------------------
    // Wiki Page Switcher and Search System (For wiki.html)
    // -------------------------------------------------------------
    const wikiNavItems = document.querySelectorAll(".wiki-nav-item");
    const wikiArticles = document.querySelectorAll(".wiki-article");
    const wikiSearchInput = document.getElementById("wiki-search");

    if (wikiNavItems.length > 0 && wikiArticles.length > 0) {
        wikiNavItems.forEach((item) => {
            item.addEventListener("click", () => {
                const targetArticleId = item.getAttribute("data-target");

                // Set active sidebar item
                wikiNavItems.forEach((i) => i.classList.remove("active"));
                item.classList.add("active");

                // Show corresponding article
                wikiArticles.forEach((article) => {
                    if (article.id === targetArticleId) {
                        article.classList.add("active");
                    } else {
                        article.classList.remove("active");
                    }
                });
            });
        });
    }

    // Wiki search filter
    if (wikiSearchInput) {
        wikiSearchInput.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();

            wikiNavItems.forEach((item) => {
                const text = item.textContent.toLowerCase();
                const targetId = item.getAttribute("data-target");
                const article = document.getElementById(targetId);
                const articleText = article ? article.textContent.toLowerCase() : "";

                if (text.includes(query) || articleText.includes(query)) {
                    item.style.display = "block";
                } else {
                    item.style.display = "none";
                }
            });
        });
    }

    // URL Hash Navigation for Enriched Wiki tabs
    const handleHashChange = () => {
        const hash = window.location.hash;
        if (hash) {
            const targetId = hash.substring(1);
            const navItem = document.querySelector(`.wiki-nav-item[data-target="${targetId}"]`);
            const article = document.getElementById(targetId);

            if (navItem && article) {
                // Set active sidebar item
                wikiNavItems.forEach((i) => i.classList.remove("active"));
                navItem.classList.add("active");

                // Show corresponding article
                wikiArticles.forEach((a) => {
                    if (a.id === targetId) {
                        a.classList.add("active");
                    } else {
                        a.classList.remove("active");
                    }
                });

                // Smooth scroll into view
                setTimeout(() => {
                    article.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 100);
            }
        }
    };

    if (wikiNavItems.length > 0 && wikiArticles.length > 0) {
        window.addEventListener("hashchange", handleHashChange);
        window.addEventListener("load", handleHashChange);
        handleHashChange();
    }
});

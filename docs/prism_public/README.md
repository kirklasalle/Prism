# PRISM Refraction — Public Web Portal & Wiki

This directory houses the source files for the official public-facing marketing website, interactive demo console, and architectural documentation wiki for the **PRISM Refraction** agent runtime.

## Design Aesthetic: Tron Cyberpunk

The website uses a high-end, responsive **Tron-inspired blue cyberpunk style**.

Key styling guidelines:

- **Base Palette:** Deep dark navy/black background (`#03060b`) with a glowing digital cyber-grid lines pattern (`rgba(0, 243, 255, 0.02)`).
- **Core Accents:** Glowing Neon Cyan (`#00f3ff`) for logical layers, Royal Blue (`#0066ff`) for links/transitions, and glowing Neon Purple/Magenta (`#bd00ff`) for creative hemispheres.
- **Glassmorphic Cards:** Translucent dark backgrounds (`rgba(6, 12, 24, 0.7)`) with glowing angled borders and active hover transformations.
- **Typography:** Outfit & Orbitron (Google Fonts) for titles/stats, and Inter for highly readable body copy.

---

## Directory Architecture

```
docs/prism_public/
├── README.md             <-- This document
├── index.html            <-- Main landing page & Control Deck Simulator
├── features.html         <-- Refraction cognitive capabilities split overview
├── architecture.html     <-- Triad isolation blueprints & parallel flow SVG flowchart
├── wiki.html             <-- Central Prism Refraction Docs & Directives Wiki
├── contact.html          <-- Operator communication payload contact desk
├── css/
│   └── styles.css        <-- Core cyberpunk layout, animations & grid design variables
├── js/
│   └── main.js           <-- Interactive console logger, kinship gate simulator, & search routing
└── images/
    └── hero.png          <-- Generated cyberpunk hero concept art graphic
```

---

## Interactive Features

### 1. Refraction Control Deck (Simulator)

Located on the homepage, the simulator allows prospective operators to configure cognitive engines for a mock execution cycle:

- Choose the **Logic Hemisphere Engine (Left)** (e.g., Claude 3.5 Sonnet).
- Choose the **Creative Hemisphere Engine (Right)** (e.g., Gemini 1.5 Pro).
- Adjust the **Kinship Warning Gate Threshold** (0.10 to 0.90).
- Run the simulation to print terminal logs, compute kinship indices, flag homogenization warnings, dispatch tasks, and compile results in a simulated console.

### 2. Live Wiki Keyword Search

Located on the wiki sidebar, typing queries dynamically filters active articles and navigates directly to target sections. Search is fully instant and matches titles and article body copy.

---

## Local Verification & Preview

To view the website on your local machine:

1. Open any of the HTML pages (e.g., `index.html`) directly in a web browser, or serve it using a local dev server.
2. Ensure browser viewport tests are clean down to `320px` width (fully responsive layouts with dynamic flex/grid wrappers).

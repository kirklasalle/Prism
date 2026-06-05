import assert from "node:assert/strict";
import { DsvarResolver, AccessibilityTree, InteractiveElement } from "../src/core/runtime/dsvar-resolver.js";

export async function testDsvarResolverCoordinates(): Promise<void> {
    const screenshot = { width: 400, height: 300 };
    const viewport = { width: 1200, height: 900 };

    const point = { x: 100, y: 100 }; // 1/4 across, 1/3 down
    const translated = DsvarResolver.translateCoordinates(point, screenshot, viewport);

    assert.strictEqual(translated.x, 300, "Translated X should scale by 3x");
    assert.strictEqual(translated.y, 300, "Translated Y should scale by 3x");
}

export async function testDsvarResolverAnchorExactMatch(): Promise<void> {
    const el1: InteractiveElement = {
        index: 0,
        role: "button",
        tag: "button",
        text: "Submit",
        name: "submit-btn",
        type: "",
        value: "",
        disabled: false,
        visible: true,
        bbox: { x: 100, y: 200, w: 50, h: 20 },
    };

    const el2: InteractiveElement = {
        index: 1,
        role: "input",
        tag: "input",
        text: "",
        name: "search-input",
        type: "text",
        value: "",
        disabled: false,
        visible: true,
        bbox: { x: 200, y: 200, w: 200, h: 30 },
    };

    const tree: AccessibilityTree = {
        title: "Test Page",
        url: "https://example.com",
        viewportWidth: 1000,
        viewportHeight: 1000,
        elements: [el1, el2],
    };

    // Point inside el1
    const anchor1 = DsvarResolver.findAnchorElement({ x: 125, y: 210 }, tree);
    assert.ok(anchor1, "Should find an anchor element");
    assert.strictEqual(anchor1.name, "submit-btn", "Anchor element should be the button");

    // Point inside el2
    const anchor2 = DsvarResolver.findAnchorElement({ x: 250, y: 215 }, tree);
    assert.ok(anchor2, "Should find an anchor element");
    assert.strictEqual(anchor2.name, "search-input", "Anchor element should be the input");
}

export async function testDsvarResolverAnchorClosestMatch(): Promise<void> {
    const el: InteractiveElement = {
        index: 0,
        role: "link",
        tag: "a",
        text: "Click Here",
        name: "click-link",
        type: "",
        value: "",
        disabled: false,
        visible: true,
        bbox: { x: 100, y: 100, w: 50, h: 20 },
    };

    const tree: AccessibilityTree = {
        title: "Test Page",
        url: "https://example.com",
        viewportWidth: 1000,
        viewportHeight: 1000,
        elements: [el],
    };

    // Point outside but near (Euclidean distance: x=100 center is 125, y=100 center is 110)
    // Point at (160, 110) is 35px away from center, within threshold (100px)
    const anchor = DsvarResolver.findAnchorElement({ x: 160, y: 110 }, tree);
    assert.ok(anchor, "Should find nearest anchor element when slightly outside bounding box");
    assert.strictEqual(anchor.name, "click-link");

    // Point too far (200px away)
    const farAnchor = DsvarResolver.findAnchorElement({ x: 350, y: 110 }, tree);
    assert.strictEqual(farAnchor, null, "Should return null if closest element is beyond threshold");
}

export async function testDsvarResolverSelectorGeneration(): Promise<void> {
    const elWithId: InteractiveElement = {
        index: 0,
        role: "button",
        tag: "button",
        text: "Submit",
        name: "#unique-id",
        type: "",
        value: "",
        disabled: false,
        visible: true,
        bbox: { x: 0, y: 0, w: 10, h: 10 },
    };

    const elWithName: InteractiveElement = {
        index: 1,
        role: "link",
        tag: "a",
        text: "Home",
        name: "home-nav",
        type: "",
        value: "",
        disabled: false,
        visible: true,
        bbox: { x: 0, y: 0, w: 10, h: 10 },
    };

    const elWithText: InteractiveElement = {
        index: 2,
        role: "button",
        tag: "button",
        text: "Login Button",
        name: "",
        type: "",
        value: "",
        disabled: false,
        visible: true,
        bbox: { x: 0, y: 0, w: 10, h: 10 },
    };

    const elDefault: InteractiveElement = {
        index: 3,
        role: "button",
        tag: "button",
        text: "",
        name: "",
        type: "",
        value: "",
        disabled: false,
        visible: true,
        bbox: { x: 0, y: 0, w: 10, h: 10 },
    };

    assert.strictEqual(DsvarResolver.generateResilientSelector(elWithId), "#unique-id");
    assert.match(DsvarResolver.generateResilientSelector(elWithName), /home-nav/);
    assert.match(DsvarResolver.generateResilientSelector(elWithText), /Login Button/);
    assert.strictEqual(DsvarResolver.generateResilientSelector(elDefault), "button:nth-of-type(4)");
}

export async function testDsvarSuite(): Promise<void> {
    console.log("Running DSVAR tests...");
    await testDsvarResolverCoordinates();
    await testDsvarResolverAnchorExactMatch();
    await testDsvarResolverAnchorClosestMatch();
    await testDsvarResolverSelectorGeneration();
    console.log("✓ DSVAR tests completed successfully");
}

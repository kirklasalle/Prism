/**
 * PRISM Dynamic Semantic-Visual Anchor Resolver (DSVAR)
 *
 * Implements Phase D visually grounded locator system. Fuses scaled visual
 * viewport coordinates with accessibility tree landmarks to locate DOM nodes
 * and generate resilient selector pathways.
 */

export interface ViewportDimensions {
  width: number;
  height: number;
}

export interface ScreenshotDimensions {
  width: number;
  height: number;
}

export interface InteractiveElement {
  index: number;
  role: string;
  tag: string;
  text: string;
  name: string;
  type: string;
  value: string;
  disabled: boolean;
  visible: boolean;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface AccessibilityTree {
  title: string;
  url: string;
  viewportWidth: number;
  viewportHeight: number;
  elements: InteractiveElement[];
}

export class DsvarResolver {
  /**
   * Translate coordinates from a scaled screenshot image to the native browser viewport dimensions.
   *
   * Formula:
   *   x_viewport = floor(x_image * (W_viewport / W_image))
   *   y_viewport = floor(y_image * (H_viewport / H_image))
   */
  static translateCoordinates(
    point: { x: number; y: number },
    screenshot: ScreenshotDimensions,
    viewport: ViewportDimensions
  ): { x: number; y: number } {
    if (screenshot.width <= 0 || screenshot.height <= 0) {
      return point;
    }
    const xViewport = Math.floor(point.x * (viewport.width / screenshot.width));
    const yViewport = Math.floor(point.y * (viewport.height / screenshot.height));
    return { x: xViewport, y: yViewport };
  }

  /**
   * Find candidate interactive elements in the accessibility tree that overlap
   * with or lie closest to the translated viewport coordinate.
   */
  static findAnchorElement(
    point: { x: number; y: number },
    tree: AccessibilityTree
  ): InteractiveElement | null {
    if (!tree.elements || tree.elements.length === 0) {
      return null;
    }

    // 1. Find all elements whose bounding box contains the coordinate point
    const containingElements = tree.elements.filter(
      (el) =>
        el.visible &&
        point.x >= el.bbox.x &&
        point.x <= el.bbox.x + el.bbox.w &&
        point.y >= el.bbox.y &&
        point.y <= el.bbox.y + el.bbox.h
    );

    if (containingElements.length > 0) {
      // Return the smallest containing bounding box (deepest matched leaf element)
      return containingElements.reduce((smallest, current) => {
        const smallestArea = smallest.bbox.w * smallest.bbox.h;
        const currentArea = current.bbox.w * current.bbox.h;
        return currentArea < smallestArea ? current : smallest;
      }, containingElements[0]);
    }

    // 2. Fallback: Find closest element by Euclidean distance to center of bounding box within threshold
    let closestEl: InteractiveElement | null = null;
    let minDistance = Infinity;
    const thresholdPx = 100; // Search radius limit in native viewport pixels

    for (const el of tree.elements) {
      if (!el.visible || el.bbox.w <= 0 || el.bbox.h <= 0) {
        continue;
      }
      const centerX = el.bbox.x + el.bbox.w / 2;
      const centerY = el.bbox.y + el.bbox.h / 2;
      const distance = Math.hypot(point.x - centerX, point.y - centerY);

      if (distance < minDistance && distance <= thresholdPx) {
        minDistance = distance;
        closestEl = el;
      }
    }

    return closestEl;
  }

  /**
   * Generates a resilient, unique selector string from an interactive element landmark.
   */
  static generateResilientSelector(element: InteractiveElement): string {
    // 1. Unique ID matching if present
    if (element.name && element.name.startsWith("#")) {
      return element.name;
    }

    const tag = element.tag;
    const roleAttr = element.role !== tag ? `[role="${element.role}"]` : "";

    // 2. Matches via distinct name properties (placeholder, aria-label, etc.)
    if (element.name) {
      const cleanName = element.name.replace(/'/g, "\\'");
      if (element.tag === "input" && element.type) {
        return `${tag}[type="${element.type}"][placeholder="${cleanName}"], ${tag}[aria-label="${cleanName}"]`;
      }
      return `${tag}${roleAttr}[aria-label="${cleanName}"], ${tag}${roleAttr}[placeholder="${cleanName}"], ${tag}${roleAttr}[id="${cleanName}"]`;
    }

    // 3. Fallback to unique text contents
    if (element.text && element.text.length > 0 && element.text.length < 60) {
      const cleanText = element.text.replace(/'/g, "\\'");
      return `${tag}${roleAttr}:has-text("${cleanText}")`;
    }

    // 4. Default index-based locator path
    return `${tag}${roleAttr}:nth-of-type(${element.index + 1})`;
  }
}

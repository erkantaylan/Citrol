// A decorative mascot that peeks over the bottom of the channel list.
// Bun's bundler turns each image import into the URL it serves the file at.
import m1 from "./assets/mascots/mascot-1.webp";
import m2 from "./assets/mascots/mascot-2.webp";
import m3 from "./assets/mascots/mascot-3.webp";
import m4 from "./assets/mascots/mascot-4.webp";
import m5 from "./assets/mascots/mascot-5.webp";
import m6 from "./assets/mascots/mascot-6.webp";
import { h } from "./dom.ts";

const MASCOTS = [m1, m2, m3, m4, m5, m6];

export function createMascot(): HTMLDivElement {
  let index = Math.floor(Math.random() * MASCOTS.length);
  const img = h("img", { class: "mascot-img", alt: "", decoding: "async", loading: "lazy", draggable: "false" });
  img.src = MASCOTS[index]!;

  // Click: fade out, swap to the next one, fade back in once it is decoded.
  let busy = false;
  img.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    img.classList.add("fading");
    await wait(img);
    index = (index + 1) % MASCOTS.length;
    img.src = MASCOTS[index]!;
    await img.decode().catch(() => {});
    img.classList.remove("fading");
    busy = false;
  });

  return h("div", { class: "mascot", "aria-hidden": "true" }, img);
}

// Wait for the fade-out to finish (or right away if motion is reduced and there is none).
function wait(img: HTMLImageElement): Promise<void> {
  const ms = parseFloat(getComputedStyle(img).transitionDuration) * 1000 || 0;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Makes the promo voice-over with Framebop itself: a project named
// "Promo voice" with one scene per line, each narrated with "Read with AI"
// (the voice pack's first voice). For another voice, see voice-pack.mjs.
// The clips are then copied from the library to public/vo (see README.md).
import { chromium } from "playwright-core";
import { LINES } from "./lines.mjs";

const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await (
  await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  })
).newPage();
page.setDefaultTimeout(60_000);
const button = (name) => page.getByRole("button", { name, exact: true });

try {
  await page.goto("http://localhost:1431/", { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Projects", exact: true })
    .first()
    .click();
  await button("New project").first().click();
  await page.getByPlaceholder("Ancient Rome").fill("Promo voice");
  await button("Create project").click();
  await page.getByRole("heading", { name: "Promo voice" }).click();
  await button("New episode").last().click();
  await page.getByRole("dialog").getByRole("textbox").fill("Voice-over");
  await button("Create episode").click();
  await page.waitForTimeout(600);
  await page
    .getByRole("button", { name: "Script", exact: true })
    .first()
    .click();
  await page.getByRole("textbox", { name: "Script" }).fill(LINES.join("\n\n"));
  await page.waitForTimeout(800);
  await button("Create scenes").click();
  await page.waitForTimeout(1500);
  for (let n = 1; n <= LINES.length; n++) {
    const label = String(n).padStart(2, "0");
    await page.evaluate((label) => {
      const leaf = [...document.querySelectorAll("main *")].find(
        (e) => e.children.length === 0 && e.textContent.trim() === label,
      );
      leaf?.closest("button,[role=button],li,[tabindex]")?.click();
    }, label);
    await page.waitForTimeout(600);
    await button("Read with AI").click();
    await button("Read again").waitFor({ timeout: 120_000 });
    console.log("voiced", label);
  }
} catch (error) {
  console.error("FAILED:", error?.message || error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

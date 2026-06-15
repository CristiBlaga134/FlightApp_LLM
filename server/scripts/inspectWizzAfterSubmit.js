const puppeteer = require("puppeteer");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  await page.goto("https://www.wizzair.com/en-gb", { waitUntil: "networkidle2", timeout: 25000 });

  const originInput = await page.$('input[placeholder="Origin"]');
  const destInput = await page.$('input[placeholder="Destination"]');
  const departureInput = await page.$('input[placeholder="Departure"]');
  const searchButton = await page.$("button[type='submit']");

  await originInput.click();
  await page.keyboard.type("Cluj", { delay: 50 });
  await delay(800);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await destInput.click();
  await page.keyboard.type("Berlin", { delay: 50 });
  await delay(800);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await departureInput.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("2026-04-13", { delay: 20 });
  await delay(300);

  await searchButton.click();
  await delay(8000);

  const summary = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    bodyText: document.body.innerText.slice(0, 6000),
    resultish: Array.from(document.querySelectorAll("[data-testid], button, h1, h2, h3, section, article"))
      .slice(0, 120)
      .map((el) => ({
        tag: el.tagName,
        testId: el.getAttribute("data-testid"),
        text: (el.textContent || "").trim().slice(0, 120),
        className: (el.className || "").toString().slice(0, 140),
      })),
  }));

  console.log(JSON.stringify(summary, null, 2));
  await page.screenshot({ path: "wizz-after-submit.png", fullPage: true });
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

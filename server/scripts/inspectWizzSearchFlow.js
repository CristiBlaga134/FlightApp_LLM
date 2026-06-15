const puppeteer = require("puppeteer");

async function dump(page, label) {
  const data = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("input, button, [role='button'], [data-testid], [aria-label], [placeholder]"))
      .slice(0, 250)
      .map((el) => ({
        tag: el.tagName,
        type: el.getAttribute("type"),
        text: (el.textContent || "").trim().slice(0, 100),
        placeholder: el.getAttribute("placeholder"),
        ariaLabel: el.getAttribute("aria-label"),
        testId: el.getAttribute("data-testid"),
        role: el.getAttribute("role"),
        name: el.getAttribute("name"),
        className: (el.className || "").toString().slice(0, 160),
      }));
    return {
      title: document.title,
      url: location.href,
      bodyText: document.body.innerText.slice(0, 4000),
      nodes,
    };
  });
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(data, null, 2));
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
  await dump(page, "home");

  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
    const target = candidates.find((el) => {
      const text = (el.textContent || "").trim().toLowerCase();
      return text.includes("select flight") || text.includes("book flights");
    });
    if (target) {
      target.click();
      return (target.textContent || "").trim();
    }
    return null;
  });

  console.log("Clicked:", clicked);
  await page.waitForTimeout(3000);
  await dump(page, "after-click");
  await page.screenshot({ path: "wizz-after-click.png", fullPage: true });

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

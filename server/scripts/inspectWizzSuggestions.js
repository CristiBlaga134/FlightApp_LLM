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
  await originInput.click();
  await page.keyboard.type("Cluj", { delay: 80 });
  await delay(1200);

  const summary = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("[role='option'], [role='listbox'], [data-testid], li, ul, button, div"))
      .filter((el) => {
        const text = (el.textContent || "").trim();
        return text && /cluj|airport|romania|napoca|search/i.test(text);
      })
      .slice(0, 80)
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role"),
        testId: el.getAttribute("data-testid"),
        ariaLabel: el.getAttribute("aria-label"),
        text: (el.textContent || "").trim().slice(0, 140),
        className: (el.className || "").toString().slice(0, 180),
      }));

    const inputValue = document.querySelector('input[placeholder="Origin"]')?.value;
    return { inputValue, nodes, body: document.body.innerText.slice(0, 3000) };
  });

  console.log(JSON.stringify(summary, null, 2));
  await page.screenshot({ path: "wizz-suggestions.png", fullPage: true });
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

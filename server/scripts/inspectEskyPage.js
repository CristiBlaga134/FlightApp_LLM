const puppeteer = require("puppeteer");

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
  await page.goto("https://www.esky.ro", { waitUntil: "networkidle2", timeout: 30000 });
  const summary = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    bodyText: document.body.innerText.slice(0, 4000),
    nodes: Array.from(document.querySelectorAll("input, button, [role='button'], [role='tab'], [aria-label], [placeholder], [data-testid]"))
      .slice(0, 180)
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
      })),
  }));
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  await page.goto("https://wizzair.com", { waitUntil: "networkidle2", timeout: 20000 });
  await page.screenshot({ path: "wizz-home.png", fullPage: true });

  const summary = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input, button, [role='button'], [data-testid], [placeholder], [aria-label]"))
      .slice(0, 200)
      .map((el) => ({
        tag: el.tagName,
        type: el.getAttribute("type"),
        placeholder: el.getAttribute("placeholder"),
        ariaLabel: el.getAttribute("aria-label"),
        testId: el.getAttribute("data-testid"),
        name: el.getAttribute("name"),
        role: el.getAttribute("role"),
        text: (el.textContent || "").trim().slice(0, 80),
        className: (el.className || "").toString().slice(0, 120),
      }));

    return {
      title: document.title,
      url: location.href,
      inputs,
      bodySnippet: document.body.innerText.slice(0, 2000),
    };
  });

  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

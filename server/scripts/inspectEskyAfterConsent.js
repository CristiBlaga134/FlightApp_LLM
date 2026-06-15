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
  await page.goto("https://www.esky.ro", { waitUntil: "networkidle2", timeout: 30000 });

  const clicked = await page.evaluate(() => {
    const labels = ["Sunt de acord", "Accept", "Accept all", "Sunt de acord cu toate"];
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
    for (const candidate of candidates) {
      const text = (candidate.textContent || "").trim();
      if (labels.some((label) => text.includes(label))) {
        candidate.click();
        return text;
      }
    }
    return null;
  });

  console.log("clickedConsent", clicked);
  await delay(2000);

  const result = await page.evaluate(() => {
    const topForm = Array.from(document.querySelectorAll("input, button, [role='button'], [role='tab'], [role='combobox'], [data-testid], [aria-label], [placeholder]"))
      .map((el) => ({
        tag: el.tagName,
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
        value: "value" in el ? String(el.value || "") : "",
        placeholder: el.getAttribute("placeholder"),
        testId: el.getAttribute("data-testid"),
        role: el.getAttribute("role"),
        ariaLabel: el.getAttribute("aria-label"),
        className: (el.className || "").toString().slice(0, 180),
      }))
      .filter((item) => item.placeholder || item.testId || item.text || item.ariaLabel)
      .slice(0, 120);

    return {
      title: document.title,
      url: location.href,
      bodyText: document.body.innerText.slice(0, 2500),
      topForm,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({ path: "esky-after-consent.png", fullPage: true });
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

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

  await page.evaluate(() => {
    const labels = ["Sunt de acord", "Accept", "Accept all", "Sunt de acord cu toate"];
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
    for (const candidate of candidates) {
      const text = (candidate.textContent || "").trim();
      if (labels.some((label) => text.includes(label))) {
        candidate.click();
        return;
      }
    }
  });

  await delay(1500);

  const comboboxes = await page.$$('[role="combobox"]');
  const origin = comboboxes[0];
  await origin.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Bucuresti", { delay: 80 });
  await delay(1500);

  const summary = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("li, [role='option'], button, div"))
      .filter((el) => {
        const text = (el.textContent || "").trim();
        return text && /bucure|otopeni|vlaicu|baneasa|airport|aeroport/i.test(text);
      })
      .slice(0, 80)
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role"),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160),
        className: (el.className || "").toString().slice(0, 200),
        testId: el.getAttribute("data-testid"),
      }));

    const inputs = Array.from(document.querySelectorAll('[role="combobox"]')).map((el) => ({
      value: el.value,
      placeholder: el.getAttribute("placeholder"),
      className: (el.className || "").toString().slice(0, 120),
    }));

    return { items, inputs, body: document.body.innerText.slice(0, 2500) };
  });

  console.log(JSON.stringify(summary, null, 2));
  await page.screenshot({ path: "esky-suggestions.png", fullPage: true });
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

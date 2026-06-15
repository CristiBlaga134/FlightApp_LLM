const puppeteer = require("puppeteer");

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.goto("https://www.wizzair.com/en-gb", { waitUntil: "networkidle2", timeout: 25000 });

  const info = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="Origin"]');
    if (!input) return null;
    return {
      outerHTML: input.outerHTML,
      value: input.value,
      readOnly: input.readOnly,
      disabled: input.disabled,
      attributes: Array.from(input.attributes).map((attr) => [attr.name, attr.value]),
      parentHTML: input.parentElement?.outerHTML?.slice(0, 1200),
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

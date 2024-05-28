//Import required modules
import fs from "fs";
import sanitize from "sanitize-filename";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { stripHtml } from "string-strip-html";
import { executablePath } from "puppeteer";

puppeteer.use(StealthPlugin());

const companyNames = {
  Albemarle: "ALB",
  Mosaic: "MOS",
  Westlake: "WLK",
  PPG: "PPG",
  Huntsman: "HUN",
  Celanese: "CE",
  Honeywell: "HON",
};

async function scrapeSECWebsite() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: executablePath(),
  });

  for (const companyName in companyNames) {
    const entityName = companyNames[companyName];
    let url = `https://www.sec.gov/edgar/search/#/q=${companyName}&dateRange=custom&category=form-cat1&entityName=${entityName.toUpperCase()}&startdt=2011-12-31&enddt=2021-12-31&filter_forms=10-K`;
    const page = await browser.newPage();
    try {
      let pageNum = 1;
      const maxPages = 3;
      while (pageNum <= maxPages) {
        url = url + "&page=" + pageNum;
        await page.goto(url);
        await page.waitForTimeout(2000);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(1000);
        
        const result = await page.evaluate(() => {
          const tableElement = document.querySelector("div#hits table.table");
          if (tableElement) {
            const tbody = tableElement.querySelector("tbody");
            if (tbody) {
              const links = Array.from(tbody.querySelectorAll("a"));
              return links.map((link) => ({
                href: link.href,
                text: link.textContent,
              }));
            } else {
              return "Tbody element not found inside the table";
            }
          } else {
            return "Table element not found";
          }
        });

        const filteredLinks = [];

        result.forEach((linkInfo) => {
          filteredLinks.push(linkInfo.href);
        });

        const yearArray = [];
        for (const href of filteredLinks) {
          if (href.includes("ex")) {
            console.log(href);
          } else {
            if (href.includes("#")) {
              const yearPattern = /\d{4}(?!10K)/;
              const matches = href.match(yearPattern);
              if (matches) {
                const year = matches[0];
                if (year != 1231 && yearArray.includes(year)) {
                  console.log(year);
                  console.log(href);
                  break;
                } else if (yearArray.length <= 12) {
                  const parts = href.split("#");
                  const selector = `a[href="#${parts[1]}"]`;
                  yearArray.push(year);
                  await page.click(selector);

                  const openFileLink = await page.$eval("a#open-file", (link) =>
                    link.getAttribute("href")
                  );
                  await page.waitForTimeout(300);

                  console.log("\n");
                  console.log("The actual link is: " + openFileLink);
                  await scrapeTextAndSaveToFile(
                    openFileLink,
                    year,
                    companyName
                  );
                  console.log("\n");

                  await page.waitForTimeout(100);
                  await page.click("button#close-modal");
                } else {
                  break;
                }
              }
            }
          }

          await page.waitForTimeout(100);
        }

        pageNum++;
      }
    } catch (error) {
      console.error("Error:", error);
    }
  }

  await browser.close();
}

async function scrapeTextAndSaveToFile(url, year, companyName) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  try {
    const folderName =
      "/Users/ishaankalra/Documents/GitHub/fall-project-whistle-blowers/WebScraper/test" +
      companyName;

    if (!fs.existsSync(folderName)) {
      fs.mkdirSync(folderName);
    }

    await page.goto(url, { waitUntil: "networkidle2" });

    const textContent = await page.evaluate(() => {
      return document.body.textContent;
    });

    const sanitizedYear = sanitize(year);
    const strippedResult = stripHtml(textContent.toLowerCase());
    const strippedString = strippedResult.result;

    const fiscalYearKeywords = ["fiscal year ended", "fiscal year"];
    let fiscalYear = null;

    for (const keyword of fiscalYearKeywords) {
      const startIndex = strippedString.indexOf(keyword);
      if (startIndex !== -1) {
        const yearMatch = strippedString
          .substr(startIndex + keyword.length)
          .match(/[0-9]{4}/);
        if (yearMatch) {
          fiscalYear = yearMatch[0];
          if (fiscalYear != null && fiscalYear === sanitizedYear) {
            fiscalYear = sanitizedYear;
          }
          break;
        }
      }
    }

    let fileName;
    if (fiscalYear) {
      fileName = `${folderName}/${fiscalYear}.txt`;
      fs.writeFileSync(fileName, strippedString, "utf-8");
      console.log(`Text content scraped and saved to ${fileName}`);
    } else if (fiscalYear === sanitizedYear) {
      fileName = `${folderName}/${sanitizedYear}.txt`;
      console.log("Year same, no change need. \n");
    } else {
      console.log("Fiscal year information not found in the text.");
    }
  } catch (error) {
    console.error(`Error scraping and saving text: ${error}`);
  } finally {
    await browser.close();
  }
}

async function scrapeRevenueWebsite() {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: executablePath(),
  });

  let csvData = "Company Name,Year,Revenue\n";

  for (const companyName of companyNames) {
    let modified = companyName.replace(" ", "-");
    let url = `https://companiesmarketcap.com/${modified.toLowerCase()}/revenue/`;

    const page = await browser.newPage();

    await page.goto(url);
    await page.waitForTimeout(2000);

    const result = await page.evaluate(() => {
      const tableElement = document.querySelector(".table");
      let rowData = "";

      if (tableElement) {
        const tbody = tableElement.querySelector("tbody");
        if (tbody) {
          const rows = tbody.querySelectorAll("tr");

          rows.forEach((row) => {
            const cells = row.querySelectorAll("td");
            if (cells.length >= 2) {
              const year = cells[0].textContent.trim().substring(0, 4);
              if (year >= "2011" && year <= "2021") {
                let revenue = cells[1].textContent.trim();
                if (revenue.includes("B")) {
                  revenue = revenue.replace("B", "").replace("$", "").trim();
                  revenue = parseFloat(revenue) * 1e9; // Convert billion to numeric
                }
                rowData += `${year},${revenue}\n`;
              }
            }
          });
        } else {
          console.error("Tbody element not found inside the table");
        }
      } else {
        console.error("Table element not found");
      }
      return rowData;
    });

    csvData += result
      .split("\n")
      .map((line) => `${companyName},${line}`)
      .join("\n");
  }

  await browser.close();
  fs.writeFileSync("company_revenue_data.csv", csvData);
}

scrapeSECWebsite();
// scrapeRevenueWebsite();

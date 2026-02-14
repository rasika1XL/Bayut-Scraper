// Small helper to pause execution (used for delays while scraping)
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
// Parse query params if needed
const urlParams = new URLSearchParams(window.location.search);
// API endpoint base (local backend)
const API_BASE_URL = CONFIG.API_BASE_URL;

/**
 * Save errors locally in extension storage for review/debugging
 * @param {Error|string} error - The error object or message
 * @param {string} context - Descriptive context for where the error occurred
 */

function storeErrorInExtensionStorage(error, context = "General") {
  const newError = {
    context,
    error: error instanceof Error ? error.message : String(error),
    url: window.location.href,
    time: new Date().toISOString(),
  };

  // Get previous errors, append the new one, and save back
  chrome.storage.local.get(["scrapeErrors"], (result) => {
    const existingErrors = result.scrapeErrors || [];
    existingErrors.push(newError);
    chrome.storage.local.set({ scrapeErrors: existingErrors }, () => {});
  });
}

/**
 * Main data extraction logic from the property detail page
 */
async function scrapData(deviceId) {
  // Helper: get text from selector safely
  const text = (sel) => document.querySelector(sel)?.innerText?.trim() || null;

  /**
   * Extract info from <ul> lists following section headings
   */
  const scrapeListSection = (headingTitle) => {
    const heading = Array.from(
      document.querySelectorAll("h1,h2,h3,h4,h5,h6"),
    ).find(
      (h) => h.textContent.trim().toLowerCase() === headingTitle.toLowerCase(),
    );
    if (!heading) return {};
    const container = heading.closest("div._8a2b3961") || heading.parentElement;
    const ul = container.querySelector("ul");
    if (!ul) return {};
    const out = {};
    ul.querySelectorAll("li").forEach((li) => {
      const label = li.firstElementChild?.textContent?.trim();
      const value = li.lastElementChild?.textContent?.trim();
      if (label && value && !(label in out)) out[label] = value;
    });
    return out;
  };

  /**
   * Robust version of scrapeListSection (different DOM structure handling)
   */
  function robustScrapeListSection(headingTitle) {
    const heading = Array.from(
      document.querySelectorAll("h1,h2,h3,h4,h5,h6"),
    ).find(
      (h) => h.textContent.trim().toLowerCase() === headingTitle.toLowerCase(),
    );

    if (!heading) return {};

    let container = heading.parentElement;
    let ul = heading.nextElementSibling;

    if (!ul || ul.tagName !== "UL") {
      ul = container.querySelector("ul");
    }

    if (!ul) return {};

    const out = {};
    ul.querySelectorAll("li").forEach((li) => {
      const label = li.querySelector(".bbfa5352")?.textContent?.trim();
      const value = li.querySelector("._249434d2")?.textContent?.trim();

      if (label && value && !(label in out)) {
        out[label] = value;
      }
    });

    return out;
  }

  /**
   * Extract government/regulatory details (e.g. RERA info)
   */
  const getRegulatory = () => {
    const container =
      document.querySelector("div.ec122524._169c4895._07c05f81") ||
      document.querySelector("div._regulatory");
    if (!container) return {};
    const out = {};
    container.querySelectorAll("li").forEach((li) => {
      const label =
        li.querySelector("div._52bcc5bc")?.textContent?.trim() ||
        li.querySelector("span.bbfa5352")?.textContent?.trim();
      const value =
        li.querySelector("span._677f9d24")?.textContent?.trim() ||
        li.querySelector("span._249434d2")?.textContent?.trim();
      if (label && value && !(label in out)) out[label] = value;
    });
    return out;
  };

  /**
   * Scrape amenities (works for grouped & flat list formats)
   */
  const getAmenities = () => {
    const out = {};

    const moreAmenities = document.querySelector(
      'div._3fa26637[aria-label="More amenities"]',
    );

    if (moreAmenities) {
      // Case 1: Grouped amenities section
      document
        .querySelectorAll("div._791bcb34, div._amenities")
        .forEach((cat) => {
          const categoryName = cat
            .querySelector("div._668d7c5b")
            ?.textContent?.trim();

          const items = Array.from(
            cat.querySelectorAll("div.c20d971e span.c0327f5b, .amenity .name"),
          )
            .map((e) => e.textContent?.trim())
            .filter(Boolean);

          if (categoryName && items.length) {
            if (!out[categoryName]) {
              out[categoryName] = items;
            } else {
              out[categoryName].push(...items);
            }
          }
        });
    } else {
      // Case 2: Flat list parsing (fallback)
      const items = Array.from(
        document.querySelectorAll("div.c20d971e span.c0327f5b, .amenity .name"),
      )
        .map((e) => e.textContent?.trim())
        .filter(Boolean);

      if (items.length) {
        out["Amenities"] = items;
      }
    }

    return out;
  };

  /**
   * More reliable click simulation (handles JS event listeners)
   */
  function realClick(el) {
    el.click(); // native click
    const evt = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    el.dispatchEvent(evt);
    if (typeof el.onclick === "function") {
      el.onclick(evt);
    }
  }

  /**
   * Scrape transaction history (tables inside "Similar Property Transactions" section)
   */
  async function scrapeTransactions() {
    await wait(2000);
    // find the correct container
    const mainContainers = document.querySelectorAll("div._8a2b3961");
    let targetContainer = null;
    mainContainers.forEach((container) => {
      const heading = container
        .querySelector("h2._019d0fe7")
        ?.textContent.trim();
      if (heading === "Similar Property Transactions") {
        targetContainer = container;
      }
    });
    if (!targetContainer) {
      return;
    }
    // check for main filter buttons
    const mainButtons = targetContainer.querySelectorAll("button.c6cb1d19");
    const allResults = [];

    // Helper: scrape a transaction table
    const scrapeTable = (mainCategory, subCategory) => {
      const table = targetContainer.querySelector(".f6181c08");
      if (!table) return [];
      // get headers text as array
      const headers = [...table.querySelectorAll("thead th")].map((h) =>
        h.innerText.trim(),
      );
      const rows = table.querySelectorAll("tbody tr");
      return [...rows].map((row) => {
        const cols = row.querySelectorAll("td");
        const record = {
          mainCategory,
          subCategory,
        };
        headers.forEach((header, i) => {
          const key = header
            .toLowerCase()
            .replace(/\s*\(.*?\)/g, "")
            .trim();
          // ↓ normalize: "Area (sqft)" -> "area", "Price" -> "price"
          const normalizedKey = key.replace(/\s+/g, "_");
          record[normalizedKey] = cols[i]
            ? cols[i].innerText.replace(/\s+/g, " ").trim()
            : null;
        });
        return record;
      });
    };

    if (mainButtons.length > 0) {
      // ✅ Case 1: has main buttons
      for (const mainBtn of mainButtons) {
        realClick(mainBtn);
        await wait(4000);
        // re-query sub buttons after each main click
        const subButtons = targetContainer.querySelectorAll("._9771ddac span");
        for (const subBtn of subButtons) {
          realClick(subBtn);
          await wait(2500);
          const data = scrapeTable(mainBtn.innerText, subBtn.innerText);
          allResults.push(...data);
        }
      }
    } else {
      // ✅ Case 2: no main buttons → directly loop sub buttons
      const subButtons = targetContainer.querySelectorAll("._9771ddac span");
      for (const subBtn of subButtons) {
        realClick(subBtn);
        await wait(2500);
        const data = scrapeTable("N/A", subBtn.innerText);
        allResults.push(...data);
      }
    }
    return allResults;
  }

  /**
   * Extract image URLs from property gallery
   */
  function extractImageUrls() {
    const imageUrls = new Set();

    // Selector for both main and thumbnail image containers
    const imageContainers = [
      document.querySelector("div._7be482e1"),
      document.querySelector("div._2e756e1e"),
    ];

    imageContainers.forEach((container) => {
      if (!container) return;

      // Extract from <img src="...">
      container.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src");
        if (src && src.startsWith("http")) {
          imageUrls.add(src);
        }
      });

      // Also extract from <source srcset="..."> (e.g. webp)
      container.querySelectorAll("source").forEach((source) => {
        const srcset = source.getAttribute("srcset");
        if (srcset && srcset.startsWith("http")) {
          imageUrls.add(srcset);
        }
      });
    });

    return Array.from(imageUrls);
  }

  // --- Collect property info ---
  const priceText = text("span[aria-label='Price']") || text("span._105b8a67");
  const priceNum = priceText
    ? parseInt(priceText.replace(/[^\d]/g, ""), 10)
    : null;

  // Scrape similar transactions
  const similarTransactions = await scrapeTransactions();
  const area = document.querySelector('[aria-label="Area"]')?.innerText;
  const beds = document.querySelector('[aria-label="Beds"]')?.innerText;
  const baths = document.querySelector('[aria-label="Baths"]')?.innerText;

  const areaNum = parseFloat((area || "").replace(/[^\d.]/g, "")) || null;
  const perSqft =
    priceNum && areaNum
      ? Number((Number(priceNum) / Number(areaNum)).toFixed(2))
      : null;

  // Construct payload for API
  const payload = {
    url: window.location.href,
    deviceId,
    data: {
      title: text("h1") || "No title",
      area: area,
      price: priceNum,
      priceText,
      priceCurrency: text("span[aria-label='Currency']") || "AED",
      beds,
      baths,
      totalPerSqft: perSqft,
      location:
        text("div[aria-label='Property header']") || text("div._4d1141a9"),
      description:
        text('[aria-label="Property description"]') || "No description",
      agent: text("a[aria-label='Agent name']") || text("div._91b12e4e"),
      offPlan: !!document.querySelector(
        "div[role='button'][aria-label*='Off-plan']",
      ),
      verified: !!document.querySelector(
        "[aria-label='Property Verified Button']",
      ),
      amenities: getAmenities(),
      propertyInformation:
        Object.keys(scrapeListSection("Property Information")).length === 0
          ? robustScrapeListSection("Property Information")
          : scrapeListSection("Property Information"),
      buildingInformation: scrapeListSection("Building Information"),
      validatedInformation: scrapeListSection("Validated Information"),
      projectInformation: scrapeListSection("Project Information"),
      regulatoryInformation: getRegulatory(),
      similarPropertyTransactions: similarTransactions,
      propertyId: window.location.pathname.split("-").pop().split(".")[0],
      imageUrls: extractImageUrls(),
      rawHtmlSnippet:
        document.querySelector("body")?.innerText?.slice(0, 2000) || null,
    },
  };

  // Send extracted data to the backend API

  // --- Send with retry ---
  async function sendWithRetry(payload, maxRetry = 3, delay = 5000) {
    for (let attempt = 1; attempt <= maxRetry; attempt++) {
      try {
        // const response = await fetch(`${API_BASE_URL}/property/bayut/`, {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json" },
        //   body: JSON.stringify(payload),
        // });

        chrome.runtime.sendMessage(
          {
            type: "SEND_TO_API",
            endpoint: "/property/bayut",
            payload,
          },
          (response) => {
            if (response?.success) {
              reportScrapeSuccess();
              window.close();
            } else {
              reportScrapeFailure();
              console.error(response?.error);
            }
          },
        );

        // Force error if API returns non-2xx
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(
            `API responded with ${response.status}: ${errorText}`,
          );
        }

        const result = await response.json();
        reportScrapeSuccess();
        if (result?.success) {
          window.close();
          return;
        } else {
          throw new Error("API returned unsuccessful response");
        }
      } catch (err) {
        console.error(`Attempt ${attempt} failed:`, err);

        if (attempt === maxRetry) {
          storeErrorInExtensionStorage(err, "Failed to send data to API");
          // await fetch(`${API_BASE_URL}/error/bayut`, {
          //   method: "POST",
          //   headers: { "Content-Type": "application/json" },
          //   body: JSON.stringify({
          //     data: {
          //       message: err.message || "Unknown error",
          //       stack: err.stack || null,
          //       url: window.location.href,
          //       time: new Date().toISOString(),
          //       context: "scrapData error",
          //     },
          //   }),
          // });

          chrome.runtime.sendMessage(
            {
              type: "SEND_ERROR_TO_API",
              endpoint: `/error/bayut`,
              payload: {
                data: {
                  message: err.message || "Unknown error",
                  stack: err.stack || null,
                  url: window.location.href,
                  time: new Date().toISOString(),
                  context: "scrapData → SEND_TO_API",
                },
              },
            },
            (response) => {
              if (!response?.success) {
                console.error("❌ Error API failed:", response?.error);
              }
            },
          );

          reportScrapeFailure();
          console.log("closing window after failure");
          window.close();
          return;
        }

        await wait(delay);
      }
    }
  }
  await sendWithRetry(payload);
}

// --- Entry point ---
// Wait until page fully loads, then request deviceId from extension
window.addEventListener("load", async () => {
  chrome.runtime.sendMessage({ type: "GET_DEVICE_ID" }, (response) => {
    if (response?.deviceId) {
      scrapData(response.deviceId);
    } else {
      console.warn("No deviceId found");
    }
  });
});

// Success/failure signals sent to extension background script
function reportScrapeSuccess() {
  chrome.runtime.sendMessage({ type: "SCRAPE_SUCCESS" });
}

function reportScrapeFailure() {
  chrome.runtime.sendMessage({ type: "SCRAPE_FAILED" });
}

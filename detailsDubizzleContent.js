const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const urlParams = new URLSearchParams(window.location.search);
// const API_BASE_URL = "http://localhost:8000/api";
const API_BASE_URL = CONFIG.API_BASE_URL;
/**
 * Save errors locally in extension storage for review/debugging
 * @param {Error|string} error - The error object or message
 * @param {string} context - Descriptive context for where the error occurred
 */
console.log(
  "API_BASE_URL",
  API_BASE_URL,
  CONFIG.API_BASE_URL,
  "CONFIG.API_BASE_URL",
);

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
    chrome.storage.local.set({ scrapeErrors: existingErrors }, () => {
      console.log("Error stored in extension storage:", newError);
    });
  });
}

function waitUntilVerificationClosed(callback) {
  // Detect Dubizzle/Bayut verification iframe
  const iframe = document.querySelector(
    'iframe[src*="consent"], iframe[src*="verify"], iframe[src*="age"]',
  );

  // If no iframe → verification already passed
  if (!iframe) {
    callback();
    return;
  }

  console.warn(
    "⛔ Security verification active — waiting for user to complete...",
  );

  // Observe DOM changes until iframe is removed
  const observer = new MutationObserver(() => {
    const stillThere = document.querySelector(
      'iframe[src*="consent"], iframe[src*="verify"], iframe[src*="age"]',
    );

    if (!stillThere) {
      observer.disconnect();
      console.log("✅ Verification closed — resuming scraping...");
      callback();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Main data extraction logic from the property detail page
 */

async function waitForSelector(selector, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (document.querySelector(selector)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout waiting for ${selector}`);
}

async function scrapData(deviceId) {
  console.log("deviceId", deviceId);
  // Load siteValue from storage
  chrome.storage.local.get("siteValue", (result) => {
    if (result.siteValue) {
      CONFIG.siteValue = result.siteValue;
      console.log("Loaded site from storage:", CONFIG.siteValue);
    }
  });

  const text = (sel) => document.querySelector(sel)?.innerText?.trim() || null;

  /**
   * Extract info from <ul> lists following section headings
   */
  //*************Newly added code***************
  const getAmenities = async () => {
    const result = {};

    const section = document
      .querySelector('[data-testid="amenities-title"]')
      ?.closest("div")?.parentElement;

    if (!section) return {};

    const collapseSection = section.nextElementSibling;
    if (!collapseSection) return {};

    const moreBtn = collapseSection.querySelector("p");
    if (moreBtn && /^\+\d+\s*More$/i.test(moreBtn.textContent.trim())) {
      moreBtn.click();
      await new Promise((r) => setTimeout(r, 800));
    }

    const amenities = Array.from(
      collapseSection.querySelectorAll("span[data-testid]"),
    ).map((el) => el.textContent.trim());

    if (amenities.length) result["Amenities"] = amenities;

    return result;
  };

  //****************************
  const scrapeListSection = (headingTitle) => {
    const heading = Array.from(
      document.querySelectorAll("h1,h2,h3,h4,h5,h6"),
    ).find(
      (h) => h.textContent.trim().toLowerCase() === headingTitle.toLowerCase(),
    );
    if (!heading) return "No information available";

    const container =
      heading.closest("div.MuiBox-root")?.nextElementSibling ||
      heading.parentElement.nextElementSibling;
    if (!container) return "No information available";
    const out = {};

    if (headingTitle.toLowerCase().includes("amenities")) {
      const items = container.querySelectorAll("div.mui-style-vb9tdn");
      const amenities = {};
      let index = 0;

      items.forEach((item) => {
        const value = item
          .querySelector("span[data-testid]")
          ?.textContent?.trim();
        if (value) {
          amenities[index] = value; // add property to object
          index++; // increment index only when a value is added
        }
      });
      return amenities;
    } else if (headingTitle.toLowerCase().includes("building information")) {
      // Handle Building Information
      const wrapper = heading.closest("div.mui-style-1ax30wd");
      const container = wrapper?.nextElementSibling; // <-- this is the div.mui-style-p58oka
      if (!container) return "No information available";

      const blocks = container.querySelectorAll("div.mui-style-hptel5");
      blocks.forEach((block) => {
        const label = block
          .querySelector("div.mui-style-1187icl div")
          ?.textContent?.trim();
        const value = block
          .querySelector("div.mui-style-f06cyd div")
          ?.textContent?.trim();
        if (label && value && !(label in out)) {
          out[label] = value;
        }
      });
      return out;
    } else {
      // Default: validated information
      const blocks = container.querySelectorAll("div.mui-style-hptel5");
      blocks.forEach((block) => {
        const label = block
          .querySelector("div.mui-style-1187icl div")
          ?.textContent?.trim();
        const value = block
          .querySelector("div.mui-style-f06cyd div")
          ?.textContent?.trim();
        if (label && value && !(label in out)) {
          out[label] = value;
        }
      });
    }
    return out;
  }; // old code

  // New code
  // const scrapeInfoSection = (sectionTitle) => {
  //   try {
  //     // 1️⃣ Find heading by text (case-insensitive)
  //     const heading = Array.from(
  //       document.querySelectorAll("h1,h2,h3,h4,h5,h6"),
  //     ).find(
  //       (h) =>
  //         h.textContent.trim().toLowerCase() ===
  //         sectionTitle.trim().toLowerCase(),
  //     );

  //     if (!heading) return null;

  //     // 2️⃣ Section container is always the next sibling
  //     const container =
  //       heading.closest("div")?.parentElement?.nextElementSibling;

  //     if (!container) return null;

  //     // 3️⃣ Get all info blocks
  //     const blocks = container.querySelectorAll(
  //       'div[class*="mui-style-hptel5"]',
  //     );

  //     if (!blocks.length) return null;

  //     const result = {};

  //     blocks.forEach((block) => {
  //       const label = block
  //         .querySelector('div[class*="mui-style-1187icl"] div')
  //         ?.textContent?.trim();

  //       const value = block
  //         .querySelector('div[class*="mui-style-f06cyd"] div')
  //         ?.textContent?.trim();

  //       if (label && value) {
  //         result[label] = value;
  //       }
  //     });

  //     return Object.keys(result).length ? result : null;
  //   } catch (err) {
  //     console.error(`Error scraping section: ${sectionTitle}`, err);
  //     return null;
  //   }
  // };

  const scrapeInfoSection = (sectionTitle) => {
    try {
      // 1️⃣ Find heading by visible text
      const heading = Array.from(document.querySelectorAll("h2")).find(
        (h) =>
          h.textContent.trim().toLowerCase() ===
          sectionTitle.trim().toLowerCase(),
      );

      if (!heading) return null;

      // 2️⃣ Get the top wrapper that contains this section
      const sectionWrapper = heading.closest("div").parentElement.parentElement;

      if (!sectionWrapper) return null;

      const result = {};

      // 3️⃣ Find ALL elements that have data-testid inside this section
      const valueNodes = sectionWrapper.querySelectorAll("[data-testid]");

      valueNodes.forEach((node) => {
        const key = node.getAttribute("data-testid");
        const value = node.textContent?.trim();

        // Skip title testids
        if (key && value && !key.toLowerCase().includes("title")) {
          result[key] = value;
        }
      });

      return Object.keys(result).length ? result : null;
    } catch (err) {
      console.error(`Error scraping section: ${sectionTitle}`, err);
      return null;
    }
  };

  const scrapeListPropertyInfo = () => {
    const container = document.querySelector("div.mui-style-p58oka");
    if (!container) return "No information available";
    const out = {};
    container.querySelectorAll("div.mui-style-1btz1yr").forEach((block) => {
      const label = block
        .querySelector("div.mui-style-1187icl div")
        ?.textContent?.trim();
      const value = block
        .querySelector("div.mui-style-f06cyd div")
        ?.textContent?.trim();
      if (label && value && !(label in out)) {
        out[label] = value;
      }
    });
    return out;
  };

  /**
   * Extract government/regulatory details (e.g. RERA info)
   */
  const getRegulatory = () => {
    const heading = Array.from(
      document.querySelectorAll("h1,h2,h3,h4,h5,h6"),
    ).find((h) => h.textContent.trim().toLowerCase() === "more info");
    if (!heading) return {};

    // The container is the next sibling of the heading’s wrapper
    const wrapper = heading.closest("div.mui-style-13x04qk");
    const container = wrapper?.nextElementSibling;
    if (!container) return "No information available";

    const out = {};

    // Each info block
    container.querySelectorAll("div.mui-style-1btz1yr").forEach((block) => {
      const label = block
        .querySelector("div.mui-style-1187icl div")
        ?.textContent?.trim();
      const value = block
        .querySelector("div.mui-style-12vge6h div")
        ?.textContent?.trim();
      if (label && value && !(label in out)) {
        out[label] = value;
      }
    });

    return out;
  };

  /**
   * Extract image URLs from property gallery
   */
  function extractImageUrls() {
    const imageUrls = new Set();

    // Grab all images from main gallery and "more images"
    document
      .querySelectorAll(
        'div.property-dpv[data-testid="image-gallery"] img, ul.MuiImageList-root li.MuiImageListItem-root img',
      )
      .forEach((img) => {
        const src = img.getAttribute("src");
        // Only keep URLs from dbz-images.dubizzle.com
        if (src && src.includes("dbz-images.dubizzle.com")) {
          imageUrls.add(src);
        }
      });

    return Array.from(imageUrls);
  }

  // --- Collect property info ---
  let priceText = text('[data-testid="listing-price"]');
  priceText = priceText ? priceText.replace(/\s+/g, " ").trim() : null;
  let numericPrice = null;
  if (priceText) {
    const match = priceText.match(/[\d,]+/);
    numericPrice = match ? match[0] : null;
  }
  const priceNum = priceText
    ? parseInt(priceText.replace(/[^\d]/g, ""), 10)
    : null;

  const area =
    document.querySelector('[data-testid="sqft"]')?.innerText || null;
  const beds =
    document.querySelector('[data-testid="bed_space"]')?.innerText || null;
  const baths =
    document.querySelector('[data-testid="bath"]')?.innerText || null;
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
      priceText: numericPrice,
      priceCurrency:
        text("div[data-testid='listing-price'] p:nth-of-type(1)") || "AED",
      beds,
      baths,
      totalPerSqft: perSqft,
      location:
        text('[data-testid="location-information"]') ||
        text("div._4d1141a9") ||
        "Not available",
      description: text('[data-testid="description"]') || "No description",
      agent: text('[data-testid="agent-name"]') || "No agent name",
      verified: !!document
        .querySelector("div.mui-style-1n10vio p")
        ?.textContent.includes("Verified"),
      // amenities: scrapeListSection("Amenities"),
      amenities: await getAmenities(),
      propertyInformation: scrapeListPropertyInfo(),
      // buildingInformation: scrapeListSection("Building Information"),
      // validatedInformation: scrapeListSection("Validated Information"),
      // projectInformation: scrapeListSection("Project Information"),
      // regulatoryInformation: getRegulatory(),
      buildingInformation: scrapeInfoSection("Building Information"), // new code
      projectInformation: scrapeInfoSection("Project Information"), // new code
      validatedInformation: scrapeInfoSection("Validated Information"), // new code
      regulatoryInformation: scrapeInfoSection("More Info"), // new code

      propertyId: window.location.pathname
        .replace(/\/$/, "")
        .split("-")
        .pop()
        .split(".")[0],
      imageUrls: extractImageUrls(),
      offPlan: !!document
        .querySelector('[data-testid="offplan-badge"]')
        ?.textContent.includes("Off-Plan"),
      reSale: !!document
        .querySelector("p.mui-style-1v5710n")
        ?.textContent.includes("Resale"),
      tags: [],
      isLiked: false,
      rawHtmlSnippet:
        document.querySelector("body")?.innerText?.slice(0, 2000) || null,
    },
  };

  console.log("Extracted Full Payload:", CONFIG.siteValue, payload);
  // Send extracted data to the backend API

  console.log("CONFIG.siteValue", CONFIG.siteValue);
  try {
    chrome.storage.local.get("siteValue", async (ress) => {
      const site = ress.siteValue || CONFIG.siteValue;
      console.log("CONFIG.siteValue", CONFIG.siteValue);
      console.log("site", site);
      console.log("ress.siteValue", ress.siteValue);

      // const response = await fetch(`${API_BASE_URL}/property/${site}`, {
      //   method: "POST",
      //   headers: {
      //     "Content-Type": "application/json",
      //   },
      //   body: JSON.stringify(payload),
      // });

      chrome.runtime.sendMessage(
        {
          type: "SEND_TO_API",
          endpoint: `/property/${site}`,
          payload,
        },
        (response) => {
          console.log("API Response:", response);

          if (response?.success) {
            reportScrapeSuccess();
            window.close();
          } else {
            reportScrapeFailure();
            console.error("Failed to send to API:", response?.error);
          }
        },
      );

      // const result = await response.json();
      // console.log("✅ Sent to API:", result);
      // reportScrapeSuccess();
      // if (result?.success) {
      //   window.close();
      // }
    });
  } catch (err) {
    console.error("Failed to send data to API:", err);
    storeErrorInExtensionStorage(err, "Failed to send data to API");

    // Report error to your backend
    // await fetch(`${API_BASE_URL}/error/${CONFIG.siteValue}`, {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //   },
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
        endpoint: `/error/${CONFIG.siteValue}`,
        payload: {
          data: {
            message: err?.message || "Unknown error",
            stack: err?.stack || null,
            url: window.location.href,
            time: new Date().toISOString(),
            context: "scrapData → SEND_TO_API",
          },
        },
      },
      (response) => {
        if (response?.success) {
          console.log("✅ Error sent to API successfully");
        } else {
          console.error("❌ Error API failed:", response?.error);
        }
      },
    );

    window.close();
  }
}

// --- Entry point ---

// window.addEventListener("load", async () => {
//   chrome.runtime.sendMessage({ type: "GET_DEVICE_ID" }, async (response) => {
//     if (!response?.deviceId) {
//       console.warn("No deviceId found — stopping.");
//       return;
//     }

//     // Wait for DOM to actually load (Dubizzle/Bayut is slow)
//     try {
//       await waitForSelector('[data-testid="listing-price"]', 10000);
//     } catch (e) {
//       console.error("Page never loaded required elements:", e);
//       return;
//     }

//     await loadSiteValue();
//     scrapData(response.deviceId);
//   });
// });

// window.addEventListener("load", async () => {
//   chrome.runtime.sendMessage({ type: "GET_DEVICE_ID" }, (response) => {
//     console.log("Got response for GET_DEVICE_ID:", response);

//     if (!response?.deviceId) {
//       console.warn("No deviceId found");
//       return;
//     }

//     // 🔥 Wait until user completes security check
//     waitUntilVerificationClosed(() => {
//       scrapData(response.deviceId);
//     });
//   });
// });

window.addEventListener("load", async () => {
  chrome.runtime.sendMessage({ type: "GET_DEVICE_ID" }, (response) => {
    console.log("Got response for GET_DEVICE_ID:", response);

    if (!response?.deviceId) {
      console.warn("No deviceId found");
      return;
    }

    // 🔥 Wait until user completes security check
    waitUntilVerificationClosed(async () => {
      try {
        // ✅ WAIT for critical Dubizzle elements
        await waitForSelector("h1", 10000);
        await waitForSelector('[data-testid="listing-price"]', 10000);

        // optional but recommended
        await waitForSelector('[data-testid="bed_space"]', 10000);

        // 🔥 NOW scrape
        scrapData(response.deviceId);
      } catch (err) {
        console.error("❌ Required elements never loaded:", err);
        reportScrapeFailure();
        window.close();
      }
    });
  });
});

// Success/failure signals sent to extension background script

function reportScrapeSuccess() {
  chrome.runtime.sendMessage({ type: "SCRAPE_SUCCESS" });
}

function reportScrapeFailure() {
  chrome.runtime.sendMessage({ type: "SCRAPE_FAILED" });
}

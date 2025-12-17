const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const urlParams = new URLSearchParams(window.location.search);
// const API_BASE_URL = "http://localhost:8000/api";
const API_BASE_URL = CONFIG.API_BASE_URL;
/**
 * Save errors locally in extension storage for review/debugging
 * @param {Error|string} error - The error object or message
 * @param {string} context - Descriptive context for where the error occurred
 */
console.log("API_BASE_URL", API_BASE_URL, CONFIG.API_BASE_URL, "CONFIG.API_BASE_URL");

// -------------------------
// Reload retry management
// -------------------------
const MAX_RELOAD_RETRIES = 6;
const RETRY_KEY = "scrape_reload_attempts";

function getRetryCount() {
  return parseInt(sessionStorage.getItem(RETRY_KEY) || "0", 10);
}

function incrementRetryCount() {
  const next = getRetryCount() + 1;
  sessionStorage.setItem(RETRY_KEY, String(next));
  return next;
}

function resetRetryCount() {
  sessionStorage.removeItem(RETRY_KEY);
}

// -------------------------
// Security page detection
// -------------------------
function isSecurityPageActive() {
  return !!document.querySelector(
    'iframe[src*="verify"], iframe[src*="consent"], iframe[src*="challenge"], iframe[src*="age"]'
  );
}

function reloadIfAllowed(reason = "Unknown") {
  if (isSecurityPageActive()) {
    console.warn("⛔ Security page active — reload blocked");
    return;
  }

  const attempts = getRetryCount();

  if (attempts >= MAX_RELOAD_RETRIES) {
    console.error("❌ Max reload retries reached — giving up");
    reportScrapeFailure();
    window.close();
    return;
  }

  incrementRetryCount();
  console.warn(`🔄 Reloading page (attempt ${attempts + 1}) — ${reason}`);

  setTimeout(() => {
    window.location.reload();
  }, 5 * 60 * 1000); //5 min
}

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
    'iframe[src*="consent"], iframe[src*="verify"], iframe[src*="age"]'
  );

  // If no iframe → verification already passed
  if (!iframe) {
    callback();
    return;
  }

  console.warn("⛔ Security verification active — waiting for user to complete...");

  // Observe DOM changes until iframe is removed
  const observer = new MutationObserver(() => {
    const stillThere = document.querySelector(
      'iframe[src*="consent"], iframe[src*="verify"], iframe[src*="age"]'
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

async function scrapData(deviceId) {
  console.log("deviceId", deviceId)
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

  const scrapeListSection = (headingTitle) => {
    const heading = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      .find(h => h.textContent.trim().toLowerCase() === headingTitle.toLowerCase());
    if (!heading) return "No information available";

    const container = heading.closest("div.MuiBox-root")?.nextElementSibling || heading.parentElement.nextElementSibling;
    if (!container) return "No information available";
    const out = {};

    if (headingTitle.toLowerCase().includes("amenities")) {
      const items = container.querySelectorAll("div.mui-style-vb9tdn");
      const amenities = {};
      let index = 0;

      items.forEach(item => {
        const value = item.querySelector("span[data-testid]")?.textContent?.trim();
        if (value) {
          amenities[index] = value; // add property to object
          index++; // increment index only when a value is added
        }
      });
      return amenities;
    }
    else if (headingTitle.toLowerCase().includes("building information")) {
      // Handle Building Information
      const wrapper = heading.closest("div.mui-style-1ax30wd");
      const container = wrapper?.nextElementSibling; // <-- this is the div.mui-style-p58oka
      if (!container) return "No information available";

      const blocks = container.querySelectorAll("div.mui-style-hptel5");
      blocks.forEach(block => {
        const label = block.querySelector("div.mui-style-1187icl div")?.textContent?.trim();
        const value = block.querySelector("div.mui-style-f06cyd div")?.textContent?.trim();
        if (label && value && !(label in out)) {
          out[label] = value;
        }
      });
      return out;
    }
    else {
      // Default: validated information
      const blocks = container.querySelectorAll("div.mui-style-hptel5");
      blocks.forEach(block => {
        const label = block.querySelector("div.mui-style-1187icl div")?.textContent?.trim();
        const value = block.querySelector("div.mui-style-f06cyd div")?.textContent?.trim();
        if (label && value && !(label in out)) {
          out[label] = value;
        }
      });
    }
    return out;
  };

  const scrapeListPropertyInfo = () => {
    const container = document.querySelector("div.mui-style-p58oka");
    if (!container) return "No information available";
    const out = {};
    container.querySelectorAll("div.mui-style-1btz1yr").forEach(block => {
      const label = block.querySelector("div.mui-style-1187icl div")?.textContent?.trim();
      const value = block.querySelector("div.mui-style-f06cyd div")?.textContent?.trim();
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
    const heading = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      .find(h => h.textContent.trim().toLowerCase() === "more info");
    if (!heading) return {};

    // The container is the next sibling of the heading’s wrapper
    const wrapper = heading.closest("div.mui-style-13x04qk");
    const container = wrapper?.nextElementSibling;
    if (!container) return "No information available";

    const out = {};

    // Each info block
    container.querySelectorAll("div.mui-style-1btz1yr").forEach(block => {
      const label = block.querySelector("div.mui-style-1187icl div")?.textContent?.trim();
      const value = block.querySelector("div.mui-style-12vge6h div")?.textContent?.trim();
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
    document.querySelectorAll('div.property-dpv[data-testid="image-gallery"] img, ul.MuiImageList-root li.MuiImageListItem-root img')
      .forEach(img => {
        const src = img.getAttribute('src');
        // Only keep URLs from dbz-images.dubizzle.com
        if (src && src.includes('dbz-images.dubizzle.com')) {
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

  const area = document.querySelector('[data-testid="sqft"]')?.innerText || "Not available";
  const beds = document.querySelector('[data-testid="bed_space"]')?.innerText || "Not available";
  const baths = document.querySelector('[data-testid="bath"]')?.innerText || "Not available";
  const areaNum = parseFloat((area || "").replace(/[^\d.]/g, "")) || null;
  const perSqft = priceNum && areaNum
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
      priceCurrency: text("div[data-testid='listing-price'] p:nth-of-type(1)") || "AED",
      beds,
      baths,
      totalPerSqft: perSqft,
      location:
        text('[data-testid="location-information"]') || text("div._4d1141a9") || "Not available",
      description:
        text('[data-testid="description"]') || "No description",
      agent: text('[data-testid="agent-name"]') || "No agent name",
      verified: !!document.querySelector("div.mui-style-1n10vio p")?.textContent.includes("Verified"),
      amenities: scrapeListSection("Amenities"),
      propertyInformation: scrapeListPropertyInfo(),
      buildingInformation: scrapeListSection("Building Information"),
      validatedInformation: scrapeListSection("Validated Information"),
      regulatoryInformation: getRegulatory(),
      propertyId: window.location.pathname.replace(/\/$/, "").split("-").pop().split(".")[0],
      imageUrls: extractImageUrls(),
      offPlan: !!document.querySelector('[data-testid="offplan-badge"]')?.textContent.includes("Off-Plan"),
      reSale: !!document.querySelector('p.mui-style-1v5710n')?.textContent.includes("Resale"),
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

      chrome.runtime.sendMessage({
        type: "SEND_TO_API",
        endpoint: `/property/${site}`,
        payload,
      }, (response) => {
        console.log("API Response:", response);

        // if (response?.success) {
        //   reportScrapeSuccess();
        //   window.close();
        // } else {
        //   reportScrapeFailure();
        //   console.error("Failed to send to API:", response?.error);
        // }
        if (response?.success) {
          resetRetryCount();
          reportScrapeSuccess();
          window.close();
        } else {
          reportScrapeFailure();
          reloadIfAllowed("API failure");
        }

      });

      // const result = await response.json();
      // console.log("✅ Sent to API:", result);
      // reportScrapeSuccess();
      // if (result?.success) {
      //   window.close();
      // }
    });

    // } catch (err) {
    //   console.error("Failed to send data to API:", err);
    //   storeErrorInExtensionStorage(err, "Failed to send data to API");

    //   // Report error to your backend
    //   await fetch(`${API_BASE_URL}/error/${CONFIG.siteValue}`, {
    //     method: "POST",
    //     headers: {
    //       "Content-Type": "application/json",
    //     },
    //     body: JSON.stringify({
    //       data: {
    //         message: err.message || "Unknown error",
    //         stack: err.stack || null,
    //         url: window.location.href,
    //         time: new Date().toISOString(),
    //         context: "scrapData error",
    //       },
    //     }),
    //   });
    //   window.close();
    // }

  } catch (err) {
    console.error("Failed to send data to API:", err);
    storeErrorInExtensionStorage(err, "Failed to send data to API");

    const errorPayload = {
      data: {
        message: err.message || "Unknown error",
        stack: err.stack || null,
        url: window.location.href,
        time: new Date().toISOString(),
        context: "scrapData error",
      }
    };

    chrome.runtime.sendMessage(
      {
        type: "SEND_ERROR_TO_API",
        endpoint: `/error/${CONFIG.siteValue}`,
        errorPayload,
      },
      (response) => {
        console.log("Error Report API Response:", response);
        // window.close();
         if (isSecurityPageActive()) {
    console.warn("⛔ Security active — waiting");
    return;
  }

  reloadIfAllowed("error reported to API");
      }
    );
  }
}

function waitForSelector(selector, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeout);
  });
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
//     if (response?.deviceId) {
//       scrapData(response.deviceId);
//     } else {
//       console.warn("No deviceId found");
//     }
//   });
// });

window.addEventListener("load", () => {
  chrome.runtime.sendMessage({ type: "GET_DEVICE_ID" }, async (response) => {
    if (!response?.deviceId) return;

    waitUntilVerificationClosed(async () => {
      try {
        await waitForSelector('[data-testid="listing-price"]', 12000);

        // ✅ Page loaded correctly
        resetRetryCount();

        await scrapData(response.deviceId);
      } catch (e) {
        console.warn("⚠️ Listing data not loaded");

        reloadIfAllowed("listing-price selector missing");
      }
    });
  });
});

// Success/failure signals sent to extension background script

// function reportScrapeSuccess() {
//   chrome.runtime.sendMessage({ type: "SCRAPE_SUCCESS" });
// }

// function reportScrapeFailure() {
//   chrome.runtime.sendMessage({ type: "SCRAPE_FAILED" });
// }

function reportScrapeSuccess() {
  scrapeFinished = true;
  sessionStorage.removeItem("scrapeReloads");
  chrome.runtime.sendMessage({ type: "SCRAPE_SUCCESS" });
}

function reportScrapeFailure() {
  scrapeFinished = true;
  chrome.runtime.sendMessage({ type: "SCRAPE_FAILED" });
}
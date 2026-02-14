const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const urlParams = new URLSearchParams(window.location.search);
const API_BASE_URL = CONFIG.API_BASE_URL;

function storeErrorInExtensionStorage(error, context = "General") {
  const newError = {
    context,
    error: error instanceof Error ? error.message : String(error),
    url: window.location.href,
    time: new Date().toISOString(),
  };

  chrome.storage.local.get(["scrapeErrors"], (result) => {
    const existingErrors = result.scrapeErrors || [];
    existingErrors.push(newError);
    chrome.storage.local.set({ scrapeErrors: existingErrors }, () => {
      console.log("📝 Error stored in extension storage:", newError);
    });
  });
}
async function waitForElement(selector, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el) return el;
    await new Promise((res) => setTimeout(res, 300)); // retry every 300ms
  }
  return null;
}

async function scrapData(deviceId) {
  // Load siteValue from storage
  chrome.storage.local.get("siteValue", (result) => {
    if (result.siteValue) {
      CONFIG.siteValue = result.siteValue;
      console.log("Loaded site from storage:", CONFIG.siteValue);
    }
  });
  console.log("Starting data extraction with deviceId:", deviceId);

  const text = (sel) => document.querySelector(sel)?.innerText?.trim() || null;

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  await waitForElement('img[alt="Area"]');
  await waitForElement("p"); // ensure text nodes exist
  await waitForElement("img.object-cover"); // ensure images load
  //   const imagesUrl = async () => {
  //     const images = document.querySelectorAll(
  //       "#swiper-wrapper-815a8be69d1010bb5a img"
  //     );
  //     const imageUrls = Array.from(images).map((img) => img.src);
  //     return imageUrls;
  //   };
  const imageUrls = Array.from(document.querySelectorAll("img.object-cover"))
    .filter(
      (img) =>
        img.classList.contains("!h-full") && img.classList.contains("!w-full")
    )
    .map((img) => img.src);

  console.log(imageUrls);

  //   const imgs = await imagesUrl();
  //   console.log(imgs);
  //   function extractUrls() {
  //     const container = document.querySelector("#project-hero");

  //     if (!container) return [];

  //     const urls = [];

  //     // Collect image URLs
  //     container.querySelectorAll("img").forEach((img) => {
  //       if (img.src) urls.push(img.src);
  //     });

  //     // Collect video URLs
  //     container.querySelectorAll("video").forEach((video) => {
  //       if (video.src) urls.push(video.src);
  //     });

  //     // Collect link URLs
  //     container.querySelectorAll("a").forEach((a) => {
  //       if (a.href) urls.push(a.href);
  //     });

  //     return urls;
  //   }
  //   console.log("Extracted URLs:", extractUrls());
  // ✅ Find Area
  const areaIcon = document.querySelector('img[alt="Area"]');
  console.log("Area Icon:", areaIcon);
  if (!areaIcon) return;

  let areaNum = null;
  const areaValue = areaIcon
    .closest("div")
    .querySelectorAll("p")[1]
    ?.textContent.trim();
  if (areaValue) {
    areaNum = parseFloat(areaValue.replace(/[^\d.]/g, ""));
  }
  console.log("Area:", areaNum);

  // ✅ Find Current Price
  const priceLabel = [...document.querySelectorAll("p")].find(
    (p) => p.textContent.trim() === "Current Price"
  );

  let priceNum = null;
  if (priceLabel) {
    const priceValue = priceLabel.nextElementSibling?.textContent.trim();
    priceNum = parseInt(priceValue.replace(/[^\d]/g, ""), 10);
  }
  console.log("Price:", priceNum);
  const beds =
    document
      .querySelector('img[alt="Bed tag"]')
      ?.nextElementSibling?.textContent.trim() || null;
  console.log("Beds:", beds);
  const baths =
    document
      .querySelector('img[alt="Bath tag"]')
      ?.nextElementSibling?.textContent.trim() || null;
  console.log("Baths:", baths);
  const perSqft =
    priceNum && areaNum
      ? Number((Number(priceNum) / Number(areaNum)).toFixed(2))
      : null;
  const propertyIdText =
    [...document.querySelectorAll("p")]
      .find((p) => /property id/i.test(p.textContent)) // case-insensitive match
      ?.textContent.trim() || "";

  const propertyId = propertyIdText.replace(/\D+/g, "");
  console.log("Property ID:", propertyId);

  console.log("Property ID:", propertyId);
  function getSpecifications() {
    const specs = {};
    const specContainer = document.querySelector("#specifications");
    if (!specContainer) return specs;

    specContainer.querySelectorAll("li").forEach((li) => {
      const div = li.querySelector("div"); // contains <p> elements
      if (!div) return;

      const pTags = div.querySelectorAll("p");
      if (pTags.length < 2) return;

      const key = pTags[0].textContent.trim(); // first <p> is key
      const value = pTags[1].textContent.trim(); // second <p> is value
      if (key && value) {
        specs[key] = value;
      }
    });

    return specs;
  }

  function getDocuments() {
    const docs = [];
    const docContainer = document.querySelector("#documents");
    if (!docContainer) return docs;

    docContainer.querySelectorAll("a").forEach((link) => {
      const url = link.href || link.getAttribute("href");
      const name = link.querySelector("p")?.textContent.trim();
      if (url && name) {
        docs.push({ name, url });
      }
    });

    return docs;
  }

  function getEndDate() {
    const calIcon = document.querySelector(
      'img[src*="calender.svg"][alt="bid icon"]'
    );
    if (!calIcon) return null;

    const pTags = calIcon.closest("div")?.querySelectorAll("p");
    if (!pTags || pTags.length < 2) return null;

    return pTags[1].textContent.trim();
  }

  function getCurrentPrice() {
    // Find the <p> that contains "Current Price" (case-insensitive)
    const priceLabel = [...document.querySelectorAll("p")].find((p) =>
      /current price/i.test(p.textContent)
    );

    if (!priceLabel) return null;

    // The price is in the next sibling div
    const priceDiv = priceLabel.nextElementSibling;
    if (!priceDiv) return null;

    // The actual numeric price is in the second span
    const spans = priceDiv.querySelectorAll("span");
    if (!spans || spans.length < 2) return null;

    const priceText = spans[1].textContent.trim();

    // Clean the price to keep only digits
    const cleanPrice = priceText.replace(/[^\d]/g, "");

    return cleanPrice;
  }

  function getLocation() {
    const mapPin = document.querySelector('img[src*="mapPin.svg"]');
    if (!mapPin) return null;
    return mapPin.nextElementSibling?.textContent.trim() || null;
  }

  const payload = {
    url: window.location.href,
    deviceId,
    isLiked: false,
    tags: [],
    data: {
      title: text("h1") || "No title",
      area: areaNum,
      price: Number(priceNum) || null,
      priceText: getCurrentPrice() || null,
      priceCurrency: "AED",
      beds,
      baths,

      totalPerSqft: Number(perSqft),
      location: getLocation() || " No location found",
      description: text("#description") || "No description",
      propertyId: propertyId || null,
      specificationOverview: getSpecifications() || null,
      documents: getDocuments() || [],
      imageUrls: imageUrls || [],
      endDate: getEndDate(),
      rawHtmlSnippet:
        document.querySelector("body")?.innerText?.slice(0, 2000) || null,
    },
  };

  // try {
  //   chrome.storage.local.get("siteValue", async (ress) => {
  //     console.log("Using siteValue:", ress.siteValue);
  //     const response = await fetch(
  //       `${API_BASE_URL}/property/${ress.siteValue || CONFIG.siteValue}`,
  //       {
  //         method: "POST",
  //         headers: {
  //           "Content-Type": "application/json",
  //         },
  //         body: JSON.stringify(payload),
  //       }
  //     );

  //     const result = await response.json();
  //     reportScrapeSuccess();

  //     if (result?.success) {
  //       window.close();
  //     }
  //   });
  // } catch (err) {
  //   console.error("Failed to send data to API:", err);
  //   storeErrorInExtensionStorage(err, "Failed to send data to API");

  try {
    chrome.storage.local.get("siteValue", (ress) => {
      const site = ress.siteValue || CONFIG.siteValue || "bayut";

      chrome.runtime.sendMessage(
        {
          type: "SEND_TO_API",
          endpoint: `/property/${site}`,
          payload,
        },
        (response) => {
          console.log("API response:", response);

          if (response?.success) {
            reportScrapeSuccess();
            window.close();
          } else {
            console.error("API failed:", response?.error);
            reportScrapeFailure();
            window.close();
          }
        }
      );
    });
  } catch (err) {
    console.error("Failed to send data to API:", err);
    storeErrorInExtensionStorage(err, "Failed to send data to API");
    reportScrapeFailure();
    window.close();
  }

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
          context: "scrapData error",
        },
      },
    },
    (response) => {
      if (response?.success) {
        console.log("✅ Error sent to API successfully");
      } else {
        console.error("❌ Error API failed:", response?.error);
      }
    }
  );

  window.close();

}

// --- Entry point ---
// Wait until page fully loads, then request deviceId from extension

window.addEventListener("load", async () => {
  console.log("Page fully loaded, requesting deviceId...");
  chrome.runtime.sendMessage({ type: "GET_DEVICE_ID" }, (response) => {
    if (response?.deviceId) {
      scrapData(response.deviceId);
    } else {
      console.warn("No deviceId found");
    }
  });
});

function reportScrapeSuccess() {
  chrome.runtime.sendMessage({ type: "SCRAPE_SUCCESS" });
}

function reportScrapeFailure() {
  chrome.runtime.sendMessage({ type: "SCRAPE_FAILED" });
}

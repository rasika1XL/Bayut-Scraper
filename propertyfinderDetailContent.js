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

async function scrapData(deviceId) {
  const text = (sel) => document.querySelector(sel)?.innerText?.trim() || null;

  chrome.storage.local.get("siteValue", (result) => {
    if (result.siteValue) {
      CONFIG.siteValue = result.siteValue;
      console.log("Loaded site from storage:", CONFIG.siteValue);
    }
  });

  const scrapeDetailsSection = (containerSelector) => {
    const out = {};
    document
      .querySelectorAll(
        `${containerSelector} .styles_desktop_list__item__lF_Fh`,
      )
      .forEach((item) => {
        const labelEl = item.querySelector(
          ".styles_desktop_list__label-text__0YJ8y",
        );
        const valueEl = item.querySelector(
          ".styles_desktop_list__value__uIdMl",
        );

        if (labelEl && valueEl) {
          let key = labelEl.textContent
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_");
          let value = valueEl.textContent.trim();

          // Special handling for Property Size
          if (key === "property_size") {
            const [sqft, sqm] = value.split("/");
            out["size_sqft"] = sqft?.replace(/[^0-9]/g, "");
            out["size_sqm"] = sqm?.replace(/[^0-9]/g, "");
          } else {
            out[key] = value;
          }
        }
      });
    return out;
  };

  function scrapeRegulatoryInfo() {
    const container = document.querySelector(
      ".styles_desktop_container__kcSkl",
    );
    if (!container) return {};

    const out = {};

    // Collect pairs of <p> Label + <p> Value
    const ps = Array.from(container.querySelectorAll("p"));

    for (let i = 0; i < ps.length; i++) {
      const label = ps[i].textContent.trim();
      const next = ps[i].nextElementSibling;

      // if the next <p> has value styling, treat it as the value
      if (
        next &&
        next.tagName === "P" &&
        next.classList.contains("styles_desktop_value__mxst1")
      ) {
        out[label] = next.textContent.trim();
      }
    }

    // Reference (special case because it has data-testid)
    const reference = container.querySelector(
      '[data-testid="property-regulatory-reference"]',
    );
    if (reference) out["Reference"] = reference.textContent.trim();

    // Agent license no
    const agentLicense = container.querySelector(
      '[data-testid="property-regulatory-agent-license-no"]',
    );
    if (agentLicense) out["Agent License No"] = agentLicense.textContent.trim();

    // Phone, if exists
    const phoneLink = document.querySelector(
      '[data-testid="bottom-actions-call-button"]',
    );
    if (phoneLink)
      out["Agent Phone"] = phoneLink.getAttribute("href").split("tel:")[1];

    return out;
  }

  const scrapeAmenities = () => {
    return Array.from(
      document.querySelectorAll(
        '[data-testid^="amenity-"] .styles_text__IlyiW, #project-amenities li span',
      ),
    )
      .map((el) => el.textContent.trim())
      .filter(Boolean);
  };

  // ✅ Usage
  const amenities = scrapeAmenities();
  console.log(amenities);

  const scrapeTransactions = () => {
    const transactions = [];
    const container = document.getElementById("priceInsights");
    if (!container) return transactions;

    // Get all table wrappers inside the container
    const tableWrappers = container.querySelectorAll(
      ".styles_desktop_table__wrapper__E8PtW",
    );

    if (tableWrappers.length >= 2) {
      // --- SOLD FOR table (first wrapper) ---
      const soldRows = tableWrappers[0].querySelectorAll("table tbody tr");
      soldRows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 3) {
          transactions.push({
            subCategory: "SALE",
            date: cells[0].textContent.trim(),
            price: "AED " + cells[1].textContent.trim(),
            area: cells[2].textContent.trim(),
          });
        }
      });

      // --- RENTED FOR table (second wrapper) ---
      const rentRows = tableWrappers[1].querySelectorAll("table tbody tr");
      rentRows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 3) {
          transactions.push({
            subCategory: "RENT",
            date: cells[0].textContent.trim(),
            rent: "AED " + cells[1].textContent.trim(),
            area: cells[2].textContent.trim(),
          });
        }
      });
    }

    return transactions;
  };

  // Example usage:
  console.log(scrapeTransactions());

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  const imagesUrl = async () => {
    // Open gallery
    const clickOnImage = document.querySelector(
      ".styles_desktop_image__button__a2DFs",
    );
    if (clickOnImage) {
      clickOnImage.click();
    }

    // Wait for thumbnails to load
    await wait(3000);

    // Grab all thumbnail images
    const images = Array.from(
      document.querySelectorAll(
        ".styles-module_gallery-thumbnails__list__item__G9-ki img",
      ),
    ).map((img) => img.getAttribute("src"));

    // Close gallery if needed
    const closeBtn = document.querySelector(
      ".styles-module_gallery-full-screen__close-button__GLMVK",
    );
    if (closeBtn) {
      closeBtn.click();
    }

    return images;
  };
  const imgs = await imagesUrl();
  // console.log(imgs);
  function extractUrls() {
    const container = document.querySelector("#project-hero");

    if (!container) return [];

    const urls = [];

    // Collect image URLs
    container.querySelectorAll("img").forEach((img) => {
      if (img.src) urls.push(img.src);
    });

    // Collect video URLs
    container.querySelectorAll("video").forEach((video) => {
      if (video.src) urls.push(video.src);
    });

    // Collect link URLs
    container.querySelectorAll("a").forEach((a) => {
      if (a.href) urls.push(a.href);
    });

    return urls;
  }
  console.log("Extracted URLs:", extractUrls());

  const priceText =
    document.querySelector('[data-testid="property-price"]')?.textContent ||
    null;
  let currency = null;
  if (priceText) {
    currency = priceText.split(" ")[0];
  }
  const priceNum =
    document.querySelector('[data-testid="property-price-value"]')
      ?.textContent || null;

  // Scrape similar transactions
  const similarTransactions = await scrapeTransactions();
  // const area = document.querySelector('[aria-label="Area"]')?.innerText;
  const areaEl = document.querySelector(
    '[data-testid="property-details-size"]',
  );
  let areaNum = null;
  if (areaEl) {
    const text = areaEl.textContent.trim();
    const sqft = text.split("sqft")[0].trim();

    areaNum = parseFloat(sqft?.replace(/[^\d.]/g, ""));
  }
  const beds =
    document.querySelector('[data-testid="property-attributes-bedrooms"]')
      ?.innerText || null;
  const baths =
    document.querySelector('[data-testid="property-attributes-bathrooms"]')
      ?.innerText || null;
  let priceNumSq = null;
  if (priceNum) {
    priceNumSq = priceNum.replace(/,/g, "");
  }

  const perSqft =
    priceNum && areaNum
      ? Number((Number(priceNumSq) / Number(areaNum)).toFixed(2))
      : null;

  const phoneLink = document.querySelector(
    '[data-testid="bottom-actions-call-button"]',
  );
  const agentPhone = phoneLink
    ? phoneLink.getAttribute("href").split("tel:")[1]
    : "No phone found";

  //extract data for new investment properties
  const lanuchPrice =
    document.querySelector(".styles_intro__price__cd2I_")?.innerText || null;
  const developerName =
    document.querySelector('[data-testid="project-developer-name"]')
      ?.innerText || null;

  function extractKeyInfo() {
    const section = document.querySelector('[data-testid="project-key-info"]');
    if (!section) return {};

    const items = section.querySelectorAll(".styles_key-info__item__vVp3J");

    const data = {};

    items.forEach((item) => {
      const labelEl = item.querySelector("div");
      const valueEl = item.querySelector("p") || item.querySelector("button"); // value could be <p> or <button>

      if (labelEl && valueEl) {
        const key = labelEl.textContent.trim();
        const value = valueEl.textContent.trim();

        data[key] = value;
      }
    });

    return data;
  }
  function extractPaymentPlans() {
    const section = document.querySelector(
      '[data-testid="project-payment-plan"]',
    );
    if (!section) return {};

    const data = {};

    // get all tabs (Option 1, Option 2...)
    const tabButtons = section.querySelectorAll('[role="tab"]');
    const tabPanels = section.querySelectorAll('[role="tabpanel"]');

    tabButtons.forEach((btn, index) => {
      const optionName = btn.textContent.trim();
      const panel = tabPanels[index];
      if (!panel) return;

      const steps = [];
      const items = panel.querySelectorAll(".styles_desktop_card__CileH");

      items.forEach((card) => {
        const value =
          card
            .querySelector(".styles_desktop_card__value__9IFsl")
            ?.textContent.trim() || null;

        const title =
          card
            .querySelector(".styles_desktop_card__title__GOXB2")
            ?.textContent.trim() || null;

        const subtitle =
          card
            .querySelector(".styles_desktop_card__subtitle__XuGu2")
            ?.textContent.trim() || null;

        steps.push({ value, title, subtitle });
      });

      data[optionName] = steps;
    });

    return data;
  }
  function extractProjectTimeline() {
    const timelineSection = document.querySelector(
      '[data-testid="project-timeline"]',
    );
    if (!timelineSection) return [];

    const steps = timelineSection.querySelectorAll(
      "li.styles_timeline__step__ZP_5l",
    );

    return Array.from(steps).map((step) => {
      const stepName =
        step
          .querySelector("p.styles_timeline__step-name__VMjfp")
          ?.textContent.trim() || null;
      const stepDate =
        step
          .querySelector("time.styles_timeline__step-date__A0LWD")
          ?.textContent.trim() || null;
      const progress =
        step.querySelector('[data-testid="project-construction-progress"]')
          ?.style.width || null;
      const latestUpdate =
        step
          .querySelector(
            ".styles_construction-progress__last-inspection__7mNkq strong",
          )
          ?.textContent.trim() || null;

      return {
        stepName,
        stepDate,
        progress,
        latestUpdate,
      };
    });
  }

  async function extractUnitData() {
    const section = document.querySelector('[data-testid="project-units"]');
    if (!section) return {};

    const unitsObj = {};
    const unitAccordions = section.querySelectorAll(
      '[data-testid="accordion"]',
    );

    for (const accordion of unitAccordions) {
      const headerButton = accordion.querySelector(
        '[data-testid="project-unit"]',
      );

      // Expand accordion if not already active
      if (
        !accordion.classList.contains("styles_desktop_accordion--active__3uwox")
      ) {
        headerButton.click();
        // Wait a short time for DOM to update
        await new Promise((r) => setTimeout(r, 200));
      }

      // Extract unit info
      const title =
        accordion
          .querySelector("h3.styles_desktop_accordion__unit__title__RMYG9")
          ?.textContent.trim() || "Unknown Unit";
      const price =
        accordion
          .querySelector('[data-testid="accordion-price-from"] p:last-child')
          ?.textContent.trim() || null;
      const area =
        accordion
          .querySelector('[data-testid="accordion-unit-area"] p')
          ?.textContent.trim() || null;

      // Extract layouts
      const rows = accordion.querySelectorAll(
        '[data-testid="accordion-body"] tbody tr',
      );
      const layouts = Array.from(rows).map((row) => ({
        layoutType:
          row.querySelector("td:nth-child(1)")?.textContent.trim() || null,
        size: row.querySelector("td:nth-child(2)")?.textContent.trim() || null,
        floorPlanImg: row.querySelector("td:nth-child(3) img")?.src || null,
      }));

      // Use title as key in object
      const key =
        title in unitsObj
          ? `${title}-${Math.random().toString(36).substr(2, 5)}`
          : title;
      unitsObj[key] = { priceFrom: price, area, layouts };
    }

    return unitsObj;
  }

  // Example usage:
  const projectUnits = await extractUnitData();

  function extractProjectMasterplan() {
    const section = document.querySelector(
      '[data-testid="project-masterplan"]',
    );
    if (!section) return null;

    const title = section.querySelector("h2")?.textContent.trim() || null;
    const image = section.querySelector("img")?.src || null;

    // Description text (excluding headings & lists)
    const descriptionNodes = section.querySelectorAll(
      '[data-testid="project-master-plan-description"] > p',
    );
    const description = Array.from(descriptionNodes)
      .map((p) => p.textContent.trim())
      .filter((t) => t.length > 0);

    // Extract all headings + their following <ul>
    const features = {};
    const descriptionContainer = section.querySelector(
      '[data-testid="project-master-plan-description"]',
    );

    if (descriptionContainer) {
      const headings = descriptionContainer.querySelectorAll("h3, h4");
      headings.forEach((heading) => {
        const key = heading.textContent.trim().replace(/:$/, ""); // remove trailing :
        const nextList =
          heading.nextElementSibling?.tagName === "UL"
            ? Array.from(heading.nextElementSibling.querySelectorAll("li")).map(
                (li) => li.textContent.trim(),
              )
            : [];

        features[key] = nextList;
      });
    }

    return {
      title,
      image,
      description,
      features,
    };
  }
  async function scrapeAgencies() {
    const button = document.querySelector(
      '[data-testid="agencies-show-more-button"]',
    );

    // Step 1: click "See all authorised agencies" if present
    if (button) {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 1500)); // wait for agencies to load
    }

    // Step 2: select all broker cards
    const cards = document.querySelectorAll('[data-testid="broker-card"]');

    // Step 3: extract details
    const agencies = Array.from(cards).map((card) => {
      const name =
        card
          .querySelector('[class*="styles_card__title"]')
          ?.textContent.trim() || null;
      const logo =
        card.querySelector('[data-testid="broker-logo"]')?.src || null;
      const qrcodeLink =
        card.querySelector('[data-testid="broker-qrcode-link"]')?.href || null;
      const profileLink =
        card.querySelector('[data-testid="broker-profile-link"]')?.href || null;

      return {
        name,
        logo,
        qrcodeLink,
        profileLink,
      };
    });

    return agencies;
  }

  const verifiedAgaincies = await scrapeAgencies();
  const pathParts = window.location.pathname.split("-");
  const lastPart = pathParts.pop();
  const propertyId = lastPart.includes(".html")
    ? lastPart.split(".")[0]
    : window.location.href;
  const payload = {
    url: window.location.href,
    deviceId,
    data: {
      title: text("h1") || "No title",
      area: areaNum,
      price: Number(priceNumSq),
      priceText,
      priceCurrency: currency ? currency : "AED",
      beds,
      baths,
      isLiked: false,
      tags: [],
      totalPerSqft: Number(perSqft),
      location:
        text(".styles-module_map__title__M2mBC") || " No location found",
      description:
        text("#description") ||
        text(".styles_desktop_description__content__O2LgM") ||
        "No description",
      agent: text(".styles_agent__name__iexLd") || "No agent found",
      agentPhone: agentPhone,

      verified: !!document.querySelector(".tag-module_tag--verified__q3T28"),
      offPlan: !!document.querySelector('[data-testid="tag-off_plan"]'),
      amenities: scrapeAmenities(),
      propertyDetails: scrapeDetailsSection(".styles_desktop_container__0qL3N"),
      regulatoryInformation: scrapeRegulatoryInfo(),
      similarPropertyTransactions: scrapeTransactions(),
      // propertyId: window.location.pathname.split("-").pop().split(".")[0],
      propertyId: propertyId,
      imageUrls: imgs || extractUrls("#project-hero") || [],
      rawHtmlSnippet:
        document.querySelector("body")?.innerText?.slice(0, 2000) || null,
      launchPrice: lanuchPrice,
      developerName: developerName,
      keyInformation: extractKeyInfo(),
      paymentPlans: extractPaymentPlans(),
      projectTimeline: extractProjectTimeline(),
      projectUnits: projectUnits,
      projectMasterplan: extractProjectMasterplan(),
      verifiedAgaincies: verifiedAgaincies,
    },
  };

  console.log("📦 Extracted Full Payload:", payload);

  // categaries and its urls

  // async function extractCategories() {
  //   const results = [];
  //   const categoryElementsSection = document.querySelector(
  //     '[data-testid="home-age-find-more"]'
  //   );

  //   const categoryElements = categoryElementsSection?.querySelectorAll(
  //     ".tabs-module_navigation__item__xUqkt"
  //   );

  //   if (!categoryElements || categoryElements.length === 0) {
  //     console.warn("No category buttons found!");
  //     return [];
  //   }

  //   // helper: wait some ms
  //   const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  //   // helper: scrape links from current view
  //   const scrapeLinks = () => {
  //     const anchorTags = categoryElementsSection?.querySelectorAll(
  //       '[data-testid="link"]'
  //     );

  //     if (!anchorTags) return [];

  //     return Array.from(anchorTags).map((a) => ({
  //       categoryName: a.innerHTML.trim(),
  //       categoryUrl: a.href,
  //       isLocked: false,
  //       lockedBy: null,
  //       lockedAt: null,
  //     }));
  //   };

  //   // collect from first open tab
  //   results.push(...scrapeLinks());

  //   // loop through remaining tabs (start from index 1)
  //   for (let i = 1; i < categoryElements.length - 1; i++) {
  //     categoryElements[i].click();
  //     await wait(1500); // ⏳ adjust based on page speed
  //     results.push(...scrapeLinks());
  //   }

  //   // deduplicate by URL
  //   const uniqueResults = Array.from(
  //     new Map(results.map((item) => [item.categoryUrl, item])).values()
  //   );

  //   console.log("✅ Unique category links:", uniqueResults);
  //   return uniqueResults;
  // }

  // extractCategories();

  // try {
  //   const response = await fetch(`${API_BASE_URL}/scrapData`, {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json",
  //     },
  //     body: JSON.stringify(payload),
  //   });

  //   const result = await response.json();
  //   console.log("✅ Sent to API:", result);
  //   window.close();
  // } catch (err) {
  //   console.error("❌ Failed to send data to API:", err);
  //   storeErrorInExtensionStorage(err, "Failed to send data to API");

  //   await fetch(`${API_BASE_URL}/err`, {
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

  // Send extracted data to the backend API
  console.log("Sending data to API:", CONFIG.siteValue, payload);
  try {
    // const response = await fetch(
    //   `${API_BASE_URL}/property/${CONFIG.siteValue}`,
    //   {
    //     method: "POST",
    //     headers: {
    //       "Content-Type": "application/json",
    //     },
    //     body: JSON.stringify(payload),
    //   }
    // );

    chrome.runtime.sendMessage(
      {
        type: "SEND_TO_API",
        endpoint: `/property/${CONFIG.siteValue}`,
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
    // reportScrapeSuccess();

    // if (result?.success) {
    //   window.close();
    // }
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

function reportScrapeSuccess() {
  chrome.runtime.sendMessage({ type: "SCRAPE_SUCCESS" });
}

function reportScrapeFailure() {
  chrome.runtime.sendMessage({ type: "SCRAPE_FAILED" });
}

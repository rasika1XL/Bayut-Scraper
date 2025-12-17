// -----------------------------------------------
// Configurable constants (tune based on need)
// -----------------------------------------------

const MAX_RETRIES = 10; // Max retries for waiting listings
const RETRY_DELAY_MS = 1000; // Delay between retries
const SPA_CHECK_INTERVAL_MS = 1000; // Interval to check URL changes in SPA
const BATCH_DELAY_MS = 2 * 60 * 1000; // Delay before opening 2nd batch (2 minutes)
const NEXT_PAGE_DELAY_MS = 5 * 60 * 1000; // Delay before moving to next page (5 minutes)// Delay before moving to next page (5 minutes)
// -----------------------------------------------

// Flags to control automation flow
let isRunning = false;
let lastUrl = location.href;

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
    chrome.storage.local.set({ scrapeErrors: existingErrors }, () => { });
  });

}

// ---------------- Utility: Pause/Stop Handling ----------------

function waitUntilResumed(callback) {
  // Repeatedly check if scraper is paused or stopped before continuing
  function check() {
    getPersistentFlags((flags) => {
      if (flags.isStopped) {
        return; // Exit completely if stopped
      }
      if (flags.isPaused) {
        setTimeout(check, 1000);
      } else {
        callback();
      }
    });
  }
  check();
}

// Start scraping process as soon as script loads
waitForListingsAndRunAutomation();

// Monitor for URL changes (SPA handling)
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    isRunning = false;
    waitForListingsAndRunAutomation();
  }
}, SPA_CHECK_INTERVAL_MS);

// ---------------- Storage: Persistent Flags ----------------
function getPersistentFlags(callback) {
  // Get pause/stop flags from background storage
  try {
    chrome.storage.local.get(["scraperFlags"], (data) => {
      if (chrome.runtime.lastError) {
        storeErrorInExtensionStorage(
          chrome.runtime.lastError,
          "getPersistentFlags"
        );
        callback({ isPaused: false, isStopped: false });
        return;
      }
      const flags = data.scraperFlags || { isPaused: false, isStopped: false };
      callback(flags);
    });
  } catch (err) {
    storeErrorInExtensionStorage(err, "getPersistentFlags");
    callback({ isPaused: false, isStopped: false });
  }
}

// Wait until listing links are available, then begin automation
function waitForListingsAndRunAutomation(retry = 0) {
  getPersistentFlags((flags) => {
    if (flags.isStopped) {
      return;
    }

    if (isRunning) return;

    let listings;
    if (window.location.hostname.includes("bayut.com")) {
      listings = document.querySelectorAll("a[href*='/property/details-']");
    } else if (window.location.hostname.includes("propertyfinder.ae")) {
      listings = document.querySelectorAll("a[href*='/en/plp/']");
    } else if (window.location.hostname.includes("emiratesauction.com")) {
      listings = document.querySelectorAll("a[href*='/auctions/properties/']");
    } else if (window.location.hostname.includes("dubizzle.com")) {
      listings = document.querySelectorAll("a[data-testid^='listing-'][type='property'][href*='/property-']");
    }
    else {
      listings = [];
    }
    // const listings = document.querySelectorAll("a[href*='/property/details-']");
    const loadingSpinner = document.querySelector(".loading, .spinner, .loader"); 
    // Adjust selector to match your site's loading GIF

    if (listings.length === 0 && retry < MAX_RETRIES) {
      setTimeout(
        () => waitForListingsAndRunAutomation(retry + 1),
        RETRY_DELAY_MS
      );
      return;
    }

    if (listings.length === 5) {
      console.warn("⚠️ No listings found after max retries. Reloading page...");
      location.reload(); // 🔄 force reload if nothing loads
      return;
    }

    // Extra safeguard: If only spinner is showing, reload
    if (loadingSpinner && listings.length === 0) {
      console.warn("⚠️ Page stuck on loading spinner. Reloading...");
      location.reload();
      return;
    }

    isRunning = true;
    runAutomation();
  });
}

// Extract all property detail URLs and open them in two batches
function runAutomation() {
  console.log("🏁 Starting automation on", window.location.href);
  getPersistentFlags((flags) => {
    if (flags.isStopped) {
      isRunning = false;
      return;
    }
    if (flags.isPaused) {
      isRunning = false;
      setTimeout(() => waitForListingsAndRunAutomation(), 2000);
      return;
    }

    let links;
    let urlFilterRegex;

    if (window.location.hostname.includes("bayut.com")) {
      links = [...document.querySelectorAll("a[href*='/property/details-']")];
      urlFilterRegex = /https:\/\/www\.bayut\.com\/property\/details-\d+\.html/;
    } else if (window.location.hostname.includes("propertyfinder.ae")) {
      links = [...document.querySelectorAll("a[href*='/en/plp/']")];
      urlFilterRegex = /https:\/\/www\.propertyfinder\.ae\/en\/plp\//;
    } else if (window.location.hostname.includes("emiratesauction.com")) {
      links = [
        ...document.querySelectorAll("a[href*='/auctions/properties/']"),
      ];
      urlFilterRegex =
        /https:\/\/www\.emiratesauction\.com\/auctions\/properties\//;
    } else if (window.location.hostname.includes("dubizzle.com")) {
      links = [...document.querySelectorAll("a[data-testid^='listing-'][type='property'][href*='/property-']")];
      urlFilterRegex = /https:\/\/[^/]+dubizzle\.com\/(en\/)?(property-for-(rent|sale)|new-projects)\/.*\/\d*\/?/;
    }
    const uniqueUrls = [
      ...new Set(
        links.map((a) => a.href).filter((url) => url.match(urlFilterRegex))
      ),
    ];

    if (uniqueUrls.length === 0) {
      console.warn("⚠️ No valid URLs found.");
      isRunning = false;
      return;
    }

    const half = Math.ceil(uniqueUrls.length / 2);
    const firstBatch = uniqueUrls.slice(0, half);
    const secondBatch = uniqueUrls.slice(half);

    try {
      // Save metadata
      chrome.runtime.sendMessage({
        type: "LISTINGS_COUNT",
        count: uniqueUrls.length,
      });
      chrome.runtime.sendMessage({
        type: "SET_PARENT",
        parentUrl: window.location.href,
      });

      // Always open first batch immediately
      chrome.runtime.sendMessage({ type: "OPEN_URLS", urls: firstBatch });
    } catch (err) {
      storeErrorInExtensionStorage(err, "runAutomation-sendMessage");
    }

    // 🔑 Pause/stop-aware scheduler
    function scheduleAction(actionFn, delayMs) {
      setTimeout(() => {
        getPersistentFlags((flags2) => {
          if (flags2.isStopped) {
            return;
          }
          if (flags2.isPaused) {
            scheduleAction(actionFn, 2000);
            return;
          }
          actionFn();
        });
      }, delayMs);
    }

    // Open second batch (only once, pause/stop aware)
    if (secondBatch.length > 0) {
      scheduleAction(() => {
        try {
          chrome.runtime.sendMessage({ type: "OPEN_URLS", urls: secondBatch });
        } catch (err) {
          storeErrorInExtensionStorage(err, "runAutomation-secondBatch");
        }
      }, BATCH_DELAY_MS);
    }

    // Navigate to next page (pause/stop aware)
    scheduleAction(() => {
      goToNextPage();
    }, NEXT_PAGE_DELAY_MS);
  });
}

// Navigate to next page OR notify background script if done
function goToNextPage() {
  const nextBtn =
    document.querySelector('a[title="Next"]') ||
    document.querySelector('a[data-testid="pagination-page-next-link"]') ||
    document.querySelector('.next_button');
  if (nextBtn && nextBtn.href) {
    isRunning = false;
    nextBtn.click();
  } else {
    try {
      const port = chrome.runtime.connect({ name: "category" });
      port.postMessage({ type: "CATEGORY_DONE" });
      port.onMessage.addListener((response) => { });
    } catch (err) {
      storeErrorInExtensionStorage(err, "goToNextPage");
    }
  }
}

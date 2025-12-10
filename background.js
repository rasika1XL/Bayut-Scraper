importScripts("config.js");

function safeRemoveTab(tabId) {
  if (!tabId) return;
  chrome.tabs.remove(tabId, () => {
    if (chrome.runtime.lastError) {
      // prevents "Unchecked runtime.lastError: No tab with id"
    }
  });
}

let currentCategory = null; // Currently locked category object
let isPaused = false; // Pause flag for scraper
let isStopped = false; // Stop flag for scraper
let urlQueue = []; // Queue of listing URLs to open
let processing = false; // Tracks if queue processing is running
const API_BASE_URL = CONFIG.API_BASE_URL;
let CATEGORY_NEXT_ENDPOINT;
let CATEGORY_UNLOCK_ENDPOINT;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SITE_SELECTED") {
    console.log("SITE_SELECTED response:", message.siteValue);
    CATEGORY_NEXT_ENDPOINT = `${API_BASE_URL}/category/${message.siteValue}/next`;
    CATEGORY_UNLOCK_ENDPOINT = `${API_BASE_URL}/category/${message.siteValue}/unlock`;
    console.log("CATEGORY_NEXT_ENDPOINT", CATEGORY_NEXT_ENDPOINT);
    console.log("CATEGORY_UNLOCK_ENDPOINT", CATEGORY_UNLOCK_ENDPOINT);
  }
});

// -----------------------------------------------
// Change according to need
const TAB_OPEN_DELAY = 500;
// -----------------------------------------------

function storeErrorInExtensionStorage(error, context = "General") {
  const newError = {
    context,
    error: error instanceof Error ? error.message : String(error),
    time: new Date().toISOString(),
    url: "", // optional: background context, no URL
    stack: error instanceof Error ? error.stack : null,
  };

  // Retrieve existing errors, append new one, and save back
  chrome.storage.local.get(["scrapeErrors"], (result) => {
    const existingErrors = result.scrapeErrors || [];
    existingErrors.push(newError);
    chrome.storage.local.set({ scrapeErrors: existingErrors }, () => {
      console.log("Logged error in background:", newError);
    });
  });
}

// When the extension is installed, generate and store a device ID
function saveFlagsToStorage() {
  chrome.storage.local.set({ scraperFlags: { isPaused, isStopped } }, () =>
    console.log("Saved flags:", { isPaused, isStopped })
  );
}

// Listen for messages from popup or content
async function loadFlagsFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["scraperFlags"], (data) => {
      const flags = data.scraperFlags || {};
      isPaused = !!flags.isPaused;
      isStopped = !!flags.isStopped;
      resolve(flags);
    });
  });
}

// ------------------ Scraper Control ------------------

function stopScraping() {
  // Pause scraping but keep queue and progress intact
  isStopped = true;
  isPaused = false;
  urlQueue = [];
  processing = false;
  saveFlagsToStorage();

  chrome.storage.local.remove(["currentCategory", "progress"], () => { });
  processing = false;
  saveFlagsToStorage();

  // Close the current parentUrl tab if available
  chrome.storage.local.get("lastOpened", (data) => {
    if (data?.lastOpened?.parentUrl) {
      chrome.tabs.query({ url: data.lastOpened.parentUrl }, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.remove(tabs[0].id, () => {
            console.log(`🛑 Scraping stopped at parentUrl: ${data.lastOpened.parentUrl}`);
          });
        } else {
          console.warn("⚠️ No open tab found for parentUrl to stop.");
        }
      });
    } else {
      console.warn("⚠️ No parentUrl found in storage. Cannot stop properly.");
    }
  });
}

function enqueueUrls(urls) {
  // Add URLs to the queue and start processing if not already
  if (isStopped) return;
  urlQueue.push(...urls);
  if (!processing) processQueue();
}

async function processQueue() {
  // Process queued URLs one by one with respect to pause/stop flags
  if (processing) return;
  processing = true;

  while (urlQueue.length > 0) {
    // Reload flags dynamically so user actions are respected mid-run
    const flags = await new Promise((resolve) => {
      chrome.storage.local.get(["scraperFlags"], (data) => {
        resolve(data.scraperFlags || { isPaused: false, isStopped: false });
      });
    });

    if (flags.isStopped) {
      urlQueue = [];
      break;
    }

    if (flags.isPaused) {
      await new Promise((res) => setTimeout(res, 1000));
      continue;
    }

    const url = urlQueue.shift();
    if (!url) continue;

    // Open tab in background
    try {
      await new Promise((resolve) =>
        chrome.tabs.create({ url, active: false }, () => resolve())
      );
    } catch (err) {
      storeErrorInExtensionStorage(err, "processQueue: opening tab failed");
    }

    // Wait before opening next tab
    await new Promise((res) => setTimeout(res, TAB_OPEN_DELAY));
  }

  processing = false;
}

// ------------------ Extension Setup ------------------
loadFlagsFromStorage();

// Generate a unique deviceId when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.storage.local.get("deviceId", (result) => {
      if (!result.deviceId) {
        const newDeviceId = crypto.randomUUID();
        chrome.storage.local.set({ deviceId: newDeviceId }, () => { });
      }
    });
  } catch (err) {
    storeErrorInExtensionStorage(err, "onInstalled");
  }
});

// Track parent category URL for resuming purposes
let parentUrl = null;

// Unified message listener for all runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    switch (message.type) {

      case "SITE_SELECTED":
        console.log("SITE_SELECTED", message.site);
        if (message.site === "bayut") {
          console.log("Bayut selected!");
        } else {
          console.log("Other site selected:", message.site);
        }
        break;

                    // ------------------ API Handler ------------------
      case "SEND_TO_API":
        console.log("📤 SEND_TO_API received:", {
          endpoint: message.endpoint,
          payloadSummary: {
            url: message.payload?.url,
            title: message.payload?.data?.title,
            images: message.payload?.data?.imageUrls?.length || 0
          }
        });

        const apiUrl = `http://localhost:8000/api${message.endpoint}`;
        console.log("🌍 Final API URL:", apiUrl);

        // IMPORTANT: use async wrapper so errors don’t kill sendResponse
        (async () => {
          try {
            const response = await fetch(apiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(message.payload),
            });

            if (!response.ok) {
              const text = await response.text().catch(() => "");
              throw new Error(`HTTP ${response.status} → ${text}`);
            }

            const json = await response.json();
            console.log("✅ API Response JSON:", json);

            sendResponse({ success: true, data: json });

          } catch (err) {
            console.error("❌ API FAILED →", err);
            sendResponse({ success: false, error: err.message });
          }
        })();

        return true; // keep channel alive

      // ------------------ Scraper Control ------------------

      case "START_SCRAPING":
        isPaused = false;
        isStopped = false;
        saveFlagsToStorage();
        startCategoryScraping();
        break;

      case "PAUSE_SCRAPING":
        isPaused = true;
        saveFlagsToStorage();
        break;

      case "RESUME_SCRAPING_DATA":
        isPaused = false;
        saveFlagsToStorage();
        chrome.storage.local.get("lastOpened", (data) => {
          if (data?.lastOpened?.parentUrl) {
            try {
              chrome.tabs.create({
                url: data.lastOpened.parentUrl,
                active: true,
              });
            } catch (err) {
              storeErrorInExtensionStorage(
                err,
                "RESUME_SCRAPING_DATA: opening tab failed"
              );
            }
          } else {
            console.warn(
              "⚠️ No parentUrl found in storage. Cannot resume category properly."
            );
          }
        });
        break;

      case "STOP_SCRAPING":
        stopScraping();
        break;

      case "RESUME_SCRAPING1":
        chrome.storage.local.get("lastOpened", (data) => {
          if (data?.lastOpened?.parentUrl) {
            try {
              chrome.tabs.create({ url: data.lastOpened.parentUrl });
            } catch (err) {
              storeErrorInExtensionStorage(
                err,
                "RESUME_SCRAPING1: opening tab failed"
              );
            }
          }
        });
        break;

      // ------------------ URL Handling ------------------
      case "OPEN_URLS":
        openUrlsInBatches(message.urls);
        break;

      case "SET_PARENT":
        // Save parent category URL for resuming
        parentUrl = message.parentUrl;
        console.log("Parent URL set:", parentUrl);
        break;

      // ------------------ Progress Tracking ------------------
      case "LISTINGS_COUNT":
        chrome.storage.local.get("progress", (data) => {
          const progress = data.progress || {};
          progress.totalListings = message.count;
          progress.lastUpdated = new Date().toISOString();
          chrome.storage.local.set({ progress });
        });
        break;

      // ------------------ Device ID ------------------
      case "GET_DEVICE_ID":
        chrome.storage.local.get("deviceId", (result) => {
          sendResponse({ deviceId: result.deviceId });
          console.log("deviceId", result.deviceId);
        });
        return true; // keep message channel open

      case "SCRAPE_SUCCESS":
        updateProgress("scraped");
        safeRemoveTab(sender.tab?.id);
        break;

      case "SCRAPE_FAILED":
        updateProgress("failed");
        safeRemoveTab(sender.tab?.id);
        break;

      default:
        console.warn("⚠️ Unknown message type received:", message.type);
    }
  } catch (err) {
    storeErrorInExtensionStorage(err, "runtime.onMessage");
  }
});

// ------------------ Category Handling ------------------

async function startCategoryScraping() {
  // Lock next category for this device and begin scraping
  chrome.storage.local.get("deviceId", async ({ deviceId }) => {
    console.log("deviceId", deviceId);
    try {
      if (!deviceId) {
        console.error("No deviceId found, scraping will not start.");
        return;
      }

      const res = await fetch(`${CATEGORY_NEXT_ENDPOINT}?deviceId=${deviceId}`);
      console.log("res", res);

      const json = await res.json();
      console.log("Fetched category:", json);
      if (json.success && json.data) {
        currentCategory = json.data;
        chrome.storage.local.set({ currentCategory }, () => { });
        openCurrentCategory(currentCategory);
        initProgressForCategory(json.data._id);
      } else {
        console.warn("No more categories.");
      }
    } catch (err) {
      // console.error("Error locking category:", err);
      storeErrorInExtensionStorage(err, "startCategoryScraping");
    }
  });
}

function unlockAndMoveToNextCategory() {
  // Unlock current category and move to next
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(
      ["deviceId", "currentCategory"],
      ({ deviceId, currentCategory: storedCategory }) => {
        if (!deviceId || !storedCategory?._id) {
          reject("Missing device ID or current category.");
          return;
        }

        fetch(CATEGORY_UNLOCK_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: storedCategory._id,
            deviceId: deviceId,
          }),
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Failed with status ${response.status}`);
            }
            return response.json();
          })
          .then((data) => {
            chrome.storage.local.remove("currentCategory");
            currentCategory = null;
            resolve();
          })
          .catch((err) => {
            console.error("Error unlocking category:", err);
            reject(err);
          });
      }
    );
  });
}

// Open the category URL in a new tab and inject the automation script
function openCurrentCategory(category) {
  console.log("categoryyy:", category);

  try {
    console.log("Opening category URL:", category.categoryUrl);
    chrome.tabs.create({ url: category.categoryUrl }, (tab) => {
      const tabId = tab.id;
      console.log("✅ Tab opened with ID:", tab.id);
      // Wait for the tab to finish loading before injecting the script
      chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
        if (updatedTabId === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
        }
      });
    });
  } catch (err) {
    storeErrorInExtensionStorage(err, "openCurrentCategory");
  }
}

// ------------------ URL Handling ------------------

// Open listing URLs in new tabs, one at a time with delay

function openUrlsInBatches(urls) {
  console.log("urls", urls);
  const incoming = Array.isArray(urls) ? urls : [];
  const newUrls = incoming.filter((u) => !urlQueue.includes(u));

  if (newUrls.length === 0) {
    return;
  }

  urlQueue = urlQueue.concat(newUrls);

  let index = 0;

  // Robust opener loop that clears `processing` when done.
  function openNext() {
    chrome.storage.local.get(["scraperFlags"], ({ scraperFlags }) => {
      const paused = scraperFlags?.isPaused;
      const stopped = scraperFlags?.isStopped;

      if (stopped) {
        urlQueue = [];
        processing = false; // ensure we reset processing
        return;
      }

      if (paused) {
        // retry after 1s while paused (keeps processing = true so we don't create multiple loops)
        setTimeout(openNext, 1000);
        return;
      }

      const url = urlQueue.shift();
      if (!url) {
        // queue is empty -> stop processing so future pushes can start it again
        processing = false;
        return;
      }

      try {
        chrome.tabs.create({ url, active: false }, () => {
          chrome.storage.local.set(
            {
              lastOpened: {
                parentUrl: parentUrl,
                url,
                index,
                timestamp: new Date().toISOString(),
              },
            },
            () => {
              console.log("💾 Saved last opened:", url, "at index:", index);
            }
          );
        });
      } catch (err) {
        storeErrorInExtensionStorage(
          err,
          "openUrlsInBatches: opening tab failed"
        );
      }

      index++;
      // Wait before opening next tab
      setTimeout(openNext, TAB_OPEN_DELAY);
    });
  }

  // If not already running, start the loop. If it is running, new URLs are already appended.
  if (!processing) {
    processing = true;
    openNext();
  } else {
    // If processing is true but the loop isn't actively running (guard against a stuck state),
    // try to kick it — this is defensive and helps recover from earlier bugs.
    console.log("Queue already processing; new URLs will be opened in turn.");
  }
}

// ------------------ Progress Tracking ------------------
chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((message) => {
    if (message.type === "CATEGORY_DONE") {
      unlockAndMoveToNextCategory()
        .then(() => {
          port.postMessage({ status: "done" }); // respond
          markProgressAsDone();
          startCategoryScraping();
        })
        .catch((err) => {
          storeErrorInExtensionStorage(err, "CATEGORY_DONE");
        });
    }
  });
});

function initProgressForCategory(categoryId) {
  const progress = {
    categoryId,
    totalListings: 0,
    scraped: 0,
    failed: 0,
    status: "running",
    lastUpdated: new Date().toISOString(),
  };
  chrome.storage.local.set({ progress });
}

function updateProgress(type) {
  try {
    chrome.storage.local.get("progress", (data) => {
      const progress = data.progress || {};
      if (!progress) return;

      if (type === "scraped") progress.scraped = (progress.scraped || 0) + 1;
      if (type === "failed") progress.failed = (progress.failed || 0) + 1;

      progress.lastUpdated = new Date().toISOString();

      chrome.storage.local.set({ progress });
    });
  } catch (err) {
    storeErrorInExtensionStorage(err, "updateProgress");
  }
}

function markProgressAsDone() {
  try {
    chrome.storage.local.get("progress", (data) => {
      const progress = data.progress || {};
      progress.status = "done";
      progress.lastUpdated = new Date().toISOString();
      chrome.storage.local.set({ progress });
    });
  } catch (err) {
    storeErrorInExtensionStorage(err, "markProgressAsDone");
  }
}

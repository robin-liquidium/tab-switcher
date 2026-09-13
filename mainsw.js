/**
 * Tab Switcher - Chrome Extension Service Worker
 * Provides macOS-style Cmd+Tab switching for Chrome tabs
 */

// Version checking
var EXTENSION_VERSION = chrome.runtime.getManifest().version;
var VERSION_CHECK_URL = "https://github.com/robin-liquidium/tab-switcher/releases/latest/download/version.json";

// MRU (Most Recently Used) tab tracking
var mru = [];
var initialized = false;

// Switch state
var slowSwitchOngoing = false;
var fastSwitchOngoing = false;
var nativeSwitchOngoing = false;
var intSwitchCount = 0;
var lastIntSwitchIndex = 0;
var slowswitchForward = false;

// Timer for legacy Alt shortcuts
var slowtimerValue = 1500;
var fasttimerValue = 200;
var timer;

// Debug logging (enabled for troubleshooting)
var loggingOn = false;

// Native messaging for Ctrl+Tab interception
var nativePort = null;
var nativeHostConnected = false;

// Thumbnail caching for visual tab switcher
var tabThumbnails = {}; // Map of tabId -> base64 thumbnail data
var tabThumbnailOrder = []; // Track order for LRU eviction
var MAX_THUMBNAILS = 20; // Limit memory usage - keep only 20 most recent thumbnails
var MAX_THUMBNAIL_CHARS = 1024 * 1024; // At most 2 MiB of UTF-16 image strings
var thumbnailTimer;
var thumbnailCaptureInFlight = false;
var thumbnailGeneration = 0;
var lastThumbnailCapture = 0;

var log = function(str) {
	if(loggingOn) {
		console.log(str);
	}
}

// Welcome/setup page URL (update this once website is live)
var SETUP_PAGE_URL = "https://github.com/robin-liquidium/tab-switcher#installation";

// Initialize on install/update
chrome.runtime.onInstalled.addListener((details) => {
	log("Extension " + details.reason);
	
	// Open setup page on first install
	if (details.reason === "install") {
		chrome.tabs.create({ url: SETUP_PAGE_URL });
	}
	
	initialize();
});

var processCommand = function(command) {
	log('Command recd:' + command);
	var fastswitch = true;
	slowswitchForward = false;
	if(command == "alt_switch_fast") {
		fastswitch = true;
	} else if(command == "alt_switch_slow_backward") {
		fastswitch = false;
		slowswitchForward = false;
	} else if(command == "alt_switch_slow_forward") {
		fastswitch = false;
		slowswitchForward = true;
	}

	if(!slowSwitchOngoing && !fastSwitchOngoing) {

		if(fastswitch) {
			fastSwitchOngoing = true;
		} else {
			slowSwitchOngoing = true;
		}
			log("TabSwitch::START_SWITCH");
			intSwitchCount = 0;
			doIntSwitch();

	} else if((slowSwitchOngoing && !fastswitch) || (fastSwitchOngoing && fastswitch)){
		log("TabSwitch::DO_INT_SWITCH");
		doIntSwitch();

	} else if(slowSwitchOngoing && fastswitch) {
		endSwitch();
		fastSwitchOngoing = true;
		log("TabSwitch::START_SWITCH");
		intSwitchCount = 0;
		doIntSwitch();

	} else if(fastSwitchOngoing && !fastswitch) {
		endSwitch();
		slowSwitchOngoing = true;
		log("TabSwitch::START_SWITCH");
		intSwitchCount = 0;
		doIntSwitch();
	}

	if(timer) {
		if(fastSwitchOngoing || slowSwitchOngoing) {
			clearTimeout(timer);
		}
	}
	if(fastswitch) {
		timer = setTimeout(function() {endSwitch()},fasttimerValue);
	} else {
		timer = setTimeout(function() {endSwitch()},slowtimerValue);
	}

};

chrome.commands.onCommand.addListener(processCommand);

// Handle messages from popup
var pendingPingCallback = null;
var pingTimeout = null;

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
	if (request.action === "get_connection_status") {
		sendResponse({ connected: nativeHostConnected && nativePort !== null });
		return true;
	}
	
	if (request.action === "get_version_info") {
		chrome.storage.local.get(["versionInfo"], function(result) {
			sendResponse(result.versionInfo || null);
		});
		return true;
	}

	if (request.action === "ping_native_host") {
		// Clear any previous pending ping
		if (pingTimeout) {
			clearTimeout(pingTimeout);
			pingTimeout = null;
		}
		if (pendingPingCallback) {
			pendingPingCallback = null;
		}
		
		// If no port or not connected, try to connect first
		if (!nativePort) {
			connectNativeHost();
		}
		
		if (!nativePort) {
			sendResponse({ connected: false });
			return true;
		}
		
		// Set up callback for pong response
		pendingPingCallback = function(success) {
			sendResponse({ connected: success });
		};
		
		// Set timeout for ping response
		pingTimeout = setTimeout(function() {
			if (pendingPingCallback) {
				pendingPingCallback(false);
				pendingPingCallback = null;
			}
		}, 2000);
		
		// Send ping
		try {
			sendToNativeHost({ action: "ping" });
		} catch (e) {
			log("Ping failed: " + e.message);
			if (pendingPingCallback) {
				pendingPingCallback(false);
				pendingPingCallback = null;
			}
			clearTimeout(pingTimeout);
		}
		
		return true; // Keep channel open for async response
	}
});

chrome.runtime.onStartup.addListener(function () {
	log("Extension startup");
	initialize();
});

// ============================================
// Version Checking
// ============================================

var VERSION_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

function checkForUpdates() {
	log("Checking for updates...");
	fetch(VERSION_CHECK_URL, { cache: "no-cache" })
		.then(function(response) { return response.json(); })
		.then(function(data) {
			var isManualInstall = chrome.runtime.getManifest().update_url === undefined;
			var versionInfo = {
				currentVersion: EXTENSION_VERSION,
				latestExtensionVersion: data.extension ? data.extension.version : null,
				latestExtensionNotes: data.extension ? data.extension.releaseNotes : null,
				chromeWebStoreUrl: data.extension ? data.extension.chromeWebStoreUrl : null,
				latestAppVersion: data.app ? data.app.version : null,
				latestAppNotes: data.app ? data.app.releaseNotes : null,
				appDownloadUrl: data.app ? data.app.downloadUrl : null,
				isManualInstall: isManualInstall,
				lastChecked: Date.now()
			};
			chrome.storage.local.set({ versionInfo: versionInfo });
			log("Version check complete: current=" + EXTENSION_VERSION + ", latest=" + versionInfo.latestExtensionVersion + ", manual=" + isManualInstall);
		})
		.catch(function(err) {
			log("Version check failed: " + err.message);
		});
}

// Check on startup and every 6 hours
checkForUpdates();
setInterval(checkForUpdates, VERSION_CHECK_INTERVAL);


var doIntSwitch = function() {
	log("TabSwitch:: in int switch, intSwitchCount: "+intSwitchCount+", mru.length: "+mru.length);
	if (intSwitchCount < mru.length && intSwitchCount >= 0) {
		var tabIdToMakeActive;
		//check if tab is still present
		//sometimes tabs have gone missing
		var invalidTab = true;
		var thisWindowId;
		if(slowswitchForward) {
			decrementSwitchCounter();	
		} else {
			incrementSwitchCounter();	
		}
		tabIdToMakeActive = mru[intSwitchCount];
		chrome.tabs.get(tabIdToMakeActive, function(tab) {
			if(tab) {
				thisWindowId = tab.windowId;
				invalidTab = false;

				chrome.windows.update(thisWindowId, {"focused":true});
				chrome.tabs.update(tabIdToMakeActive, {active:true, highlighted: true});
				lastIntSwitchIndex = intSwitchCount;
				//break;
			} else {
				log("TabSwitch:: in int switch, >>invalid tab found.intSwitchCount: "+intSwitchCount+", mru.length: "+mru.length);
				removeItemAtIndexFromMRU(intSwitchCount);
				if(intSwitchCount >= mru.length) {
					intSwitchCount = 0;
				}
				doIntSwitch();
			}
		});	

		
	}
}

var endSwitch = function() {
	log("TabSwitch::END_SWITCH");
	slowSwitchOngoing = false;
	fastSwitchOngoing = false;
	nativeSwitchOngoing = false;
	var tabId = mru[lastIntSwitchIndex];
	putExistingTabToTop(tabId);
	printMRUSimple();
}

chrome.tabs.onActivated.addListener(function(activeInfo){
	// Note: By the time this fires, the new tab is already visible
	// So we capture the NEW tab's thumbnail (the one we just switched to)
	// This ensures each tab's thumbnail is captured while it's visible

	if(!slowSwitchOngoing && !fastSwitchOngoing && !nativeSwitchOngoing) {
		var index = mru.indexOf(activeInfo.tabId);

		//probably should not happen since tab created gets called first than activated for new tabs,
		// but added as a backup behavior to avoid orphan tabs
		if(index == -1) {
			log("Unexpected scenario hit with tab("+activeInfo.tabId+").")
			addTabToMRUAtFront(activeInfo.tabId)
		} else {
			putExistingTabToTop(activeInfo.tabId);	
		}
		
		// Capture thumbnail of the tab we just switched TO (after a brief delay for render)
		scheduleThumbnailCapture(activeInfo.tabId, activeInfo.windowId);
	}
});

// Update thumbnail when page finishes loading
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
	if (changeInfo.status === 'complete' && tab.active) {
		// Page finished loading, capture a fresh thumbnail after a short delay
		scheduleThumbnailCapture(tabId, tab.windowId);
	}
});

chrome.tabs.onCreated.addListener(function(tab) {
	log("Tab create event fired with tab("+tab.id+")");
	addTabToMRUAtBack(tab.id);
});

chrome.tabs.onRemoved.addListener(function(tabId, removedInfo) {
	log("Tab remove event fired from tab("+tabId+")");
	removeTabFromMRU(tabId);
	// Clean up thumbnail when tab is closed
	delete tabThumbnails[tabId];
	var thumbIndex = tabThumbnailOrder.indexOf(tabId);
	if (thumbIndex !== -1) {
		tabThumbnailOrder.splice(thumbIndex, 1);
	}
});


var addTabToMRUAtBack = function(tabId) {

	var index = mru.indexOf(tabId);
	if(index == -1) {
		//add to the end of mru
		mru.splice(-1, 0, tabId);
	}

}
	
var addTabToMRUAtFront = function(tabId) {

	var index = mru.indexOf(tabId);
	if(index == -1) {
		//add to the front of mru
		mru.splice(0, 0,tabId);
	}
	
}
var putExistingTabToTop = function(tabId){
	var index = mru.indexOf(tabId);
	if(index != -1) {
		mru.splice(index, 1);
		mru.unshift(tabId);
	}
}

var removeTabFromMRU = function(tabId) {
	var index = mru.indexOf(tabId);
	if(index != -1) {
		mru.splice(index, 1);
	}
}

var removeItemAtIndexFromMRU = function(index) {
	if(index < mru.length) {
		mru.splice(index, 1);
	}
}

var incrementSwitchCounter = function() {
	intSwitchCount = (intSwitchCount+1)%mru.length;
}

var decrementSwitchCounter = function() {
	if(intSwitchCount == 0) {
		intSwitchCount = mru.length - 1;
	} else {
		intSwitchCount = intSwitchCount - 1;
	}
}

var initialize = function() {

	if(!initialized) {
		initialized = true;
		chrome.windows.getAll({populate:true},function(windows){
			mru = windows.flatMap(window => window.tabs)
				.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
				.map(tab => tab.id);
			log("MRU after init: "+mru);
		});
	}
}	

var printMRUSimple = function() {
	log("mru: " + mru);
}

// ============================================
// Thumbnail Capture for Visual Tab Switcher
// ============================================

// Coalesce activation/loading bursts and stay below Chrome's capture quota.
var scheduleThumbnailCapture = function(tabId, windowId) {
	clearTimeout(thumbnailTimer);
	var generation = ++thumbnailGeneration;
	thumbnailTimer = setTimeout(function() {
		captureThumbnail(tabId, windowId, generation);
	}, Math.max(500, 1000 - (Date.now() - lastThumbnailCapture)));
};

var captureThumbnail = async function(tabId, windowId, generation = thumbnailGeneration) {
	if (thumbnailCaptureInFlight) {
		scheduleThumbnailCapture(tabId, windowId);
		return;
	}
	thumbnailCaptureInFlight = true;
	var bitmap;
	var canvas;
	try {
		var tab = await chrome.tabs.get(tabId);
		var win = await chrome.windows.get(windowId);
		if (generation !== thumbnailGeneration || !tab.active || tab.windowId !== windowId ||
			!win.focused || win.state === 'minimized' || !/^https?:/.test(tab.url || '')) return;

		lastThumbnailCapture = Date.now();
		var dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 40 });
		var blob = await (await fetch(dataUrl)).blob();
		bitmap = await createImageBitmap(blob);
		dataUrl = null;
		blob = null;
		var scale = Math.min(1, 440 / Math.max(bitmap.width, bitmap.height));
		canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)),
			Math.max(1, Math.round(bitmap.height * scale)));
		canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		bitmap.close();
		bitmap = null;
		var thumbnail = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
		var bytes = new Uint8Array(await thumbnail.arrayBuffer());
		var encoded = 'data:image/jpeg;base64,' + btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));

		// A tab may switch, navigate, or close while capture/encoding is in flight.
		var current = await chrome.tabs.get(tabId);
		if (generation !== thumbnailGeneration || !current.active || current.url !== tab.url ||
			current.windowId !== windowId) return;
		var existingIndex = tabThumbnailOrder.indexOf(tabId);
		if (existingIndex !== -1) tabThumbnailOrder.splice(existingIndex, 1);
		tabThumbnailOrder.unshift(tabId);
		tabThumbnails[tabId] = encoded;
		var totalChars = Object.values(tabThumbnails).reduce((sum, value) => sum + value.length, 0);
		while (tabThumbnailOrder.length > MAX_THUMBNAILS || totalChars > MAX_THUMBNAIL_CHARS) {
			var oldest = tabThumbnailOrder.pop();
			totalChars -= tabThumbnails[oldest].length;
			delete tabThumbnails[oldest];
		}
	} catch (error) {
		log('Thumbnail capture failed: ' + error.message);
	} finally {
		if (bitmap) bitmap.close();
		if (canvas) { canvas.width = 1; canvas.height = 1; }
		thumbnailCaptureInFlight = false;
	}
};

// Capture thumbnail of the current active tab (for initial capture)
var captureCurrentTabThumbnail = function() {
	chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
		if (tabs && tabs.length > 0) {
			var tab = tabs[0];
			scheduleThumbnailCapture(tab.id, tab.windowId);
		}
	});
};

// ============================================
// Native Messaging for Ctrl+Tab interception
// ============================================

// Detect which browser we're running in and return its bundle ID
var detectBrowserBundleId = function() {
	var ua = navigator.userAgent;
	
	// Check for specific browsers (order matters - check more specific first)
	if (ua.includes("Edg/")) {
		return "com.microsoft.edgemac";
	} else if (ua.includes("Brave")) {
		return "com.brave.Browser";
	} else if (ua.includes("Vivaldi")) {
		return "com.vivaldi.Vivaldi";
	} else if (ua.includes("OPR/") || ua.includes("Opera")) {
		// Check for Opera GX vs regular Opera
		if (ua.includes("OPGX")) {
			return "com.operasoftware.OperaGX";
		}
		return "com.operasoftware.Opera";
	} else if (ua.includes("Arc/")) {
		return "company.thebrowser.Browser";
	} else if (ua.includes("Helium")) {
		return "net.imput.helium";
	} else if (ua.includes("Chromium")) {
		return "org.chromium.Chromium";
	} else if (ua.includes("Chrome")) {
		// Generic Chrome - could be Google Chrome or other Chromium-based
		return "com.google.Chrome";
	}
	
	// Fallback - assume Chrome
	return "com.google.Chrome";
};

var browserBundleId = detectBrowserBundleId();
log("Detected browser: " + browserBundleId);

var connectNativeHost = function() {
	if (nativePort) {
		log("Native host already connected");
		return;
	}

	try {
		nativePort = chrome.runtime.connectNative("build.robin.tabswitcher.native");
		log("Connected to native host");

		nativePort.onMessage.addListener(function(message) {
			log("Native message received: " + JSON.stringify(message));
			
			// Mark connection as alive on any message
			nativeHostConnected = true;
			
			if (message.action === "ready") {
				log("Native host is ready, registering browser: " + browserBundleId);
				// Register this extension with its browser's bundle ID
				sendToNativeHost({ action: "register", bundleId: browserBundleId, extensionVersion: EXTENSION_VERSION });
			} else if (message.action === "registered" || message.action === "shortcuts_changed") {
				log("Successfully registered with native host for browser: " + message.bundleId);
				if (message.shortcuts) {
					chrome.storage.local.set({ shortcuts: message.shortcuts });
				}
			} else if (message.action === "pong") {
				// Ping response - connection is alive
				log("Received pong - connection alive");
				if (pendingPingCallback) {
					clearTimeout(pingTimeout);
					pendingPingCallback(true);
					pendingPingCallback = null;
					pingTimeout = null;
				}
			} else if (message.action === "cycle_next") {
				queueNativeSwitch(() => handleNativeCycle(1, message.current_window_only, message.max_tabs));
			} else if (message.action === "cycle_prev") {
				queueNativeSwitch(() => handleNativeCycle(-1, message.current_window_only, message.max_tabs));
			} else if (message.action === "select_tab") {
				queueNativeSwitch(() => handleNativeSelection(message.tabId));
			} else if (message.action === "cancel_switch") {
				queueNativeSwitch(handleNativeCancelSwitch);
			} else if (message.action === "end_switch") {
				queueNativeSwitch(handleNativeEndSwitch);
			} else if (message.action === "copy_url") {
				handleCopyUrl();
			} else if (message.action === "error_no_accessibility") {
				log("Native host error: No accessibility permissions");
				nativeHostConnected = false;
			}
		});

		nativePort.onDisconnect.addListener(function() {
			log("Native host disconnected");
			if (chrome.runtime.lastError) {
				log("Native host error: " + chrome.runtime.lastError.message);
			}
			nativePort = null;
			nativeHostConnected = false;
			
			// Try to reconnect after a short delay
			setTimeout(connectNativeHost, 1000);
		});

	} catch (e) {
		log("Failed to connect to native host: " + e.message);
		nativePort = null;
		nativeHostConnected = false;
	}
};

// Send a message to the native host
var sendToNativeHost = function(message) {
	if (nativePort) {
		try {
			nativePort.postMessage(message);
			log("Sent to native host: " + JSON.stringify(message).substring(0, 200));
		} catch (e) {
			log("Error sending to native host: " + e.message);
		}
	} else {
		log("Cannot send to native host - not connected");
	}
};

// Keep key presses, hover selections, and release ordered while browser queries run.
var nativeSwitchQueue = Promise.resolve();
function queueNativeSwitch(action) {
	nativeSwitchQueue = nativeSwitchQueue.then(action).catch(function(error) {
		sendToNativeHost({ action: "hide_switcher" });
		nativeSwitchOngoing = false;
		filteredMru = [];
		log("Native switch failed: " + error.message);
	});
	return nativeSwitchQueue;
}

var filteredMru = [];
var nativeSwitchWindowId = null;
var nativeSwitchFocusVersion = 0;

// Check if any window from this profile is currently focused
// This is critical for multi-profile support - only the focused profile should respond
var isThisProfileFocused = async function() {
	try {
		// Get all windows in this profile
		var allWindows = await chrome.windows.getAll({windowTypes: ['normal']});
		log("TabSwitch::Profile has " + allWindows.length + " windows");
		
		for (var win of allWindows) {
			log("TabSwitch::  Window id=" + win.id + " focused=" + win.focused + " state=" + win.state);
			if (win.focused) {
				log("TabSwitch::This profile has a focused window (id=" + win.id + ")");
				return true;
			}
		}
		log("TabSwitch::This profile has NO focused windows - ignoring command");
		return false;
	} catch (e) {
		log("TabSwitch::Error checking focused windows: " + e.message);
		// If we can't check, assume we're not focused to avoid conflicts
		return false;
	}
};

// Query metadata once at the start; subsequent cycling only changes the selection.
var handleNativeCycle = async function(direction, windowOnly, maxTabs = 6) {
	if (!nativeSwitchOngoing) {
		var focusVersion = nativeSwitchFocusVersion;
		var windows = await chrome.windows.getAll({populate: true, windowTypes: ['normal']});
		if (focusVersion !== nativeSwitchFocusVersion) return;
		var focusedWindow = windows.find(win => win.focused);
		if (!focusedWindow) return;

		var tabs = (windowOnly === false ? windows : [focusedWindow]).flatMap(win => win.tabs);
		var tabsById = new Map(tabs.map(tab => [tab.id, tab]));
		var activeTab = focusedWindow.tabs.find(tab => tab.active);
		// Include newly created tabs even if their MRU event has not arrived yet.
		var orderedIds = [...new Set([activeTab?.id, ...mru, ...tabs.map(tab => tab.id)])];
		filteredMru = orderedIds.filter(id => tabsById.has(id)).slice(0, Number.isInteger(maxTabs) ? Math.min(10, Math.max(2, maxTabs)) : 6);
		if (!filteredMru.length) return;

		nativeSwitchOngoing = true;
		nativeSwitchWindowId = focusedWindow.id;
		intSwitchCount = (direction + filteredMru.length) % filteredMru.length;
		lastIntSwitchIndex = intSwitchCount;
		sendToNativeHost({
			action: "show_switcher",
			tabs: filteredMru.map(id => {
				var tab = tabsById.get(id);
				return { id, title: tab.title || 'Untitled', favIconUrl: tab.favIconUrl || '',
					thumbnail: tabThumbnails[id] || null, url: tab.url || '' };
			}),
			selectedIndex: intSwitchCount
		});
		return;
	}

	intSwitchCount = (intSwitchCount + direction + filteredMru.length) % filteredMru.length;
	lastIntSwitchIndex = intSwitchCount;
	sendToNativeHost({ action: "update_selection", selectedIndex: intSwitchCount });
};

var handleNativeSelection = function(tabId) {
	if (!nativeSwitchOngoing) return;
	var index = filteredMru.indexOf(tabId);
	if (index === -1) return;
	intSwitchCount = lastIntSwitchIndex = index;
	sendToNativeHost({ action: "update_selection", selectedIndex: index });
};

var handleNativeCancelSwitch = function() {
	if (!nativeSwitchOngoing) return;
	sendToNativeHost({ action: "hide_switcher" });
	nativeSwitchOngoing = false;
	filteredMru = [];
	nativeSwitchWindowId = null;
};

var handleNativeEndSwitch = async function() {
	if (!nativeSwitchOngoing) return;
	var tabId = filteredMru[lastIntSwitchIndex];
	sendToNativeHost({ action: "hide_switcher" });
	nativeSwitchOngoing = false;
	filteredMru = [];
	if (!await isThisProfileFocused()) return;

	// The selected tab may have closed while the switcher was open.
	try {
		var tab = await chrome.tabs.get(tabId);
		await chrome.windows.update(tab.windowId, {focused: true});
		await chrome.tabs.update(tabId, {active: true, highlighted: true});
		putExistingTabToTop(tabId);
	} catch (error) {
		log("Selected tab is no longer available: " + error.message);
	}
};

// Only the focused profile may return a URL to the companion app.
var handleCopyUrl = async function() {
    try {
        var windows = await chrome.windows.getAll({populate: true, windowTypes: ['normal']});
        var tab = windows.find(win => win.focused)?.tabs.find(tab => tab.active);
        if (tab?.url) sendToNativeHost({ action: "url_copied", url: tab.url });
    } catch (error) {
        log("Copy URL failed: " + error.message);
    }
};

// Keep service worker alive (Chrome kills inactive workers after 30s)
var alivePort = null;
setInterval(() => {
	if (!alivePort) {
		alivePort = chrome.runtime.connect({ name: "keepalive" });
		alivePort.onDisconnect.addListener(() => { alivePort = null; });
	}
	if (alivePort) alivePort.postMessage({ ping: true });
}, 25000);

initialize();

// Connect to native host for Ctrl+Tab interception
connectNativeHost();

// Reconnect native host when this profile's window gains focus
// This fixes the issue where the service worker goes dormant when the profile is in the background
chrome.windows.onFocusChanged.addListener(function(windowId) {
	nativeSwitchFocusVersion++;
	if (nativeSwitchOngoing && windowId !== nativeSwitchWindowId) {
		sendToNativeHost({ action: "hide_switcher" });
		nativeSwitchOngoing = false;
		filteredMru = [];
	}

	if (windowId !== chrome.windows.WINDOW_ID_NONE) {
		log("Window focus changed to: " + windowId);
		// Check if the native host connection is still alive
		if (!nativePort || !nativeHostConnected) {
			log("Native host connection lost, reconnecting...");
			connectNativeHost();
		} else {
			// Send a ping to verify the connection is still working
			try {
				sendToNativeHost({ action: "ping" });
			} catch (e) {
				log("Ping failed, reconnecting: " + e.message);
				nativePort = null;
				nativeHostConnected = false;
				connectNativeHost();
			}
		}
	}
});

// Capture initial thumbnail after a short delay (to let page load)
setTimeout(captureCurrentTabThumbnail, 2000);
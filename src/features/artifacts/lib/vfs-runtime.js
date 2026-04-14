/**
 * Virtual File System Runtime
 *
 * This script is injected into HTML iframes to provide access to virtual files.
 * It overrides fetch(), XMLHttpRequest, Image, and Audio to intercept requests
 * for virtual files and resolve them to data URLs.
 *
 * The __VFS_URLS__ object is populated at injection time with the URL mapping.
 */
(() => {
  // URL mapping will be injected before this script
  // window.__VFS_URLS__ = { "file.json": "data:application/json;base64,..." }

  // Helper to normalize paths (remove leading ./ and /)
  function normalizePath(path) {
    return path.replace(/^\.\//, "").replace(/^\//, "");
  }

  // Helper to resolve virtual path to data URL
  function resolveVfsPath(path) {
    // Handle relative URLs, strip query strings and fragments
    var cleanPath = path.split("?")[0].split("#")[0];
    var normalized = normalizePath(cleanPath);
    return window.__VFS_URLS__[normalized] || window.__VFS_URLS__[cleanPath] || null;
  }

  // Check if URL is a virtual file (not absolute http/https/blob/data)
  function isVirtualPath(url) {
    if (typeof url !== "string") return false;
    return (
      !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("blob:") && !url.startsWith("data:")
    );
  }

  function InterceptedXMLHttpRequest() {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open;

    function interceptedOpen(...args) {
      const url = args[1];
      const resolved = url && isVirtualPath(url) ? resolveVfsPath(url) : null;

      if (resolved) {
        args[1] = resolved;
      }

      return originalOpen.apply(xhr, args);
    }

    xhr.open = interceptedOpen;
    return xhr;
  }

  function InterceptedImage(width, height) {
    const img = new OriginalImage(width, height);
    const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");

    if (!originalSrcDescriptor?.get || !originalSrcDescriptor.set) {
      return img;
    }

    Object.defineProperty(img, "src", {
      get: () => originalSrcDescriptor.get.call(img),
      set: (value) => {
        let nextValue = value;
        const resolved = nextValue && isVirtualPath(nextValue) ? resolveVfsPath(nextValue) : null;

        if (resolved) {
          nextValue = resolved;
        }

        originalSrcDescriptor.set.call(img, nextValue);
      },
    });

    return img;
  }

  function InterceptedAudio(src) {
    const resolved = src && isVirtualPath(src) ? resolveVfsPath(src) : null;
    return new OriginalAudio(resolved || src);
  }

  // Override native fetch to intercept virtual file requests
  const originalFetch = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    const resolved = url && isVirtualPath(url) ? resolveVfsPath(url) : null;

    if (resolved) {
      return originalFetch.call(window, resolved, init);
    }

    return originalFetch.call(window, input, init);
  };

  // Override XMLHttpRequest to intercept virtual file requests
  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = InterceptedXMLHttpRequest;

  // Copy static properties/methods from original XMLHttpRequest
  Object.keys(OriginalXHR).forEach((key) => {
    window.XMLHttpRequest[key] = OriginalXHR[key];
  });
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;

  // Override Image constructor to intercept virtual file requests
  const OriginalImage = window.Image;
  window.Image = InterceptedImage;
  window.Image.prototype = OriginalImage.prototype;

  // Override Audio constructor to intercept virtual file requests
  const OriginalAudio = window.Audio;
  window.Audio = InterceptedAudio;
  window.Audio.prototype = OriginalAudio.prototype;

  // VFS helper object for explicit access
  window.vfs = {
    // Resolve a virtual path to its data URL
    resolve: (path) => resolveVfsPath(path) || path,

    // Fetch from virtual filesystem (uses original fetch)
    fetch: function (path) {
      var url = this.resolve(path);
      return originalFetch.call(window, url);
    },

    // Load JSON from virtual filesystem
    loadJSON: function (path) {
      return this.fetch(path).then((res) => res.json());
    },

    // Load text from virtual filesystem
    loadText: function (path) {
      return this.fetch(path).then((res) => res.text());
    },

    // Load as Blob
    loadBlob: function (path) {
      return this.fetch(path).then((res) => res.blob());
    },

    // Load as ArrayBuffer
    loadArrayBuffer: function (path) {
      return this.fetch(path).then((res) => res.arrayBuffer());
    },

    // Get image URL for use in src attributes
    imageUrl: function (path) {
      return this.resolve(path);
    },

    // Create and load an Image
    loadImage: function (path) {
      return new Promise((resolve, reject) => {
        const img = new OriginalImage();
        img.onload = () => {
          resolve(img);
        };
        img.onerror = (e) => {
          reject(e);
        };
        img.src = this.resolve(path);
      });
    },

    // Check if a file exists in the virtual filesystem
    exists: (path) => resolveVfsPath(path) !== null,

    // List all available files
    list: () => Object.keys(window.__VFS_URLS__),
  };
})();

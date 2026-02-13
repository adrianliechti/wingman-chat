/**
 * Virtual File System Runtime
 * 
 * This script is injected into HTML iframes to provide access to virtual files.
 * It overrides fetch(), XMLHttpRequest, Image, and Audio to intercept requests
 * for virtual files and resolve them to data URLs.
 * 
 * The __VFS_URLS__ object is populated at injection time with the URL mapping.
 */
(function() {
  // URL mapping will be injected before this script
  // window.__VFS_URLS__ = { "file.json": "data:application/json;base64,..." }
  
  // Helper to normalize paths (remove leading ./ and /)
  function normalizePath(path) {
    return path.replace(/^\.\//, '').replace(/^\//, '');
  }
  
  // Helper to resolve virtual path to data URL
  function resolveVfsPath(path) {
    // Handle relative URLs, strip query strings and fragments
    var cleanPath = path.split('?')[0].split('#')[0];
    var normalized = normalizePath(cleanPath);
    return window.__VFS_URLS__[normalized] || window.__VFS_URLS__[cleanPath] || null;
  }
  
  // Check if URL is a virtual file (not absolute http/https/blob/data)
  function isVirtualPath(url) {
    if (typeof url !== 'string') return false;
    return !url.startsWith('http://') && 
           !url.startsWith('https://') && 
           !url.startsWith('blob:') && 
           !url.startsWith('data:');
  }
  
  // Override native fetch to intercept virtual file requests
  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url);
    if (url && isVirtualPath(url)) {
      var resolved = resolveVfsPath(url);
      if (resolved) {
        return originalFetch.call(window, resolved, init);
      }
    }
    return originalFetch.call(window, input, init);
  };
  
  // Override XMLHttpRequest to intercept virtual file requests
  var OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    var xhr = new OriginalXHR();
    var originalOpen = xhr.open;
    xhr.open = function(method, url) {
      var args = Array.prototype.slice.call(arguments);
      if (url && isVirtualPath(url)) {
        var resolved = resolveVfsPath(url);
        if (resolved) {
          args[1] = resolved;
        }
      }
      return originalOpen.apply(xhr, args);
    };
    return xhr;
  };
  // Copy static properties/methods from original XMLHttpRequest
  Object.keys(OriginalXHR).forEach(function(key) {
    window.XMLHttpRequest[key] = OriginalXHR[key];
  });
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;
  
  // Override Image constructor to intercept virtual file requests
  var OriginalImage = window.Image;
  window.Image = function(width, height) {
    var img = new OriginalImage(width, height);
    var originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(img, 'src', {
      get: function() {
        return originalSrcDescriptor.get.call(img);
      },
      set: function(value) {
        if (value && isVirtualPath(value)) {
          var resolved = resolveVfsPath(value);
          if (resolved) {
            value = resolved;
          }
        }
        originalSrcDescriptor.set.call(img, value);
      }
    });
    return img;
  };
  window.Image.prototype = OriginalImage.prototype;
  
  // Override Audio constructor to intercept virtual file requests
  var OriginalAudio = window.Audio;
  window.Audio = function(src) {
    if (src && isVirtualPath(src)) {
      var resolved = resolveVfsPath(src);
      if (resolved) {
        src = resolved;
      }
    }
    return new OriginalAudio(src);
  };
  window.Audio.prototype = OriginalAudio.prototype;
  
  // VFS helper object for explicit access
  window.vfs = {
    // Resolve a virtual path to its data URL
    resolve: function(path) {
      return resolveVfsPath(path) || path;
    },
    
    // Fetch from virtual filesystem (uses original fetch)
    fetch: function(path) {
      var url = this.resolve(path);
      return originalFetch.call(window, url);
    },
    
    // Load JSON from virtual filesystem
    loadJSON: function(path) {
      return this.fetch(path).then(function(res) { return res.json(); });
    },
    
    // Load text from virtual filesystem
    loadText: function(path) {
      return this.fetch(path).then(function(res) { return res.text(); });
    },
    
    // Load as Blob
    loadBlob: function(path) {
      return this.fetch(path).then(function(res) { return res.blob(); });
    },
    
    // Load as ArrayBuffer
    loadArrayBuffer: function(path) {
      return this.fetch(path).then(function(res) { return res.arrayBuffer(); });
    },
    
    // Get image URL for use in src attributes
    imageUrl: function(path) {
      return this.resolve(path);
    },
    
    // Create and load an Image
    loadImage: function(path) {
      var self = this;
      return new Promise(function(resolve, reject) {
        var img = new OriginalImage();
        img.onload = function() { resolve(img); };
        img.onerror = function(e) { reject(e); };
        img.src = self.resolve(path);
      });
    },
    
    // Check if a file exists in the virtual filesystem
    exists: function(path) {
      return resolveVfsPath(path) !== null;
    },
    
    // List all available files
    list: function() {
      return Object.keys(window.__VFS_URLS__);
    }
  };
})();
